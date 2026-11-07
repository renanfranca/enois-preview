import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as records from '../preview/state.js';
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('versioned identity uses deterministic UTF-8 with sorted object keys and ordered arrays', () => {
  const contract = records as unknown as { canonical(value: unknown): string; identity(value: unknown): string };
  const value = { '😀': 0, a: ['é', null, { β: true }], '2': 'dois', '10': 'dez' };

  assert.equal(contract.canonical(value), '{"10":"dez","2":"dois","a":["é",null,{"β":true}],"😀":0}');
  assert.equal(contract.identity(value), 'c004e39a0a2b480ecfefcc6d8c0ebfebf1def0dc81416b43718c8ed87fae1b7f');
  assert.equal(contract.identity({ '10': 'dez', '2': 'dois', a: ['é', null, { β: true }], '😀': 0 }), contract.identity(value));
  assert.notEqual(contract.identity({ a: [1, 2] }), contract.identity({ a: [2, 1] }));
});

test('durable record writes refuse a historical record before changing its bytes or directory permissions', async () => {
  const directory=await mkdtemp(join(tmpdir(),'enois-record-'));
  try {
    const file=join(directory,'journal.json');const original='{"schema":2,"private":"fictional"}\n';
    await writeFile(file,original,{mode:0o640});const before=(await stat(directory)).mode;

    await assert.rejects(records.writeRecord(file,{revision:'new'}),/Unsupported record format.*enois-preview-ts-v1.*fresh installation/);

    assert.equal(await readFile(file,'utf8'),original);assert.equal((await stat(file)).mode&0o777,0o640);
    assert.equal((await stat(directory)).mode,before);assert.deepEqual(await readdir(directory),['journal.json']);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
