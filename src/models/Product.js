import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  businessId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  productCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  brandName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  productName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  productThumbnail: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  price: {
    type: DataTypes.DOUBLE,
    allowNull: false
  },
  pricePerQuantity: {
    type: DataTypes.DOUBLE,
    allowNull: false
  },
  pricePerQuantityUnit: {
    type: DataTypes.STRING,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false
  },
  totalQuantity: {
    type: DataTypes.DOUBLE,
    allowNull: false
  },
  totalQuantityUnit: {
    type: DataTypes.STRING,
    allowNull: false
  }
}, {
  timestamps: true
});
