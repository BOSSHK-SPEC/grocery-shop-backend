import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * One row per admin/super-admin per calendar day they opened the web
 * console. The (actorId, visitDate) unique index makes recording idempotent,
 * so refreshing the dashboard all day cannot inflate the count — it tracks
 * how many people visited, not how many times the page was requested.
 */
export const DashboardVisit = sequelize.define('DashboardVisit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  actorId: { type: DataTypes.UUID, allowNull: false },
  actorRole: { type: DataTypes.STRING, allowNull: false },
  // Null for the super admin, whose visits count globally rather than
  // against any one franchise.
  tenantId: { type: DataTypes.UUID, allowNull: true },
  visitDate: { type: DataTypes.DATEONLY, allowNull: false }
}, {
  timestamps: true,
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['actorId', 'visitDate'] },
    { fields: ['tenantId'] }
  ]
});
