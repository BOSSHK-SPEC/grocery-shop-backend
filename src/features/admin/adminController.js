import { User, Address, Business, Order, Bill, Tenant, BusinessType, BusinessBusinessType } from '../../models/index.js';
import { sendToUser } from '../../utils/notify.js';
import { z } from 'zod';
import { Op } from 'sequelize';

export const getPendingUsers = async (req, res, next) => {
  try {
    const isSuperAdmin = req.userRole === 'super_admin' || req.user.role === 'super_admin';
    const tenantFilter = isSuperAdmin ? {} : { tenantId: req.user.tenantId };

    const users = await User.findAll({
      where: { status: 'PENDING_APPROVAL', ...tenantFilter },
      attributes: ['id', 'mobileNumber', 'firstName', 'lastName', 'role', 'status', 'profilePic', 'misc', 'createdAt']
    });

    const list = [];
    for (const u of users) {
      const address = await Address.findOne({ where: { userId: u.id } });
      let businesses = [];
      if (u.role === 'merchant') {
        businesses = await Business.findAll({
          where: { ownerId: u.id, ...tenantFilter },
          include: [{ model: Address, as: 'address' }]
        });
      }

      list.push({
        user: u,
        address,
        businesses
      });
    }

    return res.status(200).json(list);
  } catch (error) {
    next(error);
  }
};

export const approveUser = async (req, res, next) => {
  try {
    const schema = z.object({
      userId: z.string(),
      action: z.enum(['approve', 'reject'])
    });

    const { userId, action } = schema.parse(req.body);
    const user = await User.findByPk(userId);

    if (!user) {
      return res.status(404).json({ error: { message: 'User not found.' } });
    }

    const isSuperAdmin = req.userRole === 'super_admin' || req.user.role === 'super_admin';
    if (!isSuperAdmin && user.tenantId !== req.user.tenantId) {
      return res.status(403).json({ error: { message: 'Access denied. You can only manage users within your franchise.' } });
    }

    if (action === 'approve') {
      user.status = 'ACTIVE';

      // If this is a standalone store (meaning a new tenant partition was created and has 0 admins),
      // promote this user to the tenant 'admin' role so they can access the web console.
      if (user.role === 'merchant' && user.tenantId) {
        const adminCount = await User.count({
          where: { tenantId: user.tenantId, role: 'admin' }
        });
        if (adminCount === 0) {
          user.role = 'admin';
        }
      }

      await user.save();

      // Trigger FCM push notification to the user
      await sendToUser(
        user.id,
        'Account Approved 🎉',
        'Congratulations! Your Bazaar partner account has been approved and is now active.',
        {
          type: 'approval_status',
          status: 'ACTIVE'
        }
      );

      return res.status(200).json({ message: 'User approved successfully.', user });
    } else {
      user.status = 'REJECTED';
      await user.save();

      await sendToUser(
        user.id,
        'Account Status Update',
        'Your registration request could not be approved at this time.',
        {
          type: 'approval_status',
          status: 'REJECTED'
        }
      );

      return res.status(200).json({ message: 'User rejected successfully.', user });
    }
  } catch (error) {
    next(error);
  }
};

export const getAdminAnalytics = async (req, res, next) => {
  try {
    const isSuperAdmin = req.userRole === 'super_admin' || req.user.role === 'super_admin';
    const tenantFilter = isSuperAdmin ? {} : { tenantId: req.user.tenantId };
    const businessInclude = isSuperAdmin ? [] : [{ model: Business, required: true, where: { tenantId: req.user.tenantId } }];

    const totalMerchants = await User.count({ where: { role: 'merchant', ...tenantFilter } });
    const totalRiders = await User.count({ where: { role: 'delivery', ...tenantFilter } });
    const pendingApprovals = await User.count({ where: { status: 'PENDING_APPROVAL', ...tenantFilter } });

    let totalOrders = 0;
    let totalRevenue = 0;

    if (isSuperAdmin) {
      totalOrders = await Order.count();
      totalRevenue = (await Bill.sum('amount')) || 0;
    } else {
      const tenantBusinesses = await Business.findAll({
        where: { tenantId: req.user.tenantId },
        attributes: ['id']
      });
      const businessIds = tenantBusinesses.map(b => b.id);
      if (businessIds.length > 0) {
        totalOrders = await Order.count({ where: { businessId: { [Op.in]: businessIds } } });
        totalRevenue = (await Bill.sum('amount', { where: { businessId: { [Op.in]: businessIds } } })) || 0;
      }
    }

    // Fetch all merchants
    const merchantsRaw = await User.findAll({
      where: { role: 'merchant', ...tenantFilter },
      attributes: ['id', 'mobileNumber', 'firstName', 'lastName', 'status', 'profilePic', 'createdAt']
    });

    const merchants = [];
    for (const m of merchantsRaw) {
      const address = await Address.findOne({ where: { userId: m.id } });
      const businesses = await Business.findAll({
        where: { ownerId: m.id, ...tenantFilter },
        include: [{ model: Address, as: 'address' }]
      });
      merchants.push({
        user: m,
        address,
        businesses
      });
    }

    // Fetch all riders
    const ridersRaw = await User.findAll({
      where: { role: 'delivery', ...tenantFilter },
      attributes: ['id', 'mobileNumber', 'firstName', 'lastName', 'status', 'profilePic', 'misc', 'createdAt']
    });

    const riders = [];
    for (const r of ridersRaw) {
      const address = await Address.findOne({ where: { userId: r.id } });
      riders.push({
        user: r,
        address
      });
    }

    // Dynamic Registration trend (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentUsers = await User.findAll({
      where: {
        role: { [Op.or]: ['merchant', 'delivery'] },
        createdAt: { [Op.gte]: sevenDaysAgo },
        ...tenantFilter
      },
      attributes: ['createdAt']
    });

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const regCounts = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      regCounts[days[d.getDay()]] = 0;
    }

    for (const u of recentUsers) {
      const dayName = days[new Date(u.createdAt).getDay()];
      if (regCounts[dayName] !== undefined) {
        regCounts[dayName]++;
      }
    }

    const weeklyRegistrations = Object.keys(regCounts).map(day => ({
      x: day,
      y: regCounts[day]
    }));

    return res.status(200).json({
      stats: {
        totalMerchants,
        totalRiders,
        pendingApprovals,
        totalOrders,
        totalRevenue
      },
      merchants,
      riders,
      weeklyRegistrations
    });
  } catch (error) {
    next(error);
  }
};

export const createMerchantDirectly = async (req, res, next) => {
  try {
    const isSuperAdmin = req.userRole === 'super_admin' || req.user.role === 'super_admin';
    
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

    const schema = z.object({
      mobileNumber: z.string().min(10).max(15),
      firstName: z.string(),
      lastName: z.string(),
      businessName: z.string(),
      businessTypeId: z.array(z.string()),
      deliveryRange: z.union([z.number(), z.string()]).transform(val => parseInt(val) || 0),
      gstNumber: z.string().optional().nullable(),
      tenantId: z.string().optional().nullable(),
      address: addressSchema
    });

    const {
      mobileNumber,
      firstName,
      lastName,
      businessName,
      businessTypeId,
      deliveryRange,
      gstNumber,
      tenantId,
      address: addressData
    } = schema.parse(req.body);

    let finalTenantId = isSuperAdmin ? tenantId : req.user.tenantId;
    if (isSuperAdmin && (!finalTenantId || finalTenantId === 'standalone')) {
      const tenantCode = `TEN-${businessName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '')}-${Math.floor(100 + Math.random() * 900)}`;
      const newTenant = await Tenant.create({
        name: businessName,
        code: tenantCode,
        status: 'ACTIVE'
      });
      finalTenantId = newTenant.id;
    }

    let user = await User.findOne({ where: { mobileNumber } });
    if (user) {
      return res.status(400).json({ error: { message: 'A user with this mobile number already exists.' } });
    }

    user = await User.create({
      mobileNumber,
      firstName,
      lastName,
      role: 'merchant',
      status: 'ACTIVE',
      tenantId: finalTenantId
    });

    const businessCode = `BUS-${Math.floor(100000 + Math.random() * 900000)}`;
    const business = await Business.create({
      ownerId: user.id,
      tenantId: finalTenantId,
      businessName,
      businessCode,
      deliveryRange,
      gstNumber
    });

    const address = await Address.create({
      businessId: business.id,
      ...addressData
    });

    user.misc = {
      ...user.misc,
      businessId: [business.id]
    };
    await user.save();

    for (const btIdOrName of businessTypeId) {
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

    return res.status(201).json({
      message: 'Merchant user and business created directly successfully.',
      user,
      business,
      address
    });
  } catch (error) {
    next(error);
  }
};

export const createRiderDirectly = async (req, res, next) => {
  try {
    const isSuperAdmin = req.userRole === 'super_admin' || req.user.role === 'super_admin';

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

    const schema = z.object({
      mobileNumber: z.string().min(10).max(15),
      firstName: z.string(),
      lastName: z.string(),
      bikeRegNumber: z.string(),
      tenantId: z.string().optional().nullable(),
      address: addressSchema
    });

    const {
      mobileNumber,
      firstName,
      lastName,
      bikeRegNumber,
      tenantId,
      address: addressData
    } = schema.parse(req.body);

    let finalTenantId = isSuperAdmin ? tenantId : req.user.tenantId;
    if (finalTenantId === 'standalone') {
      finalTenantId = null;
    }

    let user = await User.findOne({ where: { mobileNumber } });
    if (user) {
      return res.status(400).json({ error: { message: 'A user with this mobile number already exists.' } });
    }

    user = await User.create({
      mobileNumber,
      firstName,
      lastName,
      role: 'delivery',
      status: 'ACTIVE',
      tenantId: finalTenantId,
      misc: {
        bikeRegNumber,
        dlPic: '',
        businessId: []
      }
    });

    const address = await Address.create({
      userId: user.id,
      ...addressData
    });

    return res.status(201).json({
      message: 'Rider created directly successfully.',
      user,
      address
    });
  } catch (error) {
    next(error);
  }
};

export const getMerchantsPaginated = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const tenantId = req.query.tenantId || '';

    const isSuperAdmin = req.userRole === 'super_admin' || req.user.role === 'super_admin';
    let finalTenantId = isSuperAdmin ? tenantId : req.user.tenantId;

    const userWhere = { role: 'merchant' };
    if (status) {
      userWhere.status = status;
    }
    if (finalTenantId) {
      if (finalTenantId === 'standalone') {
        userWhere.tenantId = null;
      } else {
        userWhere.tenantId = finalTenantId;
      }
    }

    if (search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${search}%` } },
        { lastName: { [Op.like]: `%${search}%` } },
        { mobileNumber: { [Op.like]: `%${search}%` } },
        { '$businesses.businessName$': { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where: userWhere,
      include: [
        {
          model: Business,
          as: 'businesses',
          include: [{ model: Address, as: 'address' }]
        },
        {
          model: Address,
          as: 'address'
        }
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      distinct: true
    });

    const totalPages = Math.ceil(count / limit);

    // Structure list to match the user-address-businesses dashboard pattern
    const list = rows.map(u => {
      return {
        user: {
          id: u.id,
          mobileNumber: u.mobileNumber,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          status: u.status,
          profilePic: u.profilePic,
          tenantId: u.tenantId,
          createdAt: u.createdAt
        },
        address: u.address,
        businesses: u.businesses
      };
    });

    return res.status(200).json({
      data: list,
      meta: {
        total: count,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getRidersPaginated = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const tenantId = req.query.tenantId || '';

    const isSuperAdmin = req.userRole === 'super_admin' || req.user.role === 'super_admin';
    let finalTenantId = isSuperAdmin ? tenantId : req.user.tenantId;

    const userWhere = { role: 'delivery' };
    if (status) {
      userWhere.status = status;
    }
    if (finalTenantId) {
      if (finalTenantId === 'standalone') {
        userWhere.tenantId = null;
      } else {
        userWhere.tenantId = finalTenantId;
      }
    }

    if (search) {
      userWhere[Op.or] = [
        { firstName: { [Op.like]: `%${search}%` } },
        { lastName: { [Op.like]: `%${search}%` } },
        { mobileNumber: { [Op.like]: `%${search}%` } }
      ];
    }

    const { count, rows } = await User.findAndCountAll({
      where: userWhere,
      include: [
        {
          model: Address,
          as: 'address'
        }
      ],
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      distinct: true
    });

    const totalPages = Math.ceil(count / limit);

    const list = rows.map(u => {
      return {
        user: {
          id: u.id,
          mobileNumber: u.mobileNumber,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          status: u.status,
          profilePic: u.profilePic,
          misc: u.misc,
          tenantId: u.tenantId,
          createdAt: u.createdAt
        },
        address: u.address
      };
    });

    return res.status(200).json({
      data: list,
      meta: {
        total: count,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
};
