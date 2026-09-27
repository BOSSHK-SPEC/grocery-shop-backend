import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * Immutable record of a privileged action (suspend, reactivate, revoke,
 * delete) taken by an admin or super admin against another account or a
 * franchise.
 *
 * Deletes in this system are hard: the target row is gone and cannot be
 * inspected afterwards. This table is therefore the ONLY surviving evidence
 * of who removed what and why, so it deliberately stores a snapshot of the
 * target rather than a foreign key to it — an FK would be nulled or cascade
 * away with the very row it is meant to account for.
 */
export const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  // Who performed it. Kept as a plain column, not an association: the actor
  // may themselves be deleted later, and this row must outlive them.
  actorId: { type: DataTypes.UUID, allowNull: false },
  actorRole: { type: DataTypes.STRING, allowNull: false },
  actorMobile: { type: DataTypes.STRING, allowNull: true },

  // What was done: SUSPEND | REACTIVATE | REVOKE_SESSIONS | DELETE_USER |
  // DELETE_REQUEST | SUSPEND_TENANT | REACTIVATE_TENANT | DELETE_TENANT
  action: { type: DataTypes.STRING, allowNull: false },

  targetType: { type: DataTypes.STRING, allowNull: false }, // 'USER' | 'TENANT'
  targetId: { type: DataTypes.UUID, allowNull: false },

  // Snapshot of the target as it was at the moment of the action, so a hard
  // delete stays explainable (role, mobile, franchise, what was cascaded).
  targetSnapshot: { type: DataTypes.JSON, allowNull: true },

  reason: { type: DataTypes.STRING(500), allowNull: true },
  ip: { type: DataTypes.STRING, allowNull: true }
}, {
  timestamps: true,
  updatedAt: false, // append-only: a written audit row is never modified
  indexes: [
    { fields: ['actorId'] },
    { fields: ['targetId'] },
    { fields: ['action'] }
  ]
});
