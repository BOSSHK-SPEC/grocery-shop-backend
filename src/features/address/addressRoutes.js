import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from './addressController.js';

export const addressRouter = Router();

addressRouter.get('/consumer/addresses', authGuard, listAddresses);
addressRouter.post('/consumer/addresses', authGuard, createAddress);
addressRouter.put('/consumer/addresses/:id', authGuard, updateAddress);
addressRouter.delete('/consumer/addresses/:id', authGuard, deleteAddress);
addressRouter.put('/consumer/addresses/:id/default', authGuard, setDefaultAddress);
