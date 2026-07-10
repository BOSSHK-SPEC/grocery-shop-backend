import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const BusinessType = sequelize.define('BusinessType', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  businessType: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
}, {
  timestamps: true
});
