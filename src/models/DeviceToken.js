import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * One FCM registration token for one signed-in device/browser. A user can
 * hold several at once (phone app + a browser tab, or two browsers) — every
 * row gets pushed to; notify.sendToUser() removes a row the moment FCM
 * reports its token as dead, so the table self-cleans without a cron job.
 */
export const DeviceToken = sequelize.define('DeviceToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  token: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  // 'android' | 'ios' | 'web' | 'unknown' — picks the FCM payload shape
  // (webpush click link vs android/apns) in notify.sendToUser().
  platform: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'unknown'
  },
  lastSeenAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: true
});
