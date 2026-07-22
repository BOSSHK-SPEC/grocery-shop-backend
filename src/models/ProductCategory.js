import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const ProductCategory = sequelize.define('ProductCategory', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  icon: {
    type: DataTypes.STRING,
    allowNull: true
  },
  units: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: []
  },
  displayOrder: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  timestamps: true
});
