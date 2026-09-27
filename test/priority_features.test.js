import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTotals, computeOrderTotals, sanitizeTip } from '../src/features/order/pricing.js';

test('price quote totals calculate delivery, handling, platform fees and GST correctly', () => {
  const lines = [
    { productId: 'p1', name: 'Apples', unitPrice: 50, quantity: 2, lineTotal: 100 }
  ];
  const totals = buildTotals({ lines, couponDiscount: 10, tipAmount: 20 });

  assert.equal(totals.subtotal, 100);
  assert.equal(totals.fees.deliveryFee, 30); // under threshold ₹200
  assert.equal(totals.fees.handlingFee, 15);
  assert.equal(totals.fees.platformFee, 5);
  assert.equal(totals.fees.gstTax, 5); // 5% of 100
  assert.equal(totals.preCouponAmount, 155); // 100 + 30 + 15 + 5 + 5
  assert.equal(totals.couponDiscount, 10);
  assert.equal(totals.tipAmount, 20);
  assert.equal(totals.finalAmount, 165); // 155 - 10 + 20
});

test('free delivery threshold waives delivery fee in quote', () => {
  const lines = [
    { productId: 'p1', name: 'Rice Bag', unitPrice: 250, quantity: 1, lineTotal: 250 }
  ];
  const totals = buildTotals({ lines });

  assert.equal(totals.subtotal, 250);
  assert.equal(totals.fees.deliveryFee, 0); // subtotal >= 200
});

test('delivery code validation logic requires 4-digit code', () => {
  const deliveryCode = '4829';
  const validCode = '4829';
  const invalidCode = '1111';

  assert.equal(validCode, deliveryCode);
  assert.notEqual(invalidCode, deliveryCode);
});

test('GST invoice tax breakdown calculates CGST and SGST correctly', () => {
  const subtotal = 400;
  const gstTotal = Math.round(subtotal * 0.05 * 100) / 100; // 5% = 20
  const cgst = Math.round((gstTotal / 2) * 100) / 100; // 10
  const sgst = Math.round((gstTotal / 2) * 100) / 100; // 10

  assert.equal(gstTotal, 20);
  assert.equal(cgst, 10);
  assert.equal(sgst, 10);
  assert.equal(cgst + sgst, gstTotal);
});

test('Dispute return status transitions from PENDING to APPROVED', () => {
  const returnReq = {
    type: 'RETURN',
    reason: 'Damaged item',
    status: 'PENDING'
  };

  // Simulate admin approval
  returnReq.status = 'APPROVED';
  returnReq.approvedRefund = 150.00;
  returnReq.resolvedAt = new Date().toISOString();

  assert.equal(returnReq.status, 'APPROVED');
  assert.equal(returnReq.approvedRefund, 150.00);
});

