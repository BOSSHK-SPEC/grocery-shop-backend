import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const Bill = sequelize.define('Bill', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  businessId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  billCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  mobile: {
    type: DataTypes.STRING,
    allowNull: true
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  rows: {
    type: DataTypes.JSON,
    allowNull: false
  },
  // Client-generated, carried in the `Idempotency-Key` header. Lets a
  // network-timeout retry of the exact same "Create Bill" tap return the
  // original bill instead of billing (and decrementing stock) twice — see
  // `billingController.js#createBill`. Null for callers that do not send
  // one; MySQL's unique index treats every NULL as distinct, so those never
  // collide with each other.
  idempotencyKey: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    { unique: true, fields: ['businessId', 'idempotencyKey'] }
  ]
});
