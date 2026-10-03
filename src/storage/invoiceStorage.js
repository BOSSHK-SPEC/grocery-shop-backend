import { internalClient } from './client.js';
import { storageConfig } from './config.js';
import { makeRef, VISIBILITY } from './refs.js';
import { renderInvoicePdfBuffer } from '../features/invoice/invoicePdfRenderer.js';

export { toPrivateUrl } from './imageStorage.js';

/**
 * Renders and uploads one invoice's PDF, returning the `storage:private/...`
 * reference to save on `invoice.pdfKey`.
 *
 * Deliberately never called inside the DB transaction that creates the
 * invoice: rendering + an object-storage round trip are slow I/O that should
 * never hold a row lock, and a storage hiccup here must not roll back money
 * already taken or stock already adjusted. Callers run this best-effort
 * after their transaction commits (see billingController.js) and leave
 * `pdfKey` null on failure — `getOrRenderInvoicePdfUrl` below then retries on
 * the next read instead of the write having to.
 */
export async function generateAndStoreInvoicePdf(invoice, business) {
  const buffer = await renderInvoicePdfBuffer({ invoice, business });
  const key = `invoices/${invoice.businessId}/${invoice.id}.pdf`;
  const config = storageConfig();
  await internalClient().putObject(config.privateBucket, key, buffer, buffer.length, {
    'Content-Type': 'application/pdf',
    'Cache-Control': 'private, no-store',
  });
  return makeRef(VISIBILITY.PRIVATE, key);
}
