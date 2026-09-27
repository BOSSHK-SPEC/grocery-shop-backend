import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import { toPublicUrl } from '../storage/publicUrl.js';

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
    allowNull: true,
    // Stored as storage references; every response gets a URL for the
    // requesting client. Internal code that needs the stored value must
    // use getDataValue(), or it would persist a URL back.
    get() {
      return toPublicUrl(this.getDataValue('profilePic'));
    }
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
  },
  locationUpdatedAt: {
    // When latitude/longitude were last reported. For a delivery partner this
    // is how a reader tells a live position from a stale one.
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  timestamps: true
});
