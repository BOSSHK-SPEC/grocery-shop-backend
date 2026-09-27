import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import { toPublicUrl } from '../storage/publicUrl.js';

export const Business = sequelize.define('Business', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  ownerId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  tenantId: {
    type: DataTypes.UUID,
    allowNull: true
  },
  businessName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  businessCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  deliveryRange: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  gstNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  businessDp: {
    type: DataTypes.STRING,
    allowNull: true,
    // Stored as storage references; every response gets a URL for the
    // requesting client. Internal code that needs the stored value must
    // use getDataValue(), or it would persist a URL back.
    get() {
      return toPublicUrl(this.getDataValue('businessDp'));
    }
  },
  storePhone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  openingHours: {
    type: DataTypes.JSON,
    allowNull: true
  },
  acceptingOrders: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  pausedUntil: {
    type: DataTypes.DATE,
    allowNull: true
  },
  minimumOrder: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  kyc: {
    type: DataTypes.JSON,
    allowNull: true
  },
  payoutAccount: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  timestamps: true
});
