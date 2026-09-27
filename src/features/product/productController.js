import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Product, ProductCategory } from '../../models/index.js';
import { resolveBusiness } from '../../utils/helpers.js';
import { discardImages, replacedImages, resolveImageInputs } from '../../storage/imageStorage.js';
import { ALL_UNITS } from '../../config/categories.js';

export const getProductCategories = async (req, res, next) => {
  try {
    const categories = await ProductCategory.findAll({ order: [['displayOrder', 'ASC']] });
    const formattedCategories = categories.map(cat => ({
      id: cat.id,
      catgory: cat.category // Map to "catgory" spelling expected by frontend model
    }));
    return res.status(200).json(formattedCategories);
  } catch (error) {
    next(error);
  }
};

// Global category catalogue (not business-scoped) for the consumer app:
// full objects with icon + allowed quantity units, ordered for display.
export const getAllCategories = async (req, res, next) => {
  try {
    const categories = await ProductCategory.findAll({ order: [['displayOrder', 'ASC']] });
    const formatted = categories.map(cat => ({
      id: cat.id,
      category: cat.category,
      icon: cat.icon || '🛒',
      units: Array.isArray(cat.units) ? cat.units : [],
      displayOrder: cat.displayOrder,
    }));
    return res.status(200).json(formatted);
  } catch (error) {
    next(error);
  }
};

// Every quantity unit the product form may offer, independent of category.
// Served separately from /categories so the category payload keeps its shape
// and this list can be fetched once and cached by the client.
export const getAllUnits = async (req, res, next) => {
  try {
    return res.status(200).json(ALL_UNITS);
  } catch (error) {
    next(error);
  }
};

export const getAllProducts = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const products = await Product.findAll({ where: { businessId: business.id } });
    return res.status(200).json(products);
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const schema = z.object({
      category: z.string(),
      price: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      mrp: z.union([z.number(), z.string()]).optional().nullable().transform(val => (val === null || val === undefined || val === '') ? null : parseFloat(val) || null),
      pricePerQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      pricePerQuantityUnit: z.string(),
      productName: z.string(),
      productThumbnail: z.array(z.string()),
      totalQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      totalQuantityUnit: z.string(),
      brandName: z.string().optional().nullable(),
      inventoryCount: z.union([z.number(), z.string()]).transform(val => parseInt(val) || 0).optional()
    });

    const { businessId } = req.params;
    const validatedData = schema.parse(req.body);

    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    // Each entry is an "upload:<id>" from a direct upload (or base64 from an
    // older app). Resolving attaches it permanently; a bad image is a 400
    // here rather than a product silently saved without its photo.
    const savedThumbnails = await resolveImageInputs(validatedData.productThumbnail, {
      purpose: 'product',
      userId: req.user.id,
    });

    const productCode = `PROD-${Math.floor(100000 + Math.random() * 900000)}`;

    try {
      await Product.create({
        businessId: business.id, // Use resolved database UUID
        productCode,
        brandName: validatedData.brandName,
        productName: validatedData.productName,
        productThumbnail: savedThumbnails,
        price: validatedData.price,
        mrp: validatedData.mrp,
        pricePerQuantity: validatedData.pricePerQuantity,
        pricePerQuantityUnit: validatedData.pricePerQuantityUnit,
        category: validatedData.category,
        totalQuantity: validatedData.totalQuantity,
        totalQuantityUnit: validatedData.totalQuantityUnit,
        inventoryCount: validatedData.inventoryCount || 0
      });
    } catch (error) {
      // The photos are already stored; without the product they are orphans.
      await discardImages(savedThumbnails);
      throw error;
    }

    return res.status(202).json('success');
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const { businessId, productId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const product = await Product.findOne({
      where: { id: productId, businessId: business.id }
    });
    if (!product) {
      return res.status(404).json({ error: { message: 'Product not found' } });
    }

    const schema = z.object({
      productName: z.string().optional(),
      productThumbnail: z.array(z.string()).optional(),
      price: z.union([z.number(), z.string()]).transform(val => parseFloat(val)).optional(),
      // Key absent -> undefined (leave mrp unchanged, per the `!== undefined`
      // check below). Explicit null/'' -> clears mrp. A number -> sets it.
      mrp: z.union([z.number(), z.string()]).nullable().optional().transform(
        val => val === undefined ? undefined : (val === null || val === '') ? null : (parseFloat(val) || null)
      ),
      pricePerQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val)).optional(),
      pricePerQuantityUnit: z.string().optional(),
      brandName: z.string().optional().nullable(),
      category: z.string().optional(),
      totalQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val)).optional(),
      totalQuantityUnit: z.string().optional(),
      inventoryCount: z.union([z.number(), z.string()]).transform(val => parseInt(val)).optional()
    });
    const validatedData = schema.parse(req.body);

    // Stored references, not the URLs the getter would return — reading
    // product.productThumbnail here would write URLs back into the row.
    const previousThumbnails = product.getDataValue('productThumbnail') || [];
    let savedThumbnails = previousThumbnails;
    if (validatedData.productThumbnail) {
      // Unchanged photos come back as the URLs the client was given; those
      // resolve to the stored references. New ones are uploads to attach.
      savedThumbnails = await resolveImageInputs(validatedData.productThumbnail, {
        purpose: 'product',
        userId: req.user.id,
        current: previousThumbnails,
      });
    }
    const newlyStored = replacedImages(savedThumbnails, previousThumbnails);

    try {
      await product.update({
        brandName: validatedData.brandName !== undefined ? validatedData.brandName : product.brandName,
        productName: validatedData.productName !== undefined ? validatedData.productName : product.productName,
        productThumbnail: savedThumbnails,
        price: validatedData.price !== undefined ? validatedData.price : product.price,
        mrp: validatedData.mrp !== undefined ? validatedData.mrp : product.mrp,
        pricePerQuantity: validatedData.pricePerQuantity !== undefined ? validatedData.pricePerQuantity : product.pricePerQuantity,
        pricePerQuantityUnit: validatedData.pricePerQuantityUnit !== undefined ? validatedData.pricePerQuantityUnit : product.pricePerQuantityUnit,
        category: validatedData.category !== undefined ? validatedData.category : product.category,
        totalQuantity: validatedData.totalQuantity !== undefined ? validatedData.totalQuantity : product.totalQuantity,
        totalQuantityUnit: validatedData.totalQuantityUnit !== undefined ? validatedData.totalQuantityUnit : product.totalQuantityUnit,
        inventoryCount: validatedData.inventoryCount !== undefined ? validatedData.inventoryCount : product.inventoryCount
      });
    } catch (error) {
      await discardImages(newlyStored);
      throw error;
    }
    // Only once the row points at the new photos is the old one safe to drop.
    await discardImages(replacedImages(previousThumbnails, savedThumbnails));

    return res.status(200).json(product);
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const { businessId, productId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const product = await Product.findOne({
      where: { id: productId, businessId: business.id }
    });
    if (!product) {
      return res.status(404).json({ error: { message: 'Product not found' } });
    }

    await product.destroy();
    return res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getProductsAcrossBusinesses = async (req, res, next) => {
  try {
    const { category, search, q, minPrice, maxPrice, inStockOnly, sortBy, page, limit } = req.query;
    const searchTerm = (search || q || '').trim();
    const where = {};

    if (category) {
      where.category = category;
    }
    if (searchTerm) {
      where[Op.or] = [
        { productName: { [Op.like]: `%${searchTerm}%` } },
        { brandName: { [Op.like]: `%${searchTerm}%` } }
      ];
    }
    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price[Op.gte] = parseFloat(minPrice);
      if (maxPrice) where.price[Op.lte] = parseFloat(maxPrice);
    }
    if (inStockOnly === 'true' || inStockOnly === '1') {
      where.inventoryCount = { [Op.gt]: 0 };
    }

    let order = [['createdAt', 'DESC']];
    if (sortBy === 'price_asc') order = [['price', 'ASC']];
    if (sortBy === 'price_desc') order = [['price', 'DESC']];
    if (sortBy === 'name') order = [['productName', 'ASC']];
    if (sortBy === 'newest') order = [['createdAt', 'DESC']];

    if (page || limit) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 20;
      const offset = (pageNum - 1) * limitNum;

      const { count, rows } = await Product.findAndCountAll({
        where,
        order,
        limit: limitNum,
        offset,
        include: [{ model: Business, as: 'business', attributes: ['businessName', 'id'] }]
      });

      return res.status(200).json({
        products: rows,
        pagination: {
          totalCount: count,
          totalPages: Math.ceil(count / limitNum),
          currentPage: pageNum,
          limit: limitNum
        }
      });
    }

    const products = await Product.findAll({
      where,
      order,
      include: [{ model: Business, as: 'business', attributes: ['businessName', 'id'] }]
    });
    return res.status(200).json(products);
  } catch (error) {
    next(error);
  }
};

