import { z } from 'zod';
import { Op } from 'sequelize';
import {
  User,
  Business,
  Address,
  BusinessType,
  BusinessBusinessType,
  Bill,
  Order
} from '../../models/index.js';
import { resolveBusiness, saveBase64Image } from '../../utils/helpers.js';

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
      businesses: z.array(businessSchema)
    });

    const { firstName, lastName, businesses } = schema.parse(req.body);
    const user = req.user;

    // Update user profile info
    user.firstName = firstName;
    user.lastName = lastName;
    user.status = 'ACTIVE';

    const createdBusinesses = [];
    const businessIds = [...(user.misc?.businessId || [])];

    for (const bData of businesses) {
      const businessCode = `BUS-${Math.floor(100000 + Math.random() * 900000)}`;
      const businessDp = bData.businessDp ? await saveBase64Image(bData.businessDp) : null;
      const business = await Business.create({
        ownerId: user.id,
        businessName: bData.businessName,
        businessCode,
        deliveryRange: bData.deliveryRange,
        gstNumber: bData.gstNumber,
        businessDp
      });

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

    user.misc = { ...user.misc, businessId: businessIds };
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
      include: ['address', 'owner']
    });
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    return res.status(200).json(business);
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
    });
    const data = schema.parse(req.body);

    // Update Business record
    const businessUpdate = {};
    if (data.businessName) businessUpdate.businessName = data.businessName;
    if (data.deliveryRange !== undefined) businessUpdate.deliveryRange = data.deliveryRange;
    if (data.gstNumber !== undefined) businessUpdate.gstNumber = data.gstNumber;
    if (data.businessDp !== undefined && data.businessDp !== null) {
      // Persist the store image: decodes base64 (or passes through existing /uploads path)
      businessUpdate.businessDp = await saveBase64Image(data.businessDp);
    }
    if (Object.keys(businessUpdate).length > 0) await business.update(businessUpdate);

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
      include: ['address', 'owner']
    });
    return res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
};

export const getBusinessAnalytics = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { startDate, endDate } = req.query;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const dbBusinessId = business.id;

    // Determine filter range
    const reqStart = startDate ? new Date(startDate) : null;
    const reqEnd = endDate ? new Date(endDate) : new Date();
    // Ensure end date covers the full day
    reqEnd.setHours(23, 59, 59, 999);

    // Chart needs last 7 days ending at reqEnd
    const chartStart = new Date(reqEnd);
    chartStart.setDate(reqEnd.getDate() - 6);
    chartStart.setHours(0, 0, 0, 0);

    // Query database for a range covering both metrics range and chart range
    const queryStart = (reqStart && reqStart < chartStart) ? reqStart : chartStart;

    const queryWhere = {
      businessId: dbBusinessId,
      createdAt: {
        [Op.gte]: queryStart,
        [Op.lte]: reqEnd
      }
    };

    const allBills = await Bill.findAll({ where: queryWhere });
    const allOrders = await Order.findAll({ where: queryWhere });

    // Filter locally for metrics (matching requested user date range)
    const bills = allBills.filter(b => {
      const bTime = new Date(b.createdAt);
      if (reqStart && bTime < reqStart) return false;
      return bTime <= reqEnd;
    });

    const orders = allOrders.filter(o => {
      const oTime = new Date(o.createdAt);
      if (reqStart && oTime < reqStart) return false;
      return oTime <= reqEnd;
    });

    // 1. Total Sales and Orders counts
    const totalBillsSales = bills.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    const totalOrdersSales = orders
      .filter(o => o.status !== 'Cancelled')
      .reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);
    const totalSales = totalBillsSales + totalOrdersSales;

    const totalOrdersCount = bills.length + orders.length;

    // 2. Distinct visitors/customers based on mobile numbers or customer names
    const customersSet = new Set();
    bills.forEach(b => {
      if (b.mobile && b.mobile !== 'None') {
        customersSet.add(b.mobile);
      } else if (b.customerName) {
        customersSet.add(b.customerName);
      }
    });
    orders.forEach(o => {
      if (o.customerName) {
        customersSet.add(o.customerName);
      }
    });
    const uniqueCustomers = customersSet.size;

    // 3. Profit Margin estimation (22% net profit)
    const netRevenue = totalSales * 0.22;

    // 4. Pie data (status counts)
    const pendingCount = orders.filter(o => o.status === 'Pending').length;
    const packedCount = orders.filter(o => o.status === 'Packed').length;
    const shippedCount = orders.filter(o => o.status === 'Shipped').length;
    const deliveredCount = orders.filter(o => o.status === 'Delivered').length + bills.length; // bills are completed
    const cancelledCount = orders.filter(o => o.status === 'Cancelled').length;

    const pieData = [
      { label: 'Progress', value: pendingCount + packedCount + shippedCount },
      { label: 'Completed', value: deliveredCount },
      { label: 'Cancelled', value: cancelledCount }
    ];

    // 5. Daily Sales aggregation for the last 7 days ending at reqEnd
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(reqEnd);
      d.setDate(reqEnd.getDate() - i);
      const dayLabel = daysOfWeek[d.getDay()];
      last7Days.push({
        day: dayLabel,
        dateString: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        sales: 0
      });
    }

    // Distribute bills sales (from the entire allBills matching the 7 days)
    allBills.forEach(b => {
      const slot = last7Days.find(s => s.dateString === b.date);
      if (slot) {
        slot.sales += parseFloat(b.amount || 0);
      }
    });

    // Distribute orders sales (from the entire allOrders matching the 7 days)
    allOrders.forEach(o => {
      if (o.status !== 'Cancelled') {
        const slot = last7Days.find(s => s.dateString === o.date);
        if (slot) {
          slot.sales += parseFloat(o.amount || 0);
        }
      }
    });

    // Format for ChartData
    const dailySales = last7Days.map(item => ({
      x: item.day,
      y: parseFloat(item.sales.toFixed(1))
    }));

    return res.status(200).json({
      visitors: uniqueCustomers,
      orders: totalOrdersCount,
      sales: parseFloat(totalSales.toFixed(1)),
      revenue: parseFloat(netRevenue.toFixed(1)),
      pieData,
      dailySales
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
        { model: User, as: 'owner', attributes: ['firstName', 'lastName', 'email', 'mobileNumber'] },
        { model: BusinessType, as: 'businessType' }
      ]
    });
    return res.status(200).json(list);
  } catch (error) {
    next(error);
  }
};
