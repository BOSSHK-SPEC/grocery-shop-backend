import { z } from 'zod';
import { Address } from '../../models/index.js';

const addressSchema = z.object({
  label: z.string().optional().nullable(),
  line1: z.string(),
  line2: z.string().optional().nullable(),
  locality: z.string(),
  landmark: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  pinCode: z.union([z.number(), z.string()]).transform(v => parseInt(v) || 0),
  latitude: z.union([z.number(), z.string()]).optional().nullable().transform(v => (v ? parseFloat(v) : null)),
  longitude: z.union([z.number(), z.string()]).optional().nullable().transform(v => (v ? parseFloat(v) : null)),
  isDefault: z.boolean().optional(),
});

// GET /consumer/addresses — list the signed-in user's addresses, default first.
export const listAddresses = async (req, res, next) => {
  try {
    const addresses = await Address.findAll({
      where: { userId: req.user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'ASC']],
    });
    return res.status(200).json(addresses);
  } catch (error) {
    next(error);
  }
};

// POST /consumer/addresses — add an address (first one, or isDefault, becomes default).
export const createAddress = async (req, res, next) => {
  try {
    const data = addressSchema.parse(req.body);
    const count = await Address.count({ where: { userId: req.user.id } });
    const makeDefault = data.isDefault === true || count === 0;
    if (makeDefault) {
      await Address.update({ isDefault: false }, { where: { userId: req.user.id } });
    }
    const address = await Address.create({ userId: req.user.id, ...data, isDefault: makeDefault });
    return res.status(201).json(address);
  } catch (error) {
    next(error);
  }
};

// PUT /consumer/addresses/:id — update an address.
export const updateAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const data = addressSchema.partial().parse(req.body);
    const address = await Address.findOne({ where: { id, userId: req.user.id } });
    if (!address) return res.status(404).json({ error: { message: 'Address not found' } });
    if (data.isDefault === true) {
      await Address.update({ isDefault: false }, { where: { userId: req.user.id } });
    }
    await address.update(data);
    return res.status(200).json(address);
  } catch (error) {
    next(error);
  }
};

// DELETE /consumer/addresses/:id — remove an address, promoting another to default if needed.
export const deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const address = await Address.findOne({ where: { id, userId: req.user.id } });
    if (!address) return res.status(404).json({ error: { message: 'Address not found' } });
    const wasDefault = address.isDefault;
    await address.destroy();
    if (wasDefault) {
      const fallback = await Address.findOne({
        where: { userId: req.user.id },
        order: [['createdAt', 'ASC']],
      });
      if (fallback) await fallback.update({ isDefault: true });
    }
    return res.status(200).json({ message: 'Address deleted' });
  } catch (error) {
    next(error);
  }
};

// PUT /consumer/addresses/:id/default — mark one address as the default.
export const setDefaultAddress = async (req, res, next) => {
  try {
    const { id } = req.params;
    const address = await Address.findOne({ where: { id, userId: req.user.id } });
    if (!address) return res.status(404).json({ error: { message: 'Address not found' } });
    await Address.update({ isDefault: false }, { where: { userId: req.user.id } });
    await address.update({ isDefault: true });
    return res.status(200).json(address);
  } catch (error) {
    next(error);
  }
};
