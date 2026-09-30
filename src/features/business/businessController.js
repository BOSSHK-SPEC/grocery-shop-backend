import { z } from 'zod';
import { isAdminRole, legacyFieldsForApplication, withModeStatus, ModeStatus } from '../../utils/modes.js';
import { Op } from 'sequelize';
import {
  User,
  Business,
  Address,
  BusinessType,
  BusinessBusinessType,
  Bill,
  Order,
  Tenant
} from '../../models/index.js';
import { resolveBusiness } from '../../utils/helpers.js';
import { OrderStatus, normalizeStatus } from '../order/orderStatus.js';

/** Owner fields that may leave the server (never password, device token, location). */
const OWNER_SAFE_FIELDS = ['id', 'firstName', 'lastName', 'mobileNumber', 'email', 'profilePic'];
import { discardImages, resolveImageInput, presentBusiness, presentKyc } from '../../storage/imageStorage.js';

export const getAllBusinessType = async (req, res, next) => {
  try {
    const types = await BusinessType.findAll();
    return res.status(200).json(types);
  } catch (error) {
    next(error);
  }
};

export const createProfile = async (req, res, next) => {
  try {
    const addressSchema = z.object({
      line1: z.string(),
      line2: z.string().optional().nullable(),
      locality: z.string(),
      landmark: z.string().optional().nullable(),
      district: z.string().optional().nullable(),
      state: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      pinCode: z.union([z.number(), z.string()]).transform(val => parseInt(val) || 0),
      latitude: z.union([z.number(), z.string()]).optional().nullable().transform(val => val ? parseFloat(val) : null),
      longitude: z.union([z.number(), z.string()]).optional().nullable().transform(val => val ? parseFloat(val) : null)
    });

    const businessSchema = z.object({
      businessName: z.string(),
      businessTypeId: z.array(z.string()),
      deliveryRange: z.union([z.number(), z.string()]).transform(val => parseInt(val) || 0),
      gstNumber: z.string().optional().nullable(),
      businessDp: z.string().optional().nullable(),
      address: addressSchema
    });

    const schema = z.object({
      firstName: z.string(),
      lastName: z.string(),
      tenantId: z.string().optional().nullable(),
      businesses: z.array(businessSchema)
    });

    const { firstName, lastName, tenantId, businesses } = schema.parse(req.body);
    const user = req.user;

    // Update user profile info
    user.firstName = firstName;
    user.lastName = lastName;
    // The selling application is tracked on its own (misc.modes.selling) so
    // it never demotes or locks out an account that already delivers.
    const legacy = legacyFieldsForApplication(user, 'selling');
    user.status = legacy.status; // puts the account in the approvals list
    user.role = legacy.role;

    let finalTenantId = tenantId;
    if (!tenantId || tenantId === 'standalone') {
      // Standalone Shop onboarding
      const tenantCode = `TEN-${businesses[0].businessName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '')}-${Math.floor(100 + Math.random() * 900)}`;
      const newTenant = await Tenant.create({
        name: businesses[0].businessName,
        code: tenantCode,
        status: 'ACTIVE'
      });
      finalTenantId = newTenant.id;
    }

    user.tenantId = finalTenantId;
    await user.save();

    const createdBusinesses = [];
    const businessIds = [...(user.misc?.businessId || [])];

    for (const bData of businesses) {
      const businessCode = `BUS-${Math.floor(100000 + Math.random() * 900000)}`;
      const businessDp = await resolveImageInput(bData.businessDp, {
        purpose: 'business_logo',
        userId: user.id,
      });
      let business;
      try {
        business = await Business.create({
          ownerId: user.id,
          tenantId: finalTenantId,
          businessName: bData.businessName,
          businessCode,
          deliveryRange: bData.deliveryRange,
          gstNumber: bData.gstNumber,
          businessDp
        });
      } catch (error) {
        await discardImages(businessDp);
        throw error;
      }

      // Save Address
      const address = await Address.create({
        businessId: business.id,
        ...bData.address
      });

      // Save Business Types Junction
      for (const btIdOrName of bData.businessTypeId) {
        const dbType = await BusinessType.findOne({
          where: {
            [Op.or]: [
              { id: btIdOrName },
              { businessType: btIdOrName }
            ]
          }
        });
        if (dbType) {
          await BusinessBusinessType.create({
            businessId: business.id,
            businessTypeId: dbType.id
          });
        }
      }

      businessIds.push(business.id);

      const dbBusinessTypes = await business.getBusinessType();
      createdBusinesses.push({
        id: business.id,
        businessName: business.businessName,
        businessCode: business.businessCode,
        businessTypeId: dbBusinessTypes.map(bt => bt.id),
        deliveryRange: business.deliveryRange,
        gstNumber: business.gstNumber,
        address: address.toJSON(),
        businessDp: business.businessDp,
        businessType: dbBusinessTypes.map(bt => ({ id: bt.id, businessType: bt.businessType })),
        currentSelection: null
      });
    }

    user.misc = withModeStatus({ ...user.misc, businessId: businessIds }, 'selling', ModeStatus.PENDING);
    await user.save();

    return res.status(202).json({
      firstName: user.firstName,
      lastName: user.lastName,
      mobileNumber: user.mobileNumber,
      businesses: createdBusinesses
    });
  } catch (error) {
    next(error);
  }
};

export const getBusinessProfile = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await Business.findOne({
      where: {
        [Op.or]: [
          { id: businessId },
          { businessCode: businessId }
        ]
      },
      include: [
        'address',
        // Only safe owner fields ever leave the server (the User row also holds
        // the password hash, device token and location).
        { model: User, as: 'owner', attributes: OWNER_SAFE_FIELDS }
      ]
    });
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const isOwner = business.ownerId === req.user.id || isAdminRole(req.userRole) || isAdminRole(req.user.role);
    // KYC and payout details are for the owner and admins only.
    const json = await presentBusiness(business, { includePrivate: isOwner });
    if (!isOwner && json.owner) {
      // Shoppers see who runs the store, not how to reach them privately.
      json.owner = { firstName: json.owner.firstName };
    }
    return res.status(200).json(json);
  } catch (error) {
    next(error);
  }
};

export const updateBusinessProfile = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await Business.findOne({
      where: {
        [Op.or]: [{ id: businessId }, { businessCode: businessId }]
      },
      include: ['address', 'owner']
    });
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const schema = z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      businessName: z.string().optional(),
      deliveryRange: z.number().optional(),
      gstNumber: z.string().optional().nullable(),
      businessDp: z.string().optional().nullable(),
      shopName: z.string().optional(),
      floor: z.string().optional().nullable(),
      locality: z.string().optional(),
      landmark: z.string().optional().nullable(),
      pincode: z.string().optional(),
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      acceptingOrders: z.boolean().optional(),
      pausedUntil: z.string().optional().nullable(),
      openingHours: z.any().optional(),
      minimumOrder: z.number().optional(),
      storePhone: z.string().optional().nullable(),
    });
    const data = schema.parse(req.body);

    // Update Business record
    const businessUpdate = {};
    if (data.businessName) businessUpdate.businessName = data.businessName;
    if (data.deliveryRange !== undefined) businessUpdate.deliveryRange = data.deliveryRange;
    if (data.gstNumber !== undefined) businessUpdate.gstNumber = data.gstNumber;
    if (data.acceptingOrders !== undefined) businessUpdate.acceptingOrders = data.acceptingOrders;
    if (data.pausedUntil !== undefined) businessUpdate.pausedUntil = data.pausedUntil ? new Date(data.pausedUntil) : null;
    if (data.openingHours !== undefined) businessUpdate.openingHours = data.openingHours;
    if (data.minimumOrder !== undefined) businessUpdate.minimumOrder = data.minimumOrder;
    if (data.storePhone !== undefined) businessUpdate.storePhone = data.storePhone;
    // The stored reference, not the URL the getter returns.
    const previousDp = business.getDataValue('businessDp');
    if (data.businessDp !== undefined && data.businessDp !== null) {
      // An "upload:<id>" for a new logo; the current logo's URL when unchanged.
      businessUpdate.businessDp = await resolveImageInput(data.businessDp, {
        purpose: 'business_logo',
        userId: req.user.id,
        current: previousDp,
      });
    }
    const dpChanged = 'businessDp' in businessUpdate && businessUpdate.businessDp !== previousDp;
    if (Object.keys(businessUpdate).length > 0) {
      try {
        await business.update(businessUpdate);
      } catch (error) {
        if (dpChanged) await discardImages(businessUpdate.businessDp);
        throw error;
      }
      // Only once the row points at the new logo is the old one safe to drop.
      if (dpChanged) await discardImages(previousDp);
    }

    // Update Owner (User) record
    if (business.owner) {
      const ownerUpdate = {};
      if (data.firstName) ownerUpdate.firstName = data.firstName;
      if (data.lastName) ownerUpdate.lastName = data.lastName;
      if (Object.keys(ownerUpdate).length > 0) await business.owner.update(ownerUpdate);
    }

    // Update Address record
    if (business.address) {
      const addrUpdate = {};
      if (data.shopName) addrUpdate.line1 = data.shopName;
      if (data.floor !== undefined) addrUpdate.line2 = data.floor;
      if (data.locality) addrUpdate.locality = data.locality;
      if (data.landmark !== undefined) addrUpdate.landmark = data.landmark;
      if (data.pincode) addrUpdate.pinCode = data.pincode;
      if (data.latitude !== undefined) addrUpdate.latitude = data.latitude;
      if (data.longitude !== undefined) addrUpdate.longitude = data.longitude;
      if (Object.keys(addrUpdate).length > 0) await business.address.update(addrUpdate);
    }

    // Return refreshed profile
    const updated = await Business.findOne({
      where: { id: business.id },
      include: ['address', { model: User, as: 'owner', attributes: OWNER_SAFE_FIELDS }]
    });
    return res.status(200).json(await presentBusiness(updated, { includePrivate: true }));
  } catch (error) {
    next(error);
  }
};

/** Local calendar-day key for grouping ("2026-09-26"). */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MAX_CHART_DAYS = 92;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Store analytics for [startDate, endDate] (inclusive, local days; default:
 * the 7 days ending today). The KPIs and the chart cover the SAME range; the
 * chart has one point per day (capped at 92 days, which is then shown by
 * week). Orders in any in-progress status count as "Progress".
 */
export const getBusinessAnalytics = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const business = req.business ?? await resolveBusiness(req.params.businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const end = endDate ? new Date(endDate) : new Date();
    if (Number.isNaN(end.getTime())) return res.status(400).json({ error: { message: 'Invalid endDate' } });
    end.setHours(23, 59, 59, 999);
    let start;
    if (startDate) {
      start = new Date(startDate);
      if (Number.isNaN(start.getTime())) return res.status(400).json({ error: { message: 'Invalid startDate' } });
    } else {
      start = new Date(end);
      start.setDate(end.getDate() - 6);
    }
    start.setHours(0, 0, 0, 0);
    if (start > end) return res.status(400).json({ error: { message: 'startDate must be before endDate' } });

    const where = { businessId: business.id, createdAt: { [Op.gte]: start, [Op.lte]: end } };
    const [bills, orders] = await Promise.all([Bill.findAll({ where }), Order.findAll({ where })]);
    const liveOrders = orders.filter((o) => normalizeStatus(o.status) !== OrderStatus.CANCELLED);

    const amount = (x) => parseFloat(x.amount || 0);
    const totalSales = bills.reduce((sum, b) => sum + amount(b), 0) + liveOrders.reduce((sum, o) => sum + amount(o), 0);

    const customers = new Set();
    bills.forEach((b) => {
      if (b.mobile && b.mobile !== 'None') customers.add(b.mobile);
      else if (b.customerName) customers.add(b.customerName);
    });
    orders.forEach((o) => customers.add(o.customerId || o.customerName));
    customers.delete(undefined);
    customers.delete(null);

    const byStatus = (st) => orders.filter((o) => normalizeStatus(o.status) === st).length;
    const inProgress = [OrderStatus.PENDING, OrderStatus.PACKING, OrderStatus.PACKED, OrderStatus.OUT_FOR_DELIVERY]
      .reduce((n, st) => n + byStatus(st), 0);
    const pieData = [
      { label: 'Progress', value: inProgress },
      { label: 'Completed', value: byStatus(OrderStatus.DELIVERED) + bills.length }, // counter bills are completed sales
      { label: 'Cancelled', value: byStatus(OrderStatus.CANCELLED) }
    ];

    // One bucket per day of the requested range; long ranges are grouped by week.
    const days = Math.round((end - start) / 86400000);
    const weekly = days > MAX_CHART_DAYS;
    const buckets = new Map();
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + (weekly ? 7 : 1))) {
      const label = days <= 7
        ? DAY_NAMES[d.getDay()]
        : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      buckets.set(dayKey(d), { x: label, y: 0 });
    }
    const keys = [...buckets.keys()];
    const bucketOf = (date) => {
      const k = dayKey(new Date(date));
      if (!weekly) return buckets.get(k);
      // Weekly: the bucket whose start is the latest one not after [date].
      let found = keys[0];
      for (const key of keys) if (key <= k) found = key;
      return buckets.get(found);
    };
    bills.forEach((b) => { const slot = bucketOf(b.createdAt); if (slot) slot.y += amount(b); });
    liveOrders.forEach((o) => { const slot = bucketOf(o.createdAt); if (slot) slot.y += amount(o); });

    return res.status(200).json({
      from: dayKey(start),
      to: dayKey(end),
      visitors: customers.size,
      orders: bills.length + orders.length,
      sales: parseFloat(totalSales.toFixed(2)),
      // Legacy field: an estimate the dashboard labels as such (22% margin).
      revenue: parseFloat((totalSales * 0.22).toFixed(2)),
      pieData,
      dailySales: [...buckets.values()].map((p) => ({ x: p.x, y: parseFloat(p.y.toFixed(2)) }))
    });
  } catch (error) {
    next(error);
  }
};

export const getAllBusinesses = async (req, res, next) => {
  try {
    const list = await Business.findAll({
      include: [
        { model: Address, as: 'address' },
        // Public listing: never the owner's contact details.
        { model: User, as: 'owner', attributes: ['firstName'] },
        { model: BusinessType, as: 'businessType' }
      ]
    });
    // Every signed-in user can list stores, so KYC and payout details stay out.
    return res.status(200).json(await Promise.all(list.map((b) => presentBusiness(b))));
  } catch (error) {
    next(error);
  }
};

export const saveStoreProfile = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) return res.status(404).json({ error: { message: 'Business not found' } });
    if (business.ownerId !== req.user.id) return res.status(403).json({ error: { message: 'Unauthorized' } });

    const { phone, openingHours } = req.body;
    if (phone !== undefined) business.storePhone = phone;
    if (openingHours !== undefined) business.openingHours = openingHours;
    await business.save();

    return res.status(200).json({ success: true, business: await presentBusiness(business, { includePrivate: true }) });
  } catch (error) {
    next(error);
  }
};

export const submitKyc = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) return res.status(404).json({ error: { message: 'Business not found' } });
    if (business.ownerId !== req.user.id) return res.status(403).json({ error: { message: 'Unauthorized' } });

    const { pan, gstin, panPhoto, fssaiPhoto } = req.body;
    const panPhotoRef = panPhoto ? await resolveImageInput(panPhoto, { purpose: 'driving_licence', userId: req.user.id }) : null;
    const fssaiPhotoRef = fssaiPhoto ? await resolveImageInput(fssaiPhoto, { purpose: 'driving_licence', userId: req.user.id }) : null;

    business.kyc = {
      pan,
      gstin: gstin || null,
      panPhoto: panPhotoRef,
      fssaiPhoto: fssaiPhotoRef,
      status: 'SUBMITTED',
      submittedAt: new Date().toISOString()
    };
    await business.save();

    return res.status(200).json({ success: true, kyc: await presentKyc(business.kyc) });
  } catch (error) {
    next(error);
  }
};

export const savePayoutAccount = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) return res.status(404).json({ error: { message: 'Business not found' } });
    if (business.ownerId !== req.user.id) return res.status(403).json({ error: { message: 'Unauthorized' } });

    const { bankAccountNumber, ifscCode, upiId, accountHolderName } = req.body;
    business.payoutAccount = {
      bankAccountNumber,
      ifscCode,
      upiId,
      accountHolderName,
      updatedAt: new Date().toISOString()
    };
    await business.save();

    return res.status(200).json({ success: true, payoutAccount: business.payoutAccount });
  } catch (error) {
    next(error);
  }
};

export const getTopProducts = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) return res.status(404).json({ error: { message: 'Business not found' } });

    return res.status(200).json([
      { name: 'Fresh Milk 1L', totalSold: 142, revenue: 8520 },
      { name: 'Basmati Rice 5kg', totalSold: 89, revenue: 39160 },
      { name: 'Organic Bananas 1kg', totalSold: 76, revenue: 3800 }
    ]);
  } catch (error) {
    next(error);
  }
};

export const getPayouts = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) return res.status(404).json({ error: { message: 'Business not found' } });

    return res.status(200).json({
      nextPayoutDate: new Date(Date.now() + 3 * 86400000).toISOString().substring(0, 10),
      pendingAmount: 14500.00,
      lastPayoutAmount: 23800.00,
      payoutAccount: business.payoutAccount || null
    });
  } catch (error) {
    next(error);
  }
};

