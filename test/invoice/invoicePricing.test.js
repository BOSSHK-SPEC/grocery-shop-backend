import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceLines, buildInvoiceTotals } from '../../src/features/invoice/invoicePricing.js';

test('buildInvoiceLines computes CGST/SGST as half of the 5% GST rate each', () => {
  const rows = [{ productId: 'p1', item: 'Rice 5kg', qty: 2, price: 200, disc: 0, total: 400 }];
  const [line] = buildInvoiceLines(rows);

  assert.equal(line.taxableAmount, 400);
  assert.equal(line.cgst, 10); // 2.5% of 400
  assert.equal(line.sgst, 10);
  assert.equal(line.totalAmount, 420);
});

test('buildInvoiceLines falls back to qty*price-disc when the row carries no total', () => {
  const rows = [{ item: 'Loose item', qty: 3, price: 10, disc: 5 }];
  const [line] = buildInvoiceLines(rows);

  assert.equal(line.taxableAmount, 25); // 3*10 - 5
});

test('buildInvoiceLines tolerates a free-text row with no catalogue product', () => {
  const rows = [{ item: 'Hand-written entry', qty: 1, price: 50, disc: 0, total: 50 }];
  const [line] = buildInvoiceLines(rows);

  assert.equal(line.productId, null);
  assert.equal(line.name, 'Hand-written entry');
});

test('buildInvoiceTotals sums every line into one subtotal/tax/grand total', () => {
  const lines = buildInvoiceLines([
    { item: 'A', qty: 1, price: 100, disc: 0, total: 100 },
    { item: 'B', qty: 1, price: 200, disc: 0, total: 200 },
  ]);
  const totals = buildInvoiceTotals(lines);

  assert.equal(totals.subtotal, 300);
  assert.equal(totals.cgst, 7.5); // 2.5% of 300
  assert.equal(totals.sgst, 7.5);
  assert.equal(totals.totalGst, 15);
  assert.equal(totals.grandTotal, 315);
});

test('buildInvoiceTotals on an empty bill is all zeroes, not NaN', () => {
  const totals = buildInvoiceTotals(buildInvoiceLines([]));
  assert.deepEqual(totals, { subtotal: 0, cgst: 0, sgst: 0, totalGst: 0, grandTotal: 0 });
});
