import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import {
  getProductCategories,
  getAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsAcrossBusinesses
} from './productController.js';

export const productRouter = Router();

productRouter.get('/product', authGuard, getProductsAcrossBusinesses);
productRouter.get('/product/:businessId/productCategory', authGuard, getProductCategories);
productRouter.get('/product/:businessId/allProduct', authGuard, getAllProducts);
productRouter.post('/product/:businessId', authGuard, createProduct);
productRouter.put('/product/:businessId/:productId', authGuard, updateProduct);
productRouter.delete('/product/:businessId/:productId', authGuard, deleteProduct);
