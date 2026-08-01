import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import {
  listFavoriteIds,
  listFavorites,
  addFavorite,
  removeFavorite,
} from './favoritesController.js';

export const favoritesRouter = Router();

favoritesRouter.get('/consumer/favorites/ids', authGuard, listFavoriteIds);
favoritesRouter.get('/consumer/favorites', authGuard, listFavorites);
favoritesRouter.post('/consumer/favorites/:productId', authGuard, addFavorite);
favoritesRouter.delete('/consumer/favorites/:productId', authGuard, removeFavorite);
