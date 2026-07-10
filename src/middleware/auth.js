import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export const authGuard = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Authentication required. Format: Bearer <token>' } });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'super_secret_jwt_sign_key_12345_grocery_app_2026');

    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: { message: 'User not found or session expired.' } });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth Guard Error:', error.message);
    return res.status(401).json({ error: { message: 'Invalid or expired token.' } });
  }
};
