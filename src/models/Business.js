import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const Business = sequelize.define('Business', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  ownerId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  businessName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  businessCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  deliveryRange: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  gstNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  businessDp: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true
});
