import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

// Opaque refresh tokens, stored as SHA-256 hashes (never the raw value).
// Rotation: on use, the old row is revoked and linked to its replacement so
// reuse of a already-rotated token can be detected (token-theft signal).
export const RefreshToken = sequelize.define('RefreshToken', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  tokenHash: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  revoked: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  replacedByHash: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [{ fields: ['userId'] }]
});
