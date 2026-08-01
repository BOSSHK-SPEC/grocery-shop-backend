import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

// A user's saved/wishlisted product.
export const Favorite = sequelize.define('Favorite', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  productId: {
    type: DataTypes.UUID,
    allowNull: false
  }
}, {
  timestamps: true,
  indexes: [
    // One favorite row per user/product pair.
    { unique: true, fields: ['userId', 'productId'] }
  ]
});
