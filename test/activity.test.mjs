import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackDemoActivity } from '../runtime/demo-activity.mjs';
import { demoBlocked } from '../runtime/gateway.mjs';

test('human visible pointer, keyboard and touch events send throttled activity; synthetic events and hidden pages do not', async () => {
  const handlers = new Map(); let sent = 0; let now = 100_000;
  const target = { visibilityState: 'visible', addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: name => handlers.delete(name) };
  const stop = trackDemoActivity(target, async () => { sent++; }, () => now);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  handlers.get('pointermove')({ isTrusted: false }); await settle(); assert.equal(sent, 0);
  handlers.get('keydown')({ isTrusted: true }); await settle(); assert.equal(sent, 1);
  handlers.get('pointermove')({ isTrusted: true }); await settle(); assert.equal(sent, 1);
  now += 15_000; target.visibilityState = 'hidden'; handlers.get('touchstart')({ isTrusted: true }); await settle(); assert.equal(sent, 1);
  target.visibilityState = 'visible'; handlers.get('touchstart')({ isTrusted: true }); await settle(); assert.equal(sent, 2);
  stop(); assert.equal(handlers.size, 0);
});

test('demo permits application actions and media reads but blocks upload, signup and external integrations', () => {
  for (const path of ['/api/feed/posts', '/api/feed/posts/one/comments', '/api/auth/login']) assert.equal(demoBlocked('POST', path), false);
  assert.equal(demoBlocked('GET', '/api/media/one'), false);
  for (const path of ['/api/media/uploads', '/api/auth/signup', '/api/oauth2/authorization/github', '/api/integrations/github', '/api/support', '/api/auth/password/change', '/api/auth/account/delete', '/api/auth/2fa/totp/setup', '/api/me/integrations/linkedin', '/api/media;ignored/uploads']) assert.equal(demoBlocked('POST', path), true);
});

test('selected administrators cannot reconfigure external integration credentials in a writable demo',()=>{
  for(const path of ['/api/admin/support/github','/api/admin/support/ticket/reply','/api/identity/verification','/api/me/github/sync','/api/admin/github/pulls/review','/api/admin/contributors/sync','/api/admin/contributors/repositories']) {
    assert.equal(demoBlocked('POST',path,true),true,path);
    assert.equal(demoBlocked('PUT',path,true),true,path);
  }
  for(const path of ['/api/feed/posts','/api/blogs/me/posts','/api/media/uploads','/api/storage/uploads/boot/media_id/file.png','/api/admin/contributors/users/person/recalculate']) {
    assert.equal(demoBlocked('POST',path,true),false,path);
  }
});
