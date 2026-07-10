import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

export const Address = sequelize.define('Address', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  businessId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  line1: {
    type: DataTypes.STRING,
    allowNull: false
  },
  line2: {
    type: DataTypes.STRING,
    allowNull: true
  },
  locality: {
    type: DataTypes.STRING,
    allowNull: false
  },
  landmark: {
    type: DataTypes.STRING,
    allowNull: true
  },
  district: {
    type: DataTypes.STRING,
    allowNull: true
  },
  state: {
    type: DataTypes.STRING,
    allowNull: true
  },
  country: {
    type: DataTypes.STRING,
    allowNull: true
  },
  pinCode: {
    type: DataTypes.INTEGER,
    allowNull: false
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
