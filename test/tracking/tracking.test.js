import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { phaseFor, roleOnOrder } from '../../src/features/tracking/trackingService.js';
import * as hub from '../../src/features/tracking/trackingHub.js';
import { pointFrom, isValidPoint } from '../../src/features/tracking/geo.js';

const fakeWs = () => {
  const sent = [];
  return { readyState: 1, sent, send: (m) => sent.push(JSON.parse(m)) };
};

beforeEach(() => hub._resetHubForTests());

test('phase follows status and rider assignment', () => {
  assert.equal(phaseFor('Pending', false), 'preparing');
  assert.equal(phaseFor('Packing', false), 'preparing');
  assert.equal(phaseFor('Packed', false), 'preparing');
  assert.equal(phaseFor('Packed', true), 'rider_to_store');
  assert.equal(phaseFor('OutForDelivery', true), 'to_customer');
  assert.equal(phaseFor('Delivered', true), 'done');
  assert.equal(phaseFor('Cancelled', false), 'done');
  assert.equal(phaseFor('Shipped', true), 'to_customer'); // legacy value
});

test('only people on the order may track it', () => {
  const order = { customerId: 'c1', deliveryPartnerId: 'r1', Business: { ownerId: 'm1' } };
  assert.equal(roleOnOrder(order, { id: 'c1' }, 'consumer'), 'customer');
  assert.equal(roleOnOrder(order, { id: 'r1' }, 'delivery'), 'rider');
  assert.equal(roleOnOrder(order, { id: 'm1' }, 'merchant'), 'merchant');
  assert.equal(roleOnOrder(order, { id: 'x' }, 'admin'), 'admin');
  assert.equal(roleOnOrder(order, { id: 'stranger' }, 'consumer'), null);
  assert.equal(roleOnOrder(order, { id: 'stranger' }, 'delivery'), null);
  assert.equal(roleOnOrder(null, { id: 'c1' }, 'consumer'), null);
});

test('an unassigned order does not match a user with an undefined id', () => {
  const order = { customerId: null, deliveryPartnerId: null, Business: { ownerId: null } };
  assert.equal(roleOnOrder(order, { id: undefined }, 'consumer'), null);
});

test('publish reaches only that order\'s subscribers', () => {
  const a = fakeWs();
  const b = fakeWs();
  hub.subscribe('o1', a);
  hub.subscribe('o2', b);
  hub.publish('o1', { type: 'x' });
  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 0);
});

test('unsubscribeAll clears a socket everywhere', () => {
  const a = fakeWs();
  hub.subscribe('o1', a);
  hub.subscribe('o2', a);
  hub.unsubscribeAll(a);
  assert.equal(hub.hasAnySubscribers(), false);
});

test('a socket cannot exceed the subscription cap', () => {
  const a = fakeWs();
  for (let i = 0; i < hub.MAX_SUBSCRIPTIONS_PER_SOCKET; i++) assert.ok(hub.subscribe(`o${i}`, a));
  assert.equal(hub.subscribe('extra', a), false);
  assert.ok(hub.subscribe('o0', a)); // re-subscribing an existing one is fine
});

test('closeRoom stops delivery', () => {
  const a = fakeWs();
  hub.subscribe('o1', a);
  hub.closeRoom('o1');
  hub.publish('o1', { type: 'x' });
  assert.equal(a.sent.length, 0);
});

test('closed sockets are skipped', () => {
  const a = fakeWs();
  a.readyState = 3;
  hub.subscribe('o1', a);
  hub.publish('o1', { type: 'x' });
  assert.equal(a.sent.length, 0);
});

test('rider location is remembered and expires', () => {
  hub.setRiderLocation('r1', { lat: 1, lng: 2, at: Date.now() });
  assert.deepEqual(hub.getRiderLocation('r1').lat, 1);
  hub.setRiderLocation('r2', { lat: 1, lng: 2, at: Date.now() - 11 * 60 * 1000 });
  assert.equal(hub.getRiderLocation('r2'), null);
});

test('geo rejects bad and placeholder coordinates', () => {
  assert.equal(pointFrom({ latitude: '12.97', longitude: '77.59' }).lat, 12.97);
  assert.equal(pointFrom({ latitude: 0, longitude: 0 }), null);
  assert.equal(pointFrom({ latitude: null, longitude: null }), null);
  assert.equal(pointFrom(null), null);
  assert.equal(isValidPoint({ lat: 91, lng: 0 }), false);
});
