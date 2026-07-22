import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

// A complaint raised by a consumer about a delivery (or merchant) for an order.
export const Complaint = sequelize.define('Complaint', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  orderId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  complainantId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  against: {
    type: DataTypes.STRING, // 'delivery' | 'merchant'
    allowNull: false,
    defaultValue: 'delivery'
  },
  subject: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING, // 'OPEN' | 'IN_REVIEW' | 'RESOLVED'
    allowNull: false,
    defaultValue: 'OPEN'
  }
}, {
  timestamps: true
});
