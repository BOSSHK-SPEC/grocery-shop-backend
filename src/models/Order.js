import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  businessId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  customerId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  orderCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  status: {
    // Canonical values are validated in code via orderStatus.js (state machine).
    // Stored as STRING (not ENUM) so the lifecycle can evolve without fragile
    // MySQL ENUM migrations.
    type: DataTypes.STRING,
    defaultValue: 'Pending',
    allowNull: false
  },
  statusHistory: {
    // Audit trail: [{ status, by: 'merchant'|'customer', at: ISOString }]
    type: DataTypes.JSON,
    allowNull: true
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  items: {
    type: DataTypes.JSON,
    allowNull: false
  },
  deliveryAddress: {
    // Snapshot of the delivery address chosen at checkout, so the order keeps
    // the correct address even if the customer later edits/removes it.
    type: DataTypes.JSON,
    allowNull: true
  },
  deliveryPartnerId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  paymentMethod: {
    type: DataTypes.STRING, // 'razorpay' | 'cod'
    allowNull: false,
    defaultValue: 'cod'
  },
  paymentStatus: {
    type: DataTypes.STRING, // 'PAID' | 'PENDING' | 'COD'
    allowNull: false,
    defaultValue: 'COD'
  },
  paymentId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  paymentOrderId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  couponCode: {
    type: DataTypes.STRING,
    allowNull: true
  },
  couponDiscount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  tipAmount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  noPlasticBag: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  deliveryInstructions: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true
});
