import sequelize from '../config/db.js';
import { User } from './User.js';
import { Otp } from './Otp.js';
import { Business } from './Business.js';
import { Address } from './Address.js';
import { BusinessType } from './BusinessType.js';
import { ProductCategory } from './ProductCategory.js';
import { Product } from './Product.js';
import { Order } from './Order.js';
import { Bill } from './Bill.js';

// Setup Relationships

// User - Business (One to Many)
User.hasMany(Business, { foreignKey: 'ownerId', as: 'businesses' });
Business.belongsTo(User, { foreignKey: 'ownerId', as: 'owner' });

// Business - Address (One to One)
Business.hasOne(Address, { foreignKey: 'businessId', as: 'address', onDelete: 'CASCADE' });
Address.belongsTo(Business, { foreignKey: 'businessId' });

// User - Address (One to One)
User.hasOne(Address, { foreignKey: 'userId', as: 'address', onDelete: 'CASCADE' });
Address.belongsTo(User, { foreignKey: 'userId' });

// Business - Product (One to Many)
Business.hasMany(Product, { foreignKey: 'businessId', as: 'products', onDelete: 'CASCADE' });
Product.belongsTo(Business, { foreignKey: 'businessId', as: 'business' });

// Business - Order (One to Many)
Business.hasMany(Order, { foreignKey: 'businessId', as: 'orders', onDelete: 'CASCADE' });
Order.belongsTo(Business, { foreignKey: 'businessId' });

// User - Order (One to Many)
User.hasMany(Order, { foreignKey: 'customerId', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'customerId', as: 'customer' });

// Business - Bill (One to Many)
Business.hasMany(Bill, { foreignKey: 'businessId', as: 'bills', onDelete: 'CASCADE' });
Bill.belongsTo(Business, { foreignKey: 'businessId' });

// Business - BusinessType (Many to Many)
const BusinessBusinessType = sequelize.define('BusinessBusinessType', {}, { timestamps: false });
Business.belongsToMany(BusinessType, { through: BusinessBusinessType, foreignKey: 'businessId', as: 'businessType' });
BusinessType.belongsToMany(Business, { through: BusinessBusinessType, foreignKey: 'businessTypeId' });

export {
  sequelize,
  User,
  Otp,
  Business,
  Address,
  BusinessType,
  ProductCategory,
  Product,
  Order,
  Bill,
  BusinessBusinessType
};
