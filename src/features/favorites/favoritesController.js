import { z } from 'zod';
import { Favorite, Product } from '../../models/index.js';

const productIdParamSchema = z.object({ productId: z.string().uuid() });

// GET /consumer/favorites/ids — lightweight id set for heart-icon state across grids.
export const listFavoriteIds = async (req, res, next) => {
  try {
    const favorites = await Favorite.findAll({
      where: { userId: req.user.id },
      attributes: ['productId'],
    });
    return res.status(200).json({ productIds: favorites.map(f => f.productId) });
  } catch (error) {
    next(error);
  }
};

// GET /consumer/favorites — paginated, joined product data. Powers both the
// "Favorites" home rail (small limit, most-recent-first) and the standalone
// Favorites page (larger limit) — same shape as every other paginated list
// endpoint in this API (page/limit in, {data, metadata} shape out).
const MAX_LIMIT = 100;

export const listFavorites = async (req, res, next) => {
  try {
    const parsedPage = Math.max(1, parseInt(req.query.page) || 1);
    const parsedLimit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (parsedPage - 1) * parsedLimit;

    const { rows, count: totalItems } = await Favorite.findAndCountAll({
      where: { userId: req.user.id },
      include: [{ model: Product, as: 'product' }],
      order: [['createdAt', 'DESC']],
      limit: parsedLimit,
      offset,
    });

    return res.status(200).json({
      products: rows.map(r => r.product).filter(Boolean),
      metadata: {
        totalItems,
        totalPages: Math.ceil(totalItems / parsedLimit),
        currentPage: parsedPage,
        limit: parsedLimit,
      },
    });
  } catch (error) {
    next(error);
  }
};

// POST /consumer/favorites/:productId — idempotent add.
export const addFavorite = async (req, res, next) => {
  try {
    const { productId } = productIdParamSchema.parse(req.params);
    const product = await Product.findByPk(productId);
    if (!product) return res.status(404).json({ error: { message: 'Product not found' } });

    const [, created] = await Favorite.findOrCreate({
      where: { userId: req.user.id, productId },
      defaults: { userId: req.user.id, productId },
    });
    return res.status(created ? 201 : 200).json({ productId, favorited: true });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(200).json({ productId: req.params.productId, favorited: true });
    }
    next(error);
  }
};

// DELETE /consumer/favorites/:productId — idempotent remove.
export const removeFavorite = async (req, res, next) => {
  try {
    const { productId } = productIdParamSchema.parse(req.params);
    await Favorite.destroy({ where: { userId: req.user.id, productId } });
    return res.status(200).json({ productId, favorited: false });
  } catch (error) {
    next(error);
  }
};
