import PDFDocument from 'pdfkit';

const RUPEE = (n) => `Rs. ${Number(n || 0).toFixed(2)}`;

/**
 * Renders one invoice to a PDF buffer. Pure w.r.t. the outside world (no
 * network, no storage) — it only touches the pdfkit stream it creates, so it
 * can be unit-tested by checking the bytes it returns. The caller (see
 * `src/storage/invoiceStorage.js`) is the one that decides where this buffer
 * goes.
 */
export function renderInvoicePdfBuffer({ invoice, business }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc
      .fontSize(18)
      .text(business?.businessName || 'GroZerry Store', { continued: false })
      .fontSize(9)
      .fillColor('#555')
      .text(`GSTIN: ${business?.gstNumber || 'Not registered'}`)
      .text(business?.storePhone ? `Phone: ${business.storePhone}` : '')
      .fillColor('#000')
      .moveDown(1.2);

    doc
      .fontSize(14)
      .text('TAX INVOICE', { align: 'right' })
      .fontSize(10)
      .text(`Invoice No: ${invoice.invoiceNumber}`, { align: 'right' })
      .text(`Date: ${new Date(invoice.issuedAt).toLocaleDateString('en-IN')}`, { align: 'right' })
      .text(`Status: ${invoice.status}`, { align: 'right' })
      .moveDown(1);

    doc
      .fontSize(11)
      .text('Billed to:')
      .fontSize(10)
      .text(invoice.customerName || 'Walk-in customer')
      .text(invoice.customerMobile || '')
      .moveDown(1);

    const items = invoice.items || [];
    const tableTop = doc.y;
    // Weighted shares of the usable page width, not fixed point widths —
    // fixed widths here previously summed to more than an A4 page's usable
    // width (560pt of columns in ~495pt of room), clipping the Total column
    // off the right edge of every rendered invoice.
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const weights = [
      { key: 'name', label: 'Item', weight: 0.3, align: 'left' },
      { key: 'quantity', label: 'Qty', weight: 0.08, align: 'right' },
      { key: 'unitPrice', label: 'Rate', weight: 0.14, align: 'right' },
      { key: 'taxableAmount', label: 'Taxable', weight: 0.15, align: 'right' },
      { key: 'cgst', label: 'CGST', weight: 0.11, align: 'right' },
      { key: 'sgst', label: 'SGST', weight: 0.11, align: 'right' },
      { key: 'totalAmount', label: 'Total', weight: 0.11, align: 'right' },
    ];
    const columns = weights.map(col => ({ ...col, width: usableWidth * col.weight }));
    let x = doc.page.margins.left;
    doc.fontSize(9).font('Helvetica-Bold');
    for (const col of columns) {
      doc.text(col.label, x, tableTop, { width: col.width, align: col.align });
      x += col.width;
    }
    doc.font('Helvetica').moveDown(0.3);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#ccc')
      .stroke();
    doc.moveDown(0.3);

    for (const item of items) {
      const rowTop = doc.y;
      x = doc.page.margins.left;
      const values = {
        name: item.name,
        quantity: String(item.quantity),
        unitPrice: RUPEE(item.unitPrice),
        taxableAmount: RUPEE(item.taxableAmount),
        cgst: RUPEE(item.cgst),
        sgst: RUPEE(item.sgst),
        totalAmount: RUPEE(item.totalAmount),
      };
      for (const col of columns) {
        doc.text(values[col.key], x, rowTop, { width: col.width, align: col.align });
        x += col.width;
      }
      doc.moveDown(0.3);
    }

    doc.moveDown(0.6);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor('#ccc')
      .stroke();
    doc.moveDown(0.6);

    const totalsX = doc.page.width - doc.page.margins.right - 220;
    const line = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10);
      doc.text(label, totalsX, doc.y, { width: 140, continued: true, align: 'left' });
      doc.text(value, { width: 80, align: 'right' });
    };
    line('Subtotal', RUPEE(invoice.subtotal));
    line('CGST', RUPEE(invoice.cgst));
    line('SGST', RUPEE(invoice.sgst));
    line('Grand Total', RUPEE(invoice.totalAmount), true);

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .fillColor('#777')
      .text('This is a system-generated invoice.', doc.page.margins.left, doc.y, { align: 'center' });

    doc.end();
  });
}
