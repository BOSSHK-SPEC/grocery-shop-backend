import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getRoute, estimateRoute, _resetRoutingForTests } from '../../src/features/tracking/routing.js';

const A = { lat: 12.9716, lng: 77.5946 };
const B = { lat: 12.9856, lng: 77.6068 };

const realFetch = globalThis.fetch;
let calls;
const osrmOk = () => ({
  ok: true,
  json: async () => ({
    code: 'Ok',
    routes: [{ distance: 2100, duration: 420, geometry: { coordinates: [[77.5946, 12.9716], [77.6, 12.98], [77.6068, 12.9856]] } }]
  })
});

beforeEach(() => {
  _resetRoutingForTests();
  calls = 0;
  process.env.ROUTING_BASE_URL = 'http://osrm.test';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.ROUTING_BASE_URL;
});

test('road route is parsed into [lat,lng] points', async () => {
  globalThis.fetch = async () => { calls++; return osrmOk(); };
  const r = await getRoute(A, B);
  assert.equal(r.source, 'road');
  assert.deepEqual(r.points[0], [12.9716, 77.5946]);
  assert.equal(r.durationSeconds, 420);
});

test('identical requests are served from cache and concurrent ones are coalesced', async () => {
  globalThis.fetch = async () => { calls++; return osrmOk(); };
  await Promise.all([getRoute(A, B), getRoute(A, B), getRoute(A, B)]);
  await getRoute(A, B);
  assert.equal(calls, 1);
});

test('provider failure degrades to a flagged straight-line estimate', async () => {
  globalThis.fetch = async () => { throw new Error('boom'); };
  const r = await getRoute(A, B);
  assert.equal(r.source, 'estimate');
  assert.equal(r.points.length, 2);
  assert.ok(r.distanceMeters > 1000 && r.durationSeconds > 0);
});

test('non-Ok provider response is treated as a failure', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'NoRoute' }) });
  assert.equal((await getRoute(A, B)).source, 'estimate');
});

test('circuit breaker stops calling a failing provider', async () => {
  globalThis.fetch = async () => { calls++; throw new Error('down'); };
  for (let i = 0; i < 5; i++) await getRoute({ lat: 12.9 + i * 0.01, lng: 77.5 }, B);
  const before = calls;
  await getRoute({ lat: 13.5, lng: 77.5 }, B);
  assert.equal(calls, before);
});

test('unset provider in production never calls out', async () => {
  delete process.env.ROUTING_BASE_URL;
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  globalThis.fetch = async () => { calls++; return osrmOk(); };
  const r = await getRoute(A, B);
  process.env.NODE_ENV = env;
  assert.equal(calls, 0);
  assert.equal(r.source, 'estimate');
});

test('invalid points yield null instead of a request', async () => {
  globalThis.fetch = async () => { calls++; return osrmOk(); };
  assert.equal(await getRoute({ lat: 0, lng: 0 }, B), null);
  assert.equal(await getRoute(A, { lat: 999, lng: 1 }), null);
  assert.equal(calls, 0);
});

test('estimateRoute is symmetric-ish and positive', () => {
  const r = estimateRoute(A, B);
  assert.ok(r.distanceMeters > 0);
});
