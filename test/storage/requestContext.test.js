import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorageConfigForTests } from '../../src/storage/config.js';
import { publicBaseFor, storageRequestContext, currentPublicBase } from '../../src/storage/requestContext.js';
import { toPublicUrl } from '../../src/storage/publicUrl.js';

const req = (hostname, protocol = 'http') => ({ hostname, protocol });

function configure(env) {
  for (const key of ['NODE_ENV', 'MINIO_PUBLIC_URL', 'MINIO_ENDPOINT', 'MINIO_PORT', 'MINIO_USE_SSL']) {
    delete process.env[key];
  }
  Object.assign(process.env, { MINIO_ENDPOINT: '127.0.0.1', MINIO_PORT: '9000' }, env);
  resetStorageConfigForTests();
}

beforeEach(() => configure({}));

test('local dev: links follow the host each client used to reach the API', () => {
  assert.equal(publicBaseFor(req('10.0.2.2')), 'http://10.0.2.2:9000'); // Android emulator
  assert.equal(publicBaseFor(req('localhost')), 'http://localhost:9000'); // simulator / browser
  assert.equal(publicBaseFor(req('192.168.1.20')), 'http://192.168.1.20:9000'); // phone on the LAN
});

test('production: MINIO_PUBLIC_URL always wins; a forged Host header changes nothing', () => {
  configure({ NODE_ENV: 'production', MINIO_PUBLIC_URL: 'https://images.example.com' });
  assert.equal(publicBaseFor(req('attacker.example')), 'https://images.example.com');
});

test('production without MINIO_PUBLIC_URL never falls back to the Host header', () => {
  configure({ NODE_ENV: 'production' });
  assert.equal(publicBaseFor(req('attacker.example')), 'http://127.0.0.1:9000');
});

test('an explicit MINIO_PUBLIC_URL wins in dev too', () => {
  configure({ MINIO_PUBLIC_URL: 'http://images.local:9000' });
  assert.equal(publicBaseFor(req('10.0.2.2')), 'http://images.local:9000');
});

test('malformed hostnames are ignored', () => {
  for (const bad of ['', 'a b', 'evil.com/path', 'x@y', '-bad.example']) {
    assert.equal(publicBaseFor(req(bad)), 'http://127.0.0.1:9000', JSON.stringify(bad));
  }
});

test('model getters see the right host for the request being served', async () => {
  const ref = 'storage:public/products/2026/09/a.webp';
  const seen = await new Promise((resolve) => {
    storageRequestContext(req('10.0.2.2'), {}, async () => {
      await new Promise((r) => setTimeout(r, 5)); // survives awaits, like a DB call
      resolve({ base: currentPublicBase(), url: toPublicUrl(ref) });
    });
  });
  assert.equal(seen.base, 'http://10.0.2.2:9000');
  assert.equal(seen.url, 'http://10.0.2.2:9000/grocery-public/products/2026/09/a.webp');
});
