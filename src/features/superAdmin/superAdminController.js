import { User, Business, Order, Bill, Address, Tenant } from '../../models/index.js';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';

const settingsPath = path.resolve('src/config/settings.json');

const defaultSettings = {
  commissionRate: 10,
  maintenanceMode: false
};

const getSettingsData = async () => {
  try {
    const data = await fs.readFile(settingsPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(defaultSettings, null, 2), 'utf8');
    return defaultSettings;
  }
};

const saveSettingsData = async (settings) => {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
};

// 1. Manage Admins: List
export const getAdminsList = async (req, res, next) => {
  try {
    const admins = await User.findAll({
      where: { role: 'admin' },
      attributes: ['id', 'mobileNumber', 'firstName', 'lastName', 'status', 'tenantId', 'createdAt'],
      include: [{ model: Tenant, as: 'tenant', attributes: ['name', 'code'] }]
    });
    return res.status(200).json(admins);
  } catch (error) {
    next(error);
  }
};

// 2. Promote to Admin
export const promoteToAdmin = async (req, res, next) => {
  try {
    const schema = z.object({
      mobileNumber: z.string().min(10).max(15),
      tenantId: z.string().uuid().optional().nullable()
    });
    const { mobileNumber, tenantId } = schema.parse(req.body);

    let user = await User.findOne({ where: { mobileNumber } });
    if (!user) {
      user = await User.create({ mobileNumber });
    }

    user.role = 'admin';
    user.status = 'ACTIVE';
    user.tenantId = tenantId || null;
    await user.save();

    return res.status(200).json({ message: 'User promoted to Admin successfully.', user });
  } catch (error) {
    next(error);
  }
};

// 3. Demote Admin
export const demoteAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({ error: { message: 'Admin user not found.' } });
    }

    user.role = 'consumer';
    await user.save();

    return res.status(200).json({ message: 'Admin privileges revoked successfully.', user });
  } catch (error) {
    next(error);
  }
};

// 4. Global Settings: Get
export const getGlobalSettings = async (req, res, next) => {
  try {
    const settings = await getSettingsData();
    return res.status(200).json(settings);
  } catch (error) {
    next(error);
  }
};

// 5. Global Settings: Save
export const saveGlobalSettings = async (req, res, next) => {
  try {
    const schema = z.object({
      commissionRate: z.number().min(0).max(100),
      maintenanceMode: z.boolean()
    });

    const settings = schema.parse(req.body);
    await saveSettingsData(settings);

    return res.status(200).json({ message: 'Global settings updated successfully.', settings });
  } catch (error) {
    next(error);
  }
};

// 6. Global Finance Stats Summary
export const getFinanceSummary = async (req, res, next) => {
  try {
    const settings = await getSettingsData();
    const commissionRate = settings.commissionRate || 10;

    const totalSales = (await Bill.sum('amount')) || 0;
    const calculatedCommission = (totalSales * commissionRate) / 100;
    const merchantsCount = await User.count({ where: { role: 'merchant' } });
    const ordersCount = await Order.count();

    // Fetch active merchants sales breakdowns
    const businesses = await Business.findAll({
      attributes: ['id', 'businessName', 'businessCode']
    });

    const merchantsBreakdown = [];
    for (const b of businesses) {
      const sales = (await Bill.sum('amount', { where: { businessId: b.id } })) || 0;
      const commission = (sales * commissionRate) / 100;
      merchantsBreakdown.push({
        businessName: b.businessName,
        businessCode: b.businessCode,
        totalSales: sales,
        commissionEarned: commission
      });
    }

    return res.status(200).json({
      finance: {
        totalSales,
        commissionRate,
        commissionEarned: calculatedCommission,
        merchantsCount,
        ordersCount
      },
      merchantsBreakdown
    });
  } catch (error) {
    next(error);
  }
};

// 7. Tenants: List
export const getTenantsList = async (req, res, next) => {
  try {
    const tenants = await Tenant.findAll();
    return res.status(200).json(tenants);
  } catch (error) {
    next(error);
  }
};

// 8. Tenants: Create
export const createTenant = async (req, res, next) => {
  try {
    const schema = z.object({
      name: z.string().min(2),
      code: z.string().min(2).max(10).toUpperCase()
    });
    const { name, code } = schema.parse(req.body);

    const existing = await Tenant.findOne({ where: { code } });
    if (existing) {
      return res.status(400).json({ error: { message: 'Tenant with this franchise code already exists.' } });
    }

    const tenant = await Tenant.create({ name, code });
    return res.status(201).json(tenant);
  } catch (error) {
    next(error);
  }
};
