import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  mobileNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  firstName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  userName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: true
  },
  language: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'ONBOARDING_PROGRESS'
  },
  role: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'consumer'
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  misc: {
    type: DataTypes.JSON,
    allowNull: true,
    defaultValue: { businessId: [] }
  },
  profilePic: {
    type: DataTypes.STRING,
    allowNull: true
  },
  deviceToken: {
    // FCM registration token for push notifications (nullable until registered).
    type: DataTypes.STRING,
    allowNull: true
  },
  latitude: {
    type: DataTypes.DOUBLE,
    allowNull: true
  },
  longitude: {
    type: DataTypes.DOUBLE,
    allowNull: true
  }
}, {
  timestamps: true
});
