import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Op } from 'sequelize';
import {
  User,
  Otp,
  Business,
  Address,
  BusinessType,
  ProductCategory,
  Product,
  Order,
  Bill,
  BusinessBusinessType
} from '../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to save base64 image to local disk
const saveBase64Image = async (base64Str) => {
  if (!base64Str) return null;
  if (base64Str.startsWith('http://') || base64Str.startsWith('https://') || base64Str.startsWith('/uploads/')) {
    return base64Str;
  }
  try {
    let imageBuffer;
    let extension = 'png';
    const matches = base64Str.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

    if (!matches || matches.length !== 3) {
      imageBuffer = Buffer.from(base64Str, 'base64');
    } else {
      extension = matches[1].split('/')[1] || 'png';
      imageBuffer = Buffer.from(matches[2], 'base64');
    }

    const filename = `img_${Date.now()}_${Math.round(Math.random() * 1e9)}.${extension}`;
    const uploadDir = path.join(__dirname, '../../public/uploads');
    
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const filepath = path.join(uploadDir, filename);
    await fs.promises.writeFile(filepath, imageBuffer);
    return `/uploads/${filename}`;
  } catch (error) {
    console.error('Failed to save base64 image:', error.message);
    return null;
  }
};

// Generates a 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const requestOtp = async (req, res, next) => {
  try {
    const schema = z.object({
      mobile: z.string().min(10).max(15)
    });
    const { mobile } = schema.parse(req.body);

    // Create user if not exists
    let user = await User.findOne({ where: { mobileNumber: mobile } });
    if (!user) {
      user = await User.create({ mobileNumber: mobile });
    }

    const otpCode = process.env.NODE_ENV === 'development' ? '123456' : generateOTP();
    const expiry = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000);

    const otpRecord = await Otp.create({
      mobileNumber: mobile,
      otp: otpCode,
      expiresAt: expiry
    });

    console.log(`[OTP] Generated for ${mobile}: ${otpCode} (otpId: ${otpRecord.otpId})`);

    // Return format matching UserModel
    return res.status(200).json({
      id: otpRecord.otpId,
      name: user.firstName || null,
      email: user.email || null
    });
  } catch (error) {
    next(error);
  }
};

export const verifyOtp = async (req, res, next) => {
  try {
    const schema = z.object({
      otp: z.string(),
      otpId: z.string(),
      mobileNumber: z.string()
    });
    const { otp, otpId, mobileNumber } = schema.parse(req.body);

    const otpRecord = await Otp.findOne({
      where: { otpId, mobileNumber, otp, status: 'PENDING' }
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: { message: 'Invalid or expired OTP.' } });
    }

    otpRecord.status = 'VERIFIED';
    await otpRecord.save();

    const user = await User.findOne({ where: { mobileNumber } });
    const tempToken = jwt.sign(
      { userId: user.id, isTemp: true },
      process.env.JWT_SECRET || 'super_secret_jwt_sign_key_12345_grocery_app_2026',
      { expiresIn: '15m' }
    );

    // Return OtpResponseModel format
    return res.status(200).json({
      accessToken: tempToken,
      tokenType: 'Bearer',
      status: user.status
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const schema = z.object({
      mobile: z.string(),
      otpId: z.string(),
      otp: z.string()
    });
    const { mobile, otpId, otp } = schema.parse(req.body);

    // Validate the OTP
    const otpRecord = await Otp.findOne({
      where: { otpId, mobileNumber: mobile, otp, status: 'VERIFIED' }
    });

    if (!otpRecord) {
      // Fallback: Check if OTP exists and is valid (if verifyOtp wasn't called separately)
      const pendingOtp = await Otp.findOne({
        where: { otpId, mobileNumber: mobile, otp, status: 'PENDING' }
      });
      if (!pendingOtp || pendingOtp.expiresAt < new Date()) {
        return res.status(400).json({ error: { message: 'Invalid or expired OTP.' } });
      }
      pendingOtp.status = 'VERIFIED';
      await pendingOtp.save();
    }

    const user = await User.findOne({ where: { mobileNumber: mobile } });
    const accessToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'super_secret_jwt_sign_key_12345_grocery_app_2026',
      { expiresIn: '30d' }
    );

    // Return LoginModel format
    return res.status(200).json({
      accessToken,
      tokenType: 'Bearer',
      status: user.status,
      user: {
        id: user.id,
        mobileNumber: user.mobileNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        userName: user.userName,
        email: user.email,
        password: user.password,
        language: user.language,
        status: user.status,
        misc: user.misc
      }
    });
  } catch (error) {
    next(error);
  }
};

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
      const business = await Business.create({
        ownerId: user.id,
        businessName: bData.businessName,
        businessCode,
        deliveryRange: bData.deliveryRange,
        gstNumber: bData.gstNumber
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
        businessDp: null,
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
    const business = await Business.findOne({
      where: {
        [Op.or]: [
          { id: businessId },
          { businessCode: businessId }
        ]
      }
    });
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

    const business = await Business.findOne({
      where: {
        [Op.or]: [
          { id: businessId },
          { businessCode: businessId }
        ]
      }
    });
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

const resolveBusiness = async (businessId) => {
  return await Business.findOne({
    where: {
      [Op.or]: [
        { id: businessId },
        { businessCode: businessId }
      ]
    }
  });
};

// Orders Controller
export const getOrders = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const orders = await Order.findAll({
      where: { businessId: business.id },
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(orders);
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const schema = z.object({
      customerName: z.string(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      items: z.array(z.any())
    });
    const data = schema.parse(req.body);
    const orderCode = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const newOrder = await Order.create({
      businessId: business.id,
      orderCode,
      customerName: data.customerName,
      amount: data.amount,
      status: 'Pending',
      date,
      items: data.items
    });
    return res.status(201).json(newOrder);
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const schema = z.object({
      status: z.enum(['Pending', 'Packed', 'Shipped', 'Delivered'])
    });
    const { status } = schema.parse(req.body);
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res.status(404).json({ error: { message: 'Order not found' } });
    }
    order.status = status;
    await order.save();
    return res.status(200).json(order);
  } catch (error) {
    next(error);
  }
};

// Billing Controller
export const getBills = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bills = await Bill.findAll({
      where: { businessId: business.id },
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(bills);
  } catch (error) {
    next(error);
  }
};

export const createBill = async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const schema = z.object({
      customerName: z.string(),
      mobile: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0),
      rows: z.array(z.any())
    });
    const data = schema.parse(req.body);
    const billCode = `BILL-${Math.floor(100000 + Math.random() * 900000)}`;
    const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const newBill = await Bill.create({
      businessId: business.id,
      billCode,
      customerName: data.customerName,
      mobile: data.mobile,
      amount: data.amount,
      date,
      rows: data.rows
    });
    return res.status(201).json(newBill);
  } catch (error) {
    next(error);
  }
};

export const getBillById = async (req, res, next) => {
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({
      where: { id: billId, businessId: business.id }
    });
    if (!bill) {
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    return res.status(200).json(bill);
  } catch (error) {
    next(error);
  }
};

export const updateBill = async (req, res, next) => {
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({ where: { id: billId, businessId: business.id } });
    if (!bill) {
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    const schema = z.object({
      customerName: z.string().optional(),
      mobile: z.string().optional().nullable(),
      amount: z.union([z.number(), z.string()]).transform(val => parseFloat(val) || 0).optional(),
      rows: z.array(z.any()).optional()
    });
    const data = schema.parse(req.body);
    await bill.update({
      ...(data.customerName && { customerName: data.customerName }),
      ...(data.mobile !== undefined && { mobile: data.mobile }),
      ...(data.amount !== undefined && { amount: data.amount }),
      ...(data.rows && { rows: data.rows }),
    });
    return res.status(200).json(bill);
  } catch (error) {
    next(error);
  }
};

export const deleteBill = async (req, res, next) => {
  try {
    const { businessId, billId } = req.params;
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    const bill = await Bill.findOne({ where: { id: billId, businessId: business.id } });
    if (!bill) {
      return res.status(404).json({ error: { message: 'Bill not found' } });
    }
    await bill.destroy();
    return res.status(200).json({ message: 'Bill deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// Profile & Analytics Controller
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
    const business = await resolveBusiness(businessId);
    if (!business) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }

    const dbBusinessId = business.id;

    // Fetch all bills & orders
    const bills = await Bill.findAll({ where: { businessId: dbBusinessId } });
    const orders = await Order.findAll({ where: { businessId: dbBusinessId } });

    // 1. Total Sales and Orders counts
    const totalBillsSales = bills.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    const totalOrdersSales = orders
      .filter(o => o.status !== 'Cancelled')
      .reduce((sum, o) => sum + parseFloat(o.amount || 0), 0);
    const totalSales = totalBillsSales + totalOrdersSales;

    const totalOrdersCount = bills.length + orders.length;

    // 2. Distinct visitors/customers based on mobile numbers
    const customersSet = new Set();
    bills.forEach(b => { if (b.mobile && b.mobile !== 'None') customersSet.add(b.mobile); });
    // Fallback: at least total orders conversion
    const uniqueCustomers = Math.max(customersSet.size, Math.round(totalOrdersCount * 0.8) + 3);

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

    // 5. Daily Sales aggregation for the last 7 days
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayLabel = daysOfWeek[d.getDay()];
      last7Days.push({
        day: dayLabel,
        dateString: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        sales: 0
      });
    }

    // Distribute bills sales
    bills.forEach(b => {
      const slot = last7Days.find(s => s.dateString === b.date);
      if (slot) {
        slot.sales += parseFloat(b.amount || 0);
      }
    });

    // Distribute orders sales
    orders.forEach(o => {
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
