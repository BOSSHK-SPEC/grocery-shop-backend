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
import { Notification } from './Notification.js';
import { ChatMessage } from './ChatMessage.js';
import { Tenant } from './Tenant.js';
import { Rating } from './Rating.js';
import { Complaint } from './Complaint.js';
import { RefreshToken } from './RefreshToken.js';
import { Favorite } from './Favorite.js';
import { Coupon } from './Coupon.js';

// Setup Relationships

// Tenant - User (One to Many)
Tenant.hasMany(User, { foreignKey: 'tenantId', as: 'users' });
User.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

// Tenant - Business (One to Many)
Tenant.hasMany(Business, { foreignKey: 'tenantId', as: 'businesses' });
Business.belongsTo(Tenant, { foreignKey: 'tenantId', as: 'tenant' });

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

// User - Notification (One to Many)
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications', onDelete: 'CASCADE' });
Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User - Order (Delivery Partner relationship)
User.hasMany(Order, { foreignKey: 'deliveryPartnerId', as: 'deliveries' });
Order.belongsTo(User, { foreignKey: 'deliveryPartnerId', as: 'deliveryPartner' });

// Order - ChatMessage (One to Many)
Order.hasMany(ChatMessage, { foreignKey: 'orderId', as: 'chatMessages', onDelete: 'CASCADE' });
ChatMessage.belongsTo(Order, { foreignKey: 'orderId' });

// Order - Rating / Complaint (One to Many)
Order.hasMany(Rating, { foreignKey: 'orderId', as: 'ratings', onDelete: 'CASCADE' });
Rating.belongsTo(Order, { foreignKey: 'orderId' });
Order.hasMany(Complaint, { foreignKey: 'orderId', as: 'complaints', onDelete: 'CASCADE' });
Complaint.belongsTo(Order, { foreignKey: 'orderId' });

// User - RefreshToken (One to Many)
User.hasMany(RefreshToken, { foreignKey: 'userId', as: 'refreshTokens', onDelete: 'CASCADE' });
RefreshToken.belongsTo(User, { foreignKey: 'userId' });

// User - Favorite / Product - Favorite (One to Many)
User.hasMany(Favorite, { foreignKey: 'userId', as: 'favorites', onDelete: 'CASCADE' });
Favorite.belongsTo(User, { foreignKey: 'userId' });
Product.hasMany(Favorite, { foreignKey: 'productId', as: 'favoritedBy', onDelete: 'CASCADE' });
Favorite.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// Business - Coupon (One to Many). businessId nullable => platform-wide coupon.
Business.hasMany(Coupon, { foreignKey: 'businessId', as: 'coupons', onDelete: 'CASCADE' });
Coupon.belongsTo(Business, { foreignKey: 'businessId', as: 'business' });

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
  Notification,
  ChatMessage,
  BusinessBusinessType,
  Tenant,
  Rating,
  Complaint,
  RefreshToken,
  Favorite,
  Coupon
};
