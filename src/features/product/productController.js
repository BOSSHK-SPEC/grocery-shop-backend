import { z } from 'zod';
import { Op } from 'sequelize';
import { Business, Product, ProductCategory } from '../../models/index.js';
import { saveBase64Image, resolveBusiness } from '../../utils/helpers.js';

export const getProductCategories = async (req, res, next) => {
  try {
    const categories = await ProductCategory.findAll();
    const formattedCategories = categories.map(cat => ({
      id: cat.id,
      catgory: cat.category // Map to "catgory" spelling expected by frontend model
    }));
    return res.status(200).json(formattedCategories);
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
      pricePerQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      pricePerQuantityUnit: z.string(),
      productName: z.string(),
      productThumbnail: z.array(z.string()),
      totalQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      totalQuantityUnit: z.string(),
      brandName: z.string().optional().nullable()
    });

    const { businessId } = req.params;
    const validatedData = schema.parse(req.body);

    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    // Save thumbnails (decodes and writes base64 strings to uploads directory)
    const savedThumbnails = [];
    for (const base64 of validatedData.productThumbnail) {
      const urlPath = await saveBase64Image(base64);
      if (urlPath) {
        savedThumbnails.push(urlPath);
      }
    }

    const productCode = `PROD-${Math.floor(100000 + Math.random() * 900000)}`;

    await Product.create({
      businessId: business.id, // Use resolved database UUID
      productCode,
      brandName: validatedData.brandName,
      productName: validatedData.productName,
      productThumbnail: savedThumbnails,
      price: validatedData.price,
      pricePerQuantity: validatedData.pricePerQuantity,
      pricePerQuantityUnit: validatedData.pricePerQuantityUnit,
      category: validatedData.category,
      totalQuantity: validatedData.totalQuantity,
      totalQuantityUnit: validatedData.totalQuantityUnit
    });

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
      pricePerQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val)).optional(),
      pricePerQuantityUnit: z.string().optional(),
      brandName: z.string().optional().nullable(),
      category: z.string().optional(),
      totalQuantity: z.union([z.number(), z.string()]).transform(val => parseFloat(val)).optional(),
      totalQuantityUnit: z.string().optional()
    });
    const validatedData = schema.parse(req.body);

    // Update thumbnail if provided
    let savedThumbnails = product.productThumbnail || [];
    if (validatedData.productThumbnail) {
      savedThumbnails = [];
      for (const base64 of validatedData.productThumbnail) {
        if (base64.startsWith('data:image')) {
          const urlPath = await saveBase64Image(base64);
          savedThumbnails.push(urlPath);
        } else {
          savedThumbnails.push(base64);
        }
      }
    }

    await product.update({
      brandName: validatedData.brandName !== undefined ? validatedData.brandName : product.brandName,
      productName: validatedData.productName !== undefined ? validatedData.productName : product.productName,
      productThumbnail: savedThumbnails,
      price: validatedData.price !== undefined ? validatedData.price : product.price,
      pricePerQuantity: validatedData.pricePerQuantity !== undefined ? validatedData.pricePerQuantity : product.pricePerQuantity,
      pricePerQuantityUnit: validatedData.pricePerQuantityUnit !== undefined ? validatedData.pricePerQuantityUnit : product.pricePerQuantityUnit,
      category: validatedData.category !== undefined ? validatedData.category : product.category,
      totalQuantity: validatedData.totalQuantity !== undefined ? validatedData.totalQuantity : product.totalQuantity,
      totalQuantityUnit: validatedData.totalQuantityUnit !== undefined ? validatedData.totalQuantityUnit : product.totalQuantityUnit
    });

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
