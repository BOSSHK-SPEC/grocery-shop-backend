import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { requireBusinessOwner } from '../../middleware/access.js';
import {
  getProductCategories,
  getAllCategories,
  getAllUnits,
  getAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductsAcrossBusinesses
} from './productController.js';

export const productRouter = Router();

productRouter.get('/categories', authGuard, getAllCategories);
productRouter.get('/units', authGuard, getAllUnits);
productRouter.get('/product', authGuard, getProductsAcrossBusinesses);
productRouter.get('/product/:businessId/productCategory', authGuard, getProductCategories);
productRouter.get('/product/:businessId/allProduct', authGuard, getAllProducts);
productRouter.post('/product/:businessId', authGuard, requireBusinessOwner, createProduct);
productRouter.put('/product/:businessId/:productId', authGuard, requireBusinessOwner, updateProduct);
productRouter.delete('/product/:businessId/:productId', authGuard, requireBusinessOwner, deleteProduct);
