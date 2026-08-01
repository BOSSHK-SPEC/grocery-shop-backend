import { z } from 'zod';
import { Op } from 'sequelize';
import { Coupon, Order } from '../../models/index.js';

/// Recomputes a coupon's discount for a given subtotal — the single source
/// of truth used by both /consumer/coupons/validate and order creation, so
/// a client can never just submit an arbitrary discount amount. Returns
/// { ok: true, discount } or { ok: false, message }.
export async function resolveCouponDiscount({ code, userId, businessId, subtotal }) {
  if (!code) return { ok: false, message: 'No coupon code provided.' };

  const coupon = await Coupon.findOne({ where: { code: code.trim().toUpperCase() } });
  if (!coupon || !coupon.isActive) {
    return { ok: false, message: 'This coupon is not valid.' };
  }
  if (coupon.businessId && coupon.businessId !== businessId) {
    return { ok: false, message: 'This coupon is not valid for this store.' };
  }
  const now = new Date();
  if (coupon.validFrom && now < new Date(coupon.validFrom)) {
    return { ok: false, message: 'This coupon is not active yet.' };
  }
  if (coupon.validUntil && now > new Date(coupon.validUntil)) {
    return { ok: false, message: 'This coupon has expired.' };
  }
  if (Number(subtotal) < Number(coupon.minOrderValue)) {
    const more = (Number(coupon.minOrderValue) - Number(subtotal)).toFixed(0);
    return { ok: false, message: `Shop for ₹${more} more to use this coupon.` };
  }

  if (coupon.usageLimit != null) {
    const totalUses = await Order.count({ where: { couponCode: coupon.code } });
    if (totalUses >= coupon.usageLimit) {
      return { ok: false, message: 'This coupon has been fully redeemed.' };
    }
  }
  if (userId) {
    const userUses = await Order.count({ where: { couponCode: coupon.code, customerId: userId } });
    if (userUses >= coupon.perUserLimit) {
      return { ok: false, message: 'You have already used this coupon.' };
    }
  }

  let discount = coupon.discountType === 'percentage'
    ? (Number(subtotal) * Number(coupon.discountValue)) / 100
    : Number(coupon.discountValue);
  if (coupon.discountType === 'percentage' && coupon.maxDiscount != null) {
    discount = Math.min(discount, Number(coupon.maxDiscount));
  }
  discount = Math.min(discount, Number(subtotal));
  discount = Math.round(discount * 100) / 100;

  return { ok: true, discount, coupon };
}

// GET /consumer/coupons?businessId=&subtotal= — coupons applicable to this
// store, each flagged locked/unlocked against the current cart subtotal so
// the UI can show "Shop for ₹X more to apply" without a second round trip.
export const listApplicableCoupons = async (req, res, next) => {
  try {
    const businessId = req.query.businessId?.toString();
    const subtotal = parseFloat(req.query.subtotal) || 0;
    const now = new Date();

    const coupons = await Coupon.findAll({
      where: {
        isActive: true,
        [Op.or]: [{ businessId: null }, ...(businessId ? [{ businessId }] : [])],
        [Op.and]: [
          { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: now } }] },
          { [Op.or]: [{ validUntil: null }, { validUntil: { [Op.gte]: now } }] },
        ],
      },
      order: [['minOrderValue', 'ASC']],
    });

    const result = await Promise.all(coupons.map(async (c) => {
      let unavailable = false;
      if (c.usageLimit != null) {
        const totalUses = await Order.count({ where: { couponCode: c.code } });
        if (totalUses >= c.usageLimit) unavailable = true;
      }
      if (!unavailable) {
        const userUses = await Order.count({ where: { couponCode: c.code, customerId: req.user.id } });
        if (userUses >= c.perUserLimit) unavailable = true;
      }
      const locked = subtotal < Number(c.minOrderValue);
      return {
        code: c.code,
        discountType: c.discountType,
        discountValue: c.discountValue,
        maxDiscount: c.maxDiscount,
        minOrderValue: c.minOrderValue,
        description: c.description,
        locked,
        unavailable,
        moreNeeded: locked ? Number(c.minOrderValue) - subtotal : 0,
      };
    }));

    return res.status(200).json({ coupons: result.filter((c) => !c.unavailable) });
  } catch (error) {
    next(error);
  }
};

// POST /consumer/coupons/validate — recomputes the discount server-side.
export const validateCoupon = async (req, res, next) => {
  try {
    const schema = z.object({
      code: z.string(),
      businessId: z.string(),
      subtotal: z.union([z.number(), z.string()]).transform((v) => parseFloat(v) || 0),
    });
    const data = schema.parse(req.body);
    const result = await resolveCouponDiscount({
      code: data.code,
      userId: req.user.id,
      businessId: data.businessId,
      subtotal: data.subtotal,
    });
    if (!result.ok) {
      return res.status(400).json({ error: { message: result.message } });
    }
    return res.status(200).json({
      code: result.coupon.code,
      discountAmount: result.discount,
      description: result.coupon.description,
    });
  } catch (error) {
    next(error);
  }
};

// ── Admin CRUD (super-admin only — platform-wide promo management) ─────────

export const listAllCoupons = async (req, res, next) => {
  try {
    const coupons = await Coupon.findAll({ order: [['createdAt', 'DESC']] });
    return res.status(200).json(coupons);
  } catch (error) {
    next(error);
  }
};

const couponSchema = z.object({
  code: z.string().min(3).transform((v) => v.trim().toUpperCase()),
  businessId: z.string().uuid().optional().nullable(),
  discountType: z.enum(['flat', 'percentage']),
  discountValue: z.union([z.number(), z.string()]).transform((v) => parseFloat(v)),
  maxDiscount: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v ? parseFloat(v) : null)),
  minOrderValue: z.union([z.number(), z.string()]).optional().transform((v) => parseFloat(v) || 0),
  usageLimit: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v ? parseInt(v) : null)),
  perUserLimit: z.union([z.number(), z.string()]).optional().transform((v) => parseInt(v) || 1),
  isActive: z.boolean().optional(),
  validFrom: z.string().optional().nullable(),
  validUntil: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export const createCoupon = async (req, res, next) => {
  try {
    const data = couponSchema.parse(req.body);
    const coupon = await Coupon.create(data);
    return res.status(201).json(coupon);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: { message: 'A coupon with this code already exists.' } });
    }
    next(error);
  }
};

export const updateCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findByPk(id);
    if (!coupon) return res.status(404).json({ error: { message: 'Coupon not found' } });
    const data = couponSchema.partial().parse(req.body);
    await coupon.update(data);
    return res.status(200).json(coupon);
  } catch (error) {
    next(error);
  }
};

export const deleteCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    const coupon = await Coupon.findByPk(id);
    if (!coupon) return res.status(404).json({ error: { message: 'Coupon not found' } });
    await coupon.destroy();
    return res.status(200).json({ message: 'Coupon deleted' });
  } catch (error) {
    next(error);
  }
};
