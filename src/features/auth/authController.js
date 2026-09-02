import crypto from 'crypto';
import { z } from 'zod';
import { User, Otp, Address, Tenant } from '../../models/index.js';
import { saveBase64Image } from '../../utils/helpers.js';
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../../utils/tokens.js';

// Generates a 6-digit OTP from a CSPRNG (Math.random is predictable).
const generateOTP = () => {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
};

// The fixed dev OTP (DEV_OTP, default '200310') is only issued when BOTH hold:
// the operator opted in with ALLOW_DEV_OTP=true AND the process is not
// running as production. A missing/mistyped NODE_ENV alone can no longer
// turn it on.
const isDevOtpEnabled = () =>
  process.env.ALLOW_DEV_OTP === 'true' && process.env.NODE_ENV !== 'production';

// The fixed code issued to EVERY account while the dev flag is on.
// Configurable so the team can rotate it without a code change.
const DEV_OTP = (process.env.DEV_OTP || '200310').trim();

// ── Review / demo accounts ──────────────────────────────────────────────
// App-store reviewers (Google Play "App access", Apple review) cannot
// receive SMS. REVIEW_PHONES is a comma-separated list of phone numbers
// that always get the fixed REVIEW_OTP — in every environment, production
// included. The code is never logged and never included in the response,
// so it is only known to the operator and the store's review form.
// Example: REVIEW_PHONES=9999900001  REVIEW_OTP=804203
const reviewOtpFor = (mobile) => {
  const phones = (process.env.REVIEW_PHONES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const code = (process.env.REVIEW_OTP || '').trim();
  if (!code || phones.length === 0) return null;
  const normalized = mobile.replace(/[^0-9]/g, '');
  return phones.some((p) => {
    const pn = p.replace(/[^0-9]/g, '');
    return pn === normalized || normalized.endsWith(pn) || pn.endsWith(normalized);
  })
    ? code
    : null;
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

    const reviewOtp = reviewOtpFor(mobile);
    const devOtp = !reviewOtp && isDevOtpEnabled();
    const otpCode = reviewOtp || (devOtp ? DEV_OTP : generateOTP());
    const expiry = new Date(Date.now() + (parseInt(process.env.OTP_EXPIRY_MINUTES) || 5) * 60 * 1000);

    const otpRecord = await Otp.create({
      mobileNumber: mobile,
      otp: otpCode,
      expiresAt: expiry
    });

    // The OTP value itself is only ever logged under the explicit dev flag
    // (review-account codes are never logged at all).
    if (reviewOtp) {
      console.log(`[OTP] Review-account OTP issued for ${mobile} (otpId: ${otpRecord.otpId})`);
    } else if (devOtp) {
      console.log(`[OTP] DEV OTP issued for ${mobile}: ${otpCode} (otpId: ${otpRecord.otpId})`);
    } else {
      console.log(`[OTP] Generated for ${mobile} (otpId: ${otpRecord.otpId})`);
    }

    // Return format matching UserModel. The OTP is never part of the
    // response except under the dev flag (handy for local emulators).
    return res.status(200).json({
      id: otpRecord.otpId,
      name: user.firstName || null,
      email: user.email || null,
      ...(devOtp ? { devOtp: otpCode } : {})
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
    const adminMobile = process.env.ADMIN_MOBILE || '9000000000';
    if (mobileNumber === adminMobile) {
      user.role = 'admin';
      user.status = 'ACTIVE';
      await user.save();
    }
    const tempToken = signAccessToken({ userId: user.id, isTemp: true }, { expiresIn: '15m' });

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
      role: z.enum(['merchant', 'consumer', 'delivery', 'admin', 'super_admin']).optional()
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
      if (!pendingOtp || new Date(pendingOtp.expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ error: { message: 'Invalid or expired OTP.' } });
      }
      pendingOtp.status = 'VERIFIED';
      await pendingOtp.save();
    }

    const user = await User.findOne({ where: { mobileNumber: mobile } });
    const adminMobile = process.env.ADMIN_MOBILE || '9000000000';
    const superAdminMobile = process.env.SUPER_ADMIN_MOBILE || '9999999999';

    if (selectedRole === 'admin') {
      const isMasterAdmin = mobile === adminMobile;
      const isPromotedAdmin = user && (user.role === 'admin' || user.role === 'super_admin');
      if (!isMasterAdmin && !isPromotedAdmin) {
        return res.status(400).json({ error: { message: 'Access denied. Only registered admins can log in as admin.' } });
      }
    }
    if (selectedRole === 'super_admin' && mobile !== superAdminMobile) {
      return res.status(400).json({ error: { message: 'Access denied. Only the registered super admin mobile number can log in as super admin.' } });
    }

    // Derive role from existing business ownership
    const businessIds = Array.isArray(user.misc?.businessId) ? user.misc.businessId : [];
    const hasBusiness = businessIds.length > 0;

    let role = selectedRole || user.role;
    if (mobile === superAdminMobile) {
      role = 'super_admin';
    } else if (mobile === adminMobile) {
      role = 'admin';
    } else {
      const isPromotedAdmin = user && (user.role === 'admin' || user.role === 'super_admin');
      if (role === 'admin' && !isPromotedAdmin) {
        role = 'consumer';
      }
      if (role === 'super_admin') {
        role = 'consumer';
      }
      if (!role) {
        role = hasBusiness ? 'merchant' : 'consumer';
      }
    }

    // Persist role changes
    if (mobile === superAdminMobile) {
      user.role = 'super_admin';
      user.status = 'ACTIVE';
      await user.save();
    } else if (mobile === adminMobile) {
      user.role = 'admin';
      user.status = 'ACTIVE';
      await user.save();
    } else if (selectedRole && selectedRole !== 'admin' && selectedRole !== 'super_admin' && user.role !== selectedRole) {
      user.role = selectedRole;
      await user.save();
    }

    const accessToken = signAccessToken({ userId: user.id, role });
    const { token: refreshToken } = await issueRefreshToken(user.id);

    // Return LoginModel format
    return res.status(200).json({
      accessToken,
      refreshToken,
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

/**
 * POST /auth/refresh — exchange a valid refresh token for a fresh access token
 * and a rotated refresh token. On reuse of an already-rotated token, all of the
 * user's refresh tokens are revoked (theft response) and 401 is returned.
 */
export const refreshToken = async (req, res, next) => {
  try {
    const provided = req.body?.refreshToken;
    const rotated = await rotateRefreshToken(provided);
    const user = await User.findByPk(rotated.userId);
    if (!user) {
      return res.status(401).json({ error: { message: 'User not found.' } });
    }
    const accessToken = signAccessToken({ userId: user.id, role: user.role });
    return res.status(200).json({
      accessToken,
      refreshToken: rotated.refreshToken,
      tokenType: 'Bearer',
      role: user.role,
      status: user.status
    });
  } catch (error) {
    if (error.code) {
      return res.status(401).json({ error: { message: error.message, code: error.code } });
    }
    next(error);
  }
};

// POST /auth/logout — revoke the presented refresh token (best-effort).
export const logout = async (req, res, next) => {
  try {
    await revokeRefreshToken(req.body?.refreshToken);
    return res.status(200).json({ message: 'Logged out.' });
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

    // Create or update the user's default address
    let address = await Address.findOne({
      where: { userId: user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'ASC']]
    });
    if (address) {
      await address.update(addressData);
    } else {
      address = await Address.create({
        userId: user.id,
        isDefault: true,
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
    const address = await Address.findOne({
      where: { userId: user.id },
      order: [['isDefault', 'DESC'], ['createdAt', 'ASC']]
    });
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
      tenantId: z.string().optional().nullable(),
      address: addressSchema
    });

    const { firstName, lastName, bikeRegNumber, dlPic, tenantId, address: addressData } = schema.parse(req.body);
    const user = req.user;

    user.firstName = firstName;
    user.lastName = lastName;
    user.status = 'PENDING_APPROVAL';
    user.role = 'delivery';
    if (tenantId && tenantId !== 'standalone') {
      user.tenantId = tenantId;
    } else {
      user.tenantId = null;
    }

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

export const getTenantsPublic = async (req, res, next) => {
  try {
    const tenants = await Tenant.findAll({
      where: { status: 'ACTIVE' },
      attributes: ['id', 'name', 'code']
    });
    return res.status(200).json(tenants);
  } catch (error) {
    next(error);
  }
};

/** Verified 2-Step OTP Account Deletion */
export const deleteAccount = async (req, res, next) => {
  try {
    const schema = z.object({
      mobileNumber: z.string().min(10),
      otpId: z.string(),
      otp: z.string(),
      reason: z.string().optional()
    });
    const { mobileNumber, otpId, otp, reason } = schema.parse(req.body);

    const otpRecord = await Otp.findOne({
      where: { otpId, mobileNumber, otp, status: 'PENDING' }
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: { message: 'Invalid or expired OTP.' } });
    }

    otpRecord.status = 'VERIFIED';
    await otpRecord.save();

    const user = await User.findOne({ where: { mobileNumber } });
    if (user) {
      await User.destroy({ where: { id: user.id } });
      console.log(`[Account Deletion] User ${mobileNumber} deleted successfully. Reason: ${reason || 'Not provided'}`);
    } else {
      console.log(`[Account Deletion] No active user found for ${mobileNumber}, marked verification verified.`);
    }

    return res.status(200).json({
      success: true,
      message: 'Account and associated personal data deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};
