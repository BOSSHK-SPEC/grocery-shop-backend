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
  mrp: {
    // Optional "before discount" price. When set and > price, the frontend
    // shows a strikethrough MRP + a "₹X OFF" badge. Null = no discount shown.
    type: DataTypes.DOUBLE,
    allowNull: true
  },
  rating: {
    // Average rating 0-5. Null = no rating shown (never fabricated client-side).
    type: DataTypes.DOUBLE,
    allowNull: true
  },
  ratingCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
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
  },
  inventoryCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  timestamps: true
});
