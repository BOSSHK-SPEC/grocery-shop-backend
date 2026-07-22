import { User } from '../models/index.js';
import { verifyAccessToken } from '../utils/tokens.js';

export const authGuard = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Authentication required. Format: Bearer <token>' } });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: { message: 'User not found or session expired.' } });
    }

    req.user = user;
    req.userRole = decoded.role;
    next();
  } catch (error) {
    console.error('Auth Guard Error:', error.message);
    return res.status(401).json({ error: { message: 'Invalid or expired token.' } });
  }
};

export const adminGuard = (req, res, next) => {
  if (req.user && (req.userRole === 'admin' || req.user.role === 'admin' || req.userRole === 'super_admin' || req.user.role === 'super_admin')) {
    return next();
  }
  return res.status(403).json({ error: { message: 'Access denied. Admin privileges required.' } });
};

export const superAdminGuard = (req, res, next) => {
  if (req.user && (req.userRole === 'super_admin' || req.user.role === 'super_admin')) {
    return next();
  }
  return res.status(403).json({ error: { message: 'Access denied. Super Admin privileges required.' } });
};
