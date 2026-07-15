import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User, Otp, Address } from '../../models/index.js';
import { saveBase64Image } from '../../utils/helpers.js';

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
      otp: z.string(),
      role: z.enum(['merchant', 'consumer', 'delivery']).optional()
    });
    const { mobile, otpId, otp, role: selectedRole } = schema.parse(req.body);

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

    // Derive role from existing business ownership
    const businessIds = Array.isArray(user.misc?.businessId) ? user.misc.businessId : [];
    const hasBusiness = businessIds.length > 0;

    let role = selectedRole || user.role;
    if (!role) {
      role = hasBusiness ? 'merchant' : 'consumer';
    }

    // Persist role changes
    if (selectedRole && user.role !== selectedRole) {
      user.role = selectedRole;
      await user.save();
    }

    const accessToken = jwt.sign(
      { userId: user.id, role },
      process.env.JWT_SECRET || 'super_secret_jwt_sign_key_12345_grocery_app_2026',
      { expiresIn: '30d' }
    );

    // Return LoginModel format
    return res.status(200).json({
      accessToken,
      tokenType: 'Bearer',
      status: user.status,
      role,
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

export const onboardConsumer = async (req, res, next) => {
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

    const schema = z.object({
      firstName: z.string(),
      lastName: z.string(),
      profilePic: z.string().optional().nullable(),
      address: addressSchema
    });

    const { firstName, lastName, profilePic, address: addressData } = schema.parse(req.body);
    const user = req.user;

    // Update user profile info
    user.firstName = firstName;
    user.lastName = lastName;
    user.status = 'ACTIVE';

    if (profilePic) {
      const picUrl = await saveBase64Image(profilePic);
      if (picUrl) {
        user.profilePic = picUrl;
      }
    }

    await user.save();

    // Create or update address
    let address = await Address.findOne({ where: { userId: user.id } });
    if (address) {
      await address.update(addressData);
    } else {
      address = await Address.create({
        userId: user.id,
        ...addressData
      });
    }

    return res.status(200).json({
      message: 'Consumer profile onboarded successfully',
      user: {
        id: user.id,
        mobileNumber: user.mobileNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePic: user.profilePic,
        status: user.status
      },
      address
    });
  } catch (error) {
    next(error);
  }
};

export const getConsumerProfile = async (req, res, next) => {
  try {
    const user = req.user;
    const address = await Address.findOne({ where: { userId: user.id } });
    return res.status(200).json({
      owner: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        mobileNumber: user.mobileNumber,
        profilePic: user.profilePic,
        email: user.email,
        role: user.role,
        status: user.status,
        misc: user.misc
      },
      address
    });
  } catch (error) {
    next(error);
  }
};

/** Onboards a delivery partner profile with bike and driving license. */
export const onboardDelivery = async (req, res, next) => {
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

    const schema = z.object({
      firstName: z.string(),
      lastName: z.string(),
      bikeRegNumber: z.string(),
      dlPic: z.string().optional().nullable(),
      address: addressSchema
    });

    const { firstName, lastName, bikeRegNumber, dlPic, address: addressData } = schema.parse(req.body);
    const user = req.user;

    user.firstName = firstName;
    user.lastName = lastName;
    user.status = 'ACTIVE';

    let dlPicUrl = null;
    if (dlPic) {
      dlPicUrl = await saveBase64Image(dlPic);
    }

    user.misc = {
      ...user.misc,
      bikeRegNumber,
      dlPic: dlPicUrl || user.misc?.dlPic || ''
    };

    await user.save();

    let address = await Address.findOne({ where: { userId: user.id } });
    if (address) {
      await address.update(addressData);
    } else {
      address = await Address.create({
        userId: user.id,
        ...addressData
      });
    }

    return res.status(200).json({
      message: 'Delivery partner profile onboarded successfully',
      user: {
        id: user.id,
        mobileNumber: user.mobileNumber,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePic: user.profilePic,
        role: user.role,
        status: user.status,
        misc: user.misc
      },
      address
    });
  } catch (error) {
    next(error);
  }
};

/** Registers/refreshes the caller's FCM device token for push notifications. */
export const registerDeviceToken = async (req, res, next) => {
  try {
    const schema = z.object({ deviceToken: z.string().min(1) });
    const { deviceToken } = schema.parse(req.body);
    req.user.deviceToken = deviceToken;
    await req.user.save();
    return res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};
