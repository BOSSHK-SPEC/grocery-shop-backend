import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInvoicePdfBuffer } from '../../src/features/invoice/invoicePdfRenderer.js';
import { buildInvoiceLines, buildInvoiceTotals } from '../../src/features/invoice/invoicePricing.js';

test('renders a real PDF for a bill with items', async () => {
  const items = buildInvoiceLines([{ item: 'Rice 5kg', qty: 2, price: 200, disc: 0, total: 400 }]);
  const totals = buildInvoiceTotals(items);

  const buffer = await renderInvoicePdfBuffer({
    invoice: {
      invoiceNumber: 'INV-000001',
      issuedAt: new Date().toISOString(),
      status: 'Issued',
      customerName: 'Test Customer',
      customerMobile: '9999999999',
      items,
      subtotal: totals.subtotal,
      cgst: totals.cgst,
      sgst: totals.sgst,
      totalAmount: totals.grandTotal,
    },
    business: { businessName: 'Test Store', gstNumber: '29AAAAA0000A1Z5', storePhone: '9000000000' },
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.length > 500, 'a one-line invoice should still render a non-trivial PDF');
});

test('renders without throwing when there are no items (e.g. a free bill)', async () => {
  const buffer = await renderInvoicePdfBuffer({
    invoice: {
      invoiceNumber: 'INV-000002',
      issuedAt: new Date().toISOString(),
      status: 'Issued',
      customerName: 'Walk-in Customer',
      customerMobile: null,
      items: [],
      subtotal: 0,
      cgst: 0,
      sgst: 0,
      totalAmount: 0,
    },
    business: { businessName: 'Test Store' },
  });
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
});
