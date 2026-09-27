import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeClientValue,
  finalObjectKey,
  isSafeObjectKey,
  makeRef,
  parseRef,
  parseUploadReference,
  publicObjectUrl,
  toPublicUrl,
} from '../../src/storage/refs.js';

const publicBucket = 'grocery-public';
const publicBase = 'http://10.0.2.2:9000';

test('references round-trip, and only well-formed ones parse', () => {
  const ref = makeRef('public', 'products/2026/09/a.webp');
  assert.deepEqual(parseRef(ref), { visibility: 'public', key: 'products/2026/09/a.webp' });
  for (const bad of [
    'storage:secret/x.webp', // unknown visibility
    'storage:public/', // empty key
    'storage:public/../private/licences/x.webp', // traversal
    'storage:public//double-slash.webp',
    '/uploads/img.png',
    'https://example.com/x.png',
    null,
    42,
  ]) {
    assert.equal(parseRef(bad), null, String(bad));
  }
});

test('object keys refuse traversal and odd characters', () => {
  assert.ok(isSafeObjectKey('licences/2026/09/9a41.webp'));
  for (const bad of ['', '../x', 'a/../b', 'a//b', '/abs', 'a b', 'a?b', 'x'.repeat(513)]) {
    assert.equal(isSafeObjectKey(bad), false, bad);
  }
});

test('upload references accept only a real UUID', () => {
  const id = 'f3b255e2-fe1f-4b7d-9952-e0cf564cc677';
  assert.equal(parseUploadReference(`upload:${id}`), id);
  for (const bad of ['upload:', 'upload:123', `upload:${id}x`, id, `storage:public/${id}`]) {
    assert.equal(parseUploadReference(bad), null, bad);
  }
});

test('public references become path-style URLs for the requesting client', () => {
  const ref = makeRef('public', 'products/2026/09/a.webp');
  assert.equal(
    toPublicUrl(ref, { publicBase, publicBucket }),
    'http://10.0.2.2:9000/grocery-public/products/2026/09/a.webp',
  );
});

test('a private reference NEVER becomes a public URL', () => {
  // A licence reference that ended up in a public column must not leak as a link.
  assert.equal(toPublicUrl(makeRef('private', 'licences/2026/09/x.webp'), { publicBase, publicBucket }), null);
});

test('legacy values and empties pass through unchanged', () => {
  assert.equal(toPublicUrl('/uploads/img_1.png', { publicBase, publicBucket }), '/uploads/img_1.png');
  assert.equal(toPublicUrl('https://cdn.example.com/x.png', { publicBase, publicBucket }), 'https://cdn.example.com/x.png');
  assert.equal(toPublicUrl(null, { publicBase, publicBucket }), null);
  assert.equal(toPublicUrl(undefined, { publicBase, publicBucket }), null);
});

test('a URL the client was given maps back to the stored reference, whatever the host', () => {
  const ref = makeRef('public', 'products/2026/09/a.webp');
  for (const host of ['http://10.0.2.2:9000', 'http://localhost:9000', 'https://images.example.com']) {
    const url = publicObjectUrl(host, publicBucket, 'products/2026/09/a.webp');
    assert.equal(canonicalizeClientValue(url, { publicBucket }), ref, host);
  }
});

test('legacy absolute /uploads URLs canonicalise to the stored path', () => {
  assert.equal(
    canonicalizeClientValue('http://10.0.2.2:8080/uploads/img_1.png', { publicBucket }),
    '/uploads/img_1.png',
  );
});

test('URLs outside the public bucket are left as-is (and later rejected unless stored)', () => {
  for (const url of [
    'https://evil.example.com/x.png',
    'http://localhost:9000/grocery-private/licences/2026/09/x.webp', // private bucket
    'http://localhost:9000/grocery-public/../grocery-private/x.webp',
  ]) {
    assert.equal(canonicalizeClientValue(url, { publicBucket }), url, url);
  }
});

test('final keys are dated and use the generated id, never client input', () => {
  const key = finalObjectKey('products', 'abc', 'webp', new Date(Date.UTC(2026, 0, 5)));
  assert.equal(key, 'products/2026/01/abc.webp');
});
