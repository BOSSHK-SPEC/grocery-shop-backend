import { Router } from 'express';
import { authGuard } from '../middleware/auth.js';
import {
  requestOtp,
  verifyOtp,
  login,
  getAllBusinessType,
  createProfile,
  getProductCategories,
  getAllProducts,
  createProduct,
  getOrders,
  createOrder,
  updateOrderStatus,
  getBills,
  getBillById,
  createBill,
  updateBill,
  deleteBill,
  getBusinessProfile,
  updateBusinessProfile,
  getBusinessAnalytics
} from '../controllers/apiController.js';

export const apiRouter = Router();

// Authentication
apiRouter.post('/otp', requestOtp);
apiRouter.post('/otp/valid', verifyOtp);
apiRouter.post('/auth/login', login);

// Businesses
apiRouter.get('/business/getAllBusinessType', authGuard, getAllBusinessType);
apiRouter.post('/business/createProfile', authGuard, createProfile);
apiRouter.get('/business/:businessId/profile', authGuard, getBusinessProfile);
apiRouter.put('/business/:businessId/profile', authGuard, updateBusinessProfile);
apiRouter.get('/business/:businessId/analytics', authGuard, getBusinessAnalytics);

// Orders
apiRouter.get('/business/:businessId/orders', authGuard, getOrders);
apiRouter.post('/business/:businessId/orders', authGuard, createOrder);
apiRouter.put('/business/:businessId/orders/:orderId/status', authGuard, updateOrderStatus);

// Billing
apiRouter.get('/business/:businessId/bills', authGuard, getBills);
apiRouter.get('/business/:businessId/bills/:billId', authGuard, getBillById);
apiRouter.post('/business/:businessId/bills', authGuard, createBill);
apiRouter.put('/business/:businessId/bills/:billId', authGuard, updateBill);
apiRouter.delete('/business/:businessId/bills/:billId', authGuard, deleteBill);

// Products
apiRouter.get('/product/:businessId/productCategory', authGuard, getProductCategories);
apiRouter.get('/product/:businessId/allProduct', authGuard, getAllProducts);
apiRouter.post('/product/:businessId', authGuard, createProduct);
