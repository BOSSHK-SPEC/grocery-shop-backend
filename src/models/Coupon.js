import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

// Promo code redeemable at checkout. businessId null = platform-wide coupon
// (works at any store); set = valid only for that store's orders.
// Redemption counts are read off Order.couponCode rather than a separate
// table — an order row already is the durable proof a code was used.
export const Coupon = sequelize.define('Coupon', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  code: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  businessId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  discountType: {
    type: DataTypes.STRING, // 'flat' | 'percentage'
    allowNull: false
  },
  discountValue: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  maxDiscount: {
    // Cap applied to percentage-type discounts. Ignored for flat.
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  minOrderValue: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  usageLimit: {
    // Total redemptions allowed across all users. null = unlimited.
    type: DataTypes.INTEGER,
    allowNull: true
  },
  perUserLimit: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  validFrom: {
    type: DataTypes.DATE,
    allowNull: true
  },
  validUntil: {
    type: DataTypes.DATE,
    allowNull: true
  },
  description: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true
});
