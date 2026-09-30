import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewScopeWhere, canReviewUser } from '../../src/utils/reviewScope.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

test('super admin reviews every registration, standalone shops included', () => {
  assert.deepEqual(reviewScopeWhere({ role: 'super_admin' }, 'super_admin'), {});
  for (const tenantId of [T1, T2, null]) {
    assert.equal(canReviewUser({ role: 'super_admin' }, 'super_admin', { tenantId }), true);
  }
});

test('a franchise admin is confined to their own tenant', () => {
  const actor = { role: 'admin', tenantId: T1 };
  assert.deepEqual(reviewScopeWhere(actor, 'admin'), { tenantId: T1 });
  assert.equal(canReviewUser(actor, 'admin', { tenantId: T1 }), true);
  assert.equal(canReviewUser(actor, 'admin', { tenantId: T2 }), false);
});

test('standalone registrations belong to the super admin, never to an admin', () => {
  const franchiseAdmin = { role: 'admin', tenantId: T1 };
  // A standalone rider has no tenant; a standalone shop has a brand-new one.
  assert.equal(canReviewUser(franchiseAdmin, 'admin', { tenantId: null }), false);
  assert.equal(canReviewUser(franchiseAdmin, 'admin', { tenantId: T2 }), false);
});

test('an admin with no franchise has no scope at all', () => {
  const actor = { role: 'admin', tenantId: null };
  assert.deepEqual(reviewScopeWhere(actor, 'admin'), { id: null });
  assert.equal(canReviewUser(actor, 'admin', { tenantId: null }), false);
  assert.equal(canReviewUser(actor, 'admin', { tenantId: T1 }), false);
});
