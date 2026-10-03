import { PRICING_RULES, round2 } from '../order/pricing.js';

// Same GST rate and rounding rule as online orders (`order/pricing.js`), so a
// walk-in bill and an app order are taxed identically — one invoice format,
// two sources. CGST/SGST split in half, as intra-state GST requires.

/**
 * Builds the invoice's line items and tax breakdown from a bill's raw `rows`
 * (`{ item, qty, price, disc, total }`, as written by the Selling app — see
 * `selling_dtos.dart`). Pure and unit-testable: no I/O, no model access.
 */
export function buildInvoiceLines(rows) {
  return (rows || []).map((row) => {
    const qty = Number(row?.qty) || 0;
    const price = Number(row?.price) || 0;
    const discount = Number(row?.disc) || 0;
    const taxableAmount = round2(row?.total !== undefined ? Number(row.total) : qty * price - discount);
    const gst = round2(taxableAmount * PRICING_RULES.GST_RATE);
    return {
      productId: row?.productId ?? null,
      name: row?.item ?? '',
      quantity: qty,
      unitPrice: price,
      discount,
      taxableAmount,
      cgst: round2(gst / 2),
      sgst: round2(gst / 2),
      totalAmount: round2(taxableAmount + gst),
    };
  });
}

/** Subtotal + CGST/SGST split + grand total, from already-built line items. */
export function buildInvoiceTotals(lines) {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.taxableAmount, 0));
  const cgst = round2(lines.reduce((sum, l) => sum + l.cgst, 0));
  const sgst = round2(lines.reduce((sum, l) => sum + l.sgst, 0));
  return {
    subtotal,
    cgst,
    sgst,
    totalGst: round2(cgst + sgst),
    grandTotal: round2(subtotal + cgst + sgst),
  };
}
