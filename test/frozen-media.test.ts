import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createGateway } from '../runtime/gateway.js';

const fixtures = new URL('file://'+path.resolve('test/fixtures/images')+'/');
const expected:Record<string,{bytes:number;sha256:string}> = JSON.parse(fs.readFileSync(new URL('expected.json',fixtures),'utf8'));
const types = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };
const sha = (bytes:Buffer) => createHash('sha256').update(bytes).digest('hex');
async function gateway(t:TestContext, files:Record<string,Buffer>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-media-'));
  fs.mkdirSync(path.join(root, 'seed'));
  const inventory:Record<string,{bytes:number;sha256:string}> = {};
  for (const [name, bytes] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, 'seed', name), bytes);
    inventory[name] = { bytes: bytes.length, sha256: sha(bytes) };
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({format:'enois-preview-ts-v1',media:[{url:'/seed/',directory:'seed',inventory}]}));
  const server = createGateway({mediaRoot:root,manifestPath:path.join(root,'manifest.json')});
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(()=>resolve())); fs.rmSync(root,{recursive:true,force:true}); });
  const address=server.address();assert.ok(address&&typeof address==='object');
  return { origin:`http://127.0.0.1:${address.port}`, root };
}

test('frozen image GET and HEAD preserve literal MIME, bytes and hash for all supported images', async t => {
  const files = Object.fromEntries(Object.keys(types).map(format => [`${format}.bin`,fs.readFileSync(new URL(`valid.${format}`, fixtures))]));
  const {origin} = await gateway(t, files);
  for (const [format, mime] of Object.entries(types)) {
    const url = `${origin}/seed/${format}.bin`;
    const get = await fetch(url);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('content-type'), mime, format);
    assert.equal(get.headers.get('content-length'), String(files[`${format}.bin`]!.length));
    assert.equal(sha(Buffer.from(await get.arrayBuffer())), expected[`valid.${format}`]!.sha256);
    assert.equal(Number(get.headers.get('content-length')),expected[`valid.${format}`]!.bytes);
    t.diagnostic(JSON.stringify({format,mime, ...expected[`valid.${format}`]}));
    const head = await fetch(url, {method:'HEAD'});
    assert.equal(head.status, 200);
    for (const header of ['content-type','content-length','cache-control','x-content-type-options','content-security-policy']) assert.equal(head.headers.get(header),get.headers.get(header));
    assert.equal((await head.arrayBuffer()).byteLength,0);
  }
  const decoded = await new Promise((resolve,reject) => {
    const child=spawn(process.execPath,['dist/scripts/validate-decoding.js'],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
    child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(new Error(errors)));
    child.stdin.end(JSON.stringify({origin,paths:Object.keys(types).map(format=>`/seed/${format}.bin`)}));
  });
  assert.deepEqual(decoded,[1280,390].map(width=>({width,mobileEmulation:width===390,images:Object.keys(types).map(format=>({path:`/seed/${format}.bin`,width:64,height:64}))})));
  t.diagnostic(JSON.stringify({decoded}));

});


test('unknown, short and empty bytes stay unclassified regardless of extension, while unsafe paths stay denied', async t => {
  const files:Record<string,Buffer> = {'fake.png':Buffer.from('BINARY<svg >'), 'empty.avif':Buffer.alloc(0), 'short.gif':Buffer.from('GIF'), 'target':Buffer.from('private')};
  const {origin, root} = await gateway(t,files);
  fs.unlinkSync(path.join(root,'seed','target'));
  fs.symlinkSync(path.join(root,'manifest.json'), path.join(root,'seed','target'));
  for (const name of ['fake.png','empty.avif','short.gif']) {
    const response = await fetch(`${origin}/seed/${name}`);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'application/octet-stream');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),files[name]);
  }
  for (const name of ['target','missing','%2e%2e%2fmanifest.json']) assert.equal((await fetch(`${origin}/seed/${name}`)).status,404);
});


test('AVIF compatible brands and large SVG preambles are identified from at most the prefix', async t => {
  const brand = Buffer.alloc(32);brand.writeUInt32BE(32);brand.write('ftyp',4);brand.write('mif1',8);brand.write('avif',24);
  const sequence = Buffer.from(brand);sequence.write('avis',24);
  const extended = Buffer.concat([Buffer.from([0,0,0,1]), brand.subarray(4,8), Buffer.from([0,0,0,0,0,0,0,40]),brand.subarray(8)]);
  const files={'compatible':brand,'sequence':sequence,'extended':extended,'svg':Buffer.from('<?xml version="1.0"?><!--'+ ' '.repeat(900)+'--><svg xmlns="http://www.w3.org/2000/svg"/>')};
  const {origin}=await gateway(t,files);
  for (const name of Object.keys(files)) assert.equal((await fetch(`${origin}/seed/${name}`,{method:'HEAD'})).headers.get('content-type'),name==='svg'?'image/svg+xml':'image/avif');
});
