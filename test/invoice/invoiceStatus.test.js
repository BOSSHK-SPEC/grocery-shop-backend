import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceStatus, canTransition, labelFor, normalizeStatus } from '../../src/features/invoice/invoiceStatus.js';

test('a walk-in bill can be marked delivered straight from Issued', () => {
  assert.equal(canTransition(InvoiceStatus.ISSUED, InvoiceStatus.DELIVERED), true);
});

test('a bill the seller chose to deliver later can move to OutForDelivery first', () => {
  assert.equal(canTransition(InvoiceStatus.ISSUED, InvoiceStatus.OUT_FOR_DELIVERY), true);
  assert.equal(canTransition(InvoiceStatus.OUT_FOR_DELIVERY, InvoiceStatus.DELIVERED), true);
});

test('Delivered and Cancelled are terminal: nothing transitions out of them', () => {
  assert.equal(canTransition(InvoiceStatus.DELIVERED, InvoiceStatus.CANCELLED), false);
  assert.equal(canTransition(InvoiceStatus.DELIVERED, InvoiceStatus.ISSUED), false);
  assert.equal(canTransition(InvoiceStatus.CANCELLED, InvoiceStatus.DELIVERED), false);
});

test('an unknown/missing status normalizes to Issued rather than crashing', () => {
  assert.equal(normalizeStatus(undefined), InvoiceStatus.ISSUED);
  assert.equal(normalizeStatus('Bogus'), InvoiceStatus.ISSUED);
});

test('labelFor gives the customer-facing word for each status', () => {
  assert.equal(labelFor(InvoiceStatus.ISSUED), 'Billed');
  assert.equal(labelFor(InvoiceStatus.DELIVERED), 'Delivered');
});
