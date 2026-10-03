import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { requireBusinessOwner } from '../../middleware/access.js';
import {
  getBusinessInvoiceById,
  markInvoiceDelivered,
  getConsumerInvoices,
  getConsumerInvoiceById,
  getConsumerInvoiceByOrderId
} from './invoiceController.js';

export const invoiceRouter = Router();

invoiceRouter.get('/business/:businessId/invoices/:invoiceId', authGuard, requireBusinessOwner, getBusinessInvoiceById);
invoiceRouter.patch('/business/:businessId/invoices/:invoiceId/deliver', authGuard, requireBusinessOwner, markInvoiceDelivered);

invoiceRouter.get('/consumer/invoices', authGuard, getConsumerInvoices);
invoiceRouter.get('/consumer/invoices/:invoiceId', authGuard, getConsumerInvoiceById);
invoiceRouter.get('/consumer/orders/:orderId/invoice', authGuard, getConsumerInvoiceByOrderId);
