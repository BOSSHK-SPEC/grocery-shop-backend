import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * One presigned direct upload the server has authorised.
 *
 * The phone never names the object it writes to: the server picks the key,
 * records it here against the user and purpose, and only an intent that is
 * still `issued`, unexpired and owned by the confirming user can be attached
 * to a product, store or profile. That is what stops a client from attaching
 * someone else's upload, an arbitrary object, or the same upload twice.
 */
export const UploadIntent = sequelize.define('UploadIntent', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  purpose: {
    type: DataTypes.STRING(32),
    allowNull: false,
  },
  // Where the phone uploads to: always under pending/ in the private bucket.
  objectKey: {
    type: DataTypes.STRING(512),
    allowNull: false,
  },
  contentType: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  // issued -> consumed (attached) | rejected (not a usable image)
  status: {
    type: DataTypes.STRING(16),
    allowNull: false,
    defaultValue: 'issued',
  },
  // The presigned policy stops accepting the upload after this.
  uploadExpiresAt: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  // Deadline for attaching the upload to a record. Matches the bucket's
  // lifecycle rule: after this the pending object is gone anyway.
  confirmBy: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  consumedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  timestamps: true,
  indexes: [{ fields: ['userId', 'status'] }],
});
