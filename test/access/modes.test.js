import test from 'node:test';
import assert from 'node:assert/strict';
import {
  modesOf, withModeStatus, applyReviewDecision, legacyFieldsForApplication, ModeStatus, isModeActive
} from '../../src/utils/modes.js';
import { requireMode } from '../../src/middleware/access.js';

const user = (over = {}) => ({ id: 'u1', role: 'consumer', status: 'ACTIVE', misc: { businessId: [] }, ...over });

test('a plain shopper can only shop', () => {
  const m = modesOf(user());
  assert.equal(m.shopping.status, ModeStatus.ACTIVE);
  assert.equal(m.selling.status, ModeStatus.NOT_STARTED);
  assert.equal(m.delivering.status, ModeStatus.NOT_STARTED);
});

test('legacy accounts keep working without misc.modes', () => {
  assert.equal(modesOf(user({ role: 'delivery', status: 'ACTIVE' })).delivering.status, ModeStatus.ACTIVE);
  assert.equal(modesOf(user({ role: 'merchant', status: 'PENDING_APPROVAL', misc: { businessId: ['b1'] } })).selling.status, ModeStatus.PENDING);
  // Approved standalone merchants were promoted to admin.
  assert.equal(modesOf(user({ role: 'admin', misc: { businessId: ['b1'] } })).selling.status, ModeStatus.ACTIVE);
});

test('an approved rider who applies to sell keeps delivering', () => {
  const rider = user({ role: 'delivery', status: 'ACTIVE', misc: withModeStatus({ businessId: [] }, 'delivering', ModeStatus.ACTIVE) });
  const legacy = legacyFieldsForApplication(rider, 'selling');
  assert.equal(legacy.role, 'delivery', 'role is not overwritten');
  rider.role = legacy.role;
  rider.status = legacy.status;
  rider.misc = withModeStatus({ ...rider.misc, businessId: ['b1'] }, 'selling', ModeStatus.PENDING);
  const m = modesOf(rider);
  assert.equal(m.delivering.status, ModeStatus.ACTIVE);
  assert.equal(m.selling.status, ModeStatus.PENDING);
  assert.ok(isModeActive(rider, 'delivering'));
});

test('approval decides only the modes waiting for review', () => {
  let misc = withModeStatus({ businessId: ['b1'] }, 'delivering', ModeStatus.REJECTED);
  misc = withModeStatus(misc, 'selling', ModeStatus.PENDING);
  const approved = applyReviewDecision(misc, 'approve');
  assert.equal(approved.modes.selling.status, ModeStatus.ACTIVE);
  assert.equal(approved.modes.delivering.status, ModeStatus.REJECTED);
  assert.equal(applyReviewDecision(misc, 'reject').modes.selling.status, ModeStatus.REJECTED);
});

test('selling needs a store even if a status was recorded', () => {
  const u = user({ misc: withModeStatus({ businessId: [] }, 'selling', ModeStatus.ACTIVE) });
  assert.equal(modesOf(u).selling.status, ModeStatus.NOT_STARTED);
});

test('admins are never demoted by an application', () => {
  assert.equal(legacyFieldsForApplication(user({ role: 'admin' }), 'delivering').role, 'admin');
  assert.equal(legacyFieldsForApplication(user({ role: 'consumer' }), 'delivering').role, 'delivery');
});

function run(mw, req) {
  let status = 200; let body; let nextCalled = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  mw(req, res, () => { nextCalled = true; });
  return { status, body, nextCalled };
}

test('rider-only endpoints refuse shoppers and pending riders', () => {
  const guard = requireMode('delivering');
  assert.equal(run(guard, { user: user() }).status, 403);
  assert.equal(run(guard, { user: user({ role: 'delivery', status: 'PENDING_APPROVAL' }) }).status, 403);
  assert.ok(run(guard, { user: user({ role: 'delivery', status: 'ACTIVE' }) }).nextCalled);
  assert.ok(run(guard, { user: user({ role: 'admin' }), userRole: 'admin' }).nextCalled);
  assert.equal(run(guard, { user: user() }).body.error.code, 'MODE_NOT_ACTIVE');
});

import { pendingModes, statusForView, legacyStatusAfterReview } from '../../src/utils/modes.js';

const both = () => user({
  role: 'merchant',
  status: 'PENDING_APPROVAL',
  misc: withModeStatus(withModeStatus({ businessId: ['b1'] }, 'selling', ModeStatus.PENDING), 'delivering', ModeStatus.PENDING),
});

test('a seller who also applied to ride has both applications listed', () => {
  assert.deepEqual(pendingModes(both()), ['selling', 'delivering']);
  // Legacy rows without misc.modes still surface as one application.
  assert.deepEqual(pendingModes(user({ role: 'delivery', status: 'PENDING_APPROVAL' })), ['delivering']);
});

test('a decision can be limited to one application', () => {
  const u = both();
  const misc = applyReviewDecision(u.misc, 'approve', 'delivering');
  assert.equal(misc.modes.delivering.status, ModeStatus.ACTIVE);
  assert.equal(misc.modes.selling.status, ModeStatus.PENDING, 'the seller application is untouched');
  // Without a mode every pending application is decided, as before.
  const all = applyReviewDecision(u.misc, 'reject');
  assert.equal(all.modes.selling.status, ModeStatus.REJECTED);
  assert.equal(all.modes.delivering.status, ModeStatus.REJECTED);
});

test('the account stays in the approvals list until every application is decided', () => {
  const u = both();
  u.misc = applyReviewDecision(u.misc, 'approve', 'delivering');
  assert.equal(legacyStatusAfterReview(u), ModeStatus.PENDING);
  u.misc = applyReviewDecision(u.misc, 'reject', 'selling');
  assert.equal(legacyStatusAfterReview(u), ModeStatus.ACTIVE, 'a rejection never locks out a working mode');
  const rejectedOnly = user({ misc: withModeStatus({ businessId: ['b1'] }, 'selling', ModeStatus.REJECTED) });
  assert.equal(legacyStatusAfterReview(rejectedOnly), ModeStatus.REJECTED);
});

test('each list shows the status of its own application', () => {
  const u = both();
  u.misc = applyReviewDecision(u.misc, 'approve', 'delivering');
  assert.equal(statusForView(u, 'delivering'), ModeStatus.ACTIVE);
  assert.equal(statusForView(u, 'selling'), ModeStatus.PENDING);
  // Falls back to the legacy status when the mode cannot be derived.
  assert.equal(statusForView(user({ role: 'merchant', status: 'ACTIVE', misc: { businessId: [] } }), 'selling'), 'ACTIVE');
});
