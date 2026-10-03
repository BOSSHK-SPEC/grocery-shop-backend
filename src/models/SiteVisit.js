import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

/**
 * One row per unique visitor per calendar day on the public marketing site
 * (the "intro" pages) — visitors here are anonymous, so this is keyed by IP
 * rather than an account. The (ip, visitDate) unique index makes recording
 * idempotent, mirroring DashboardVisit's pattern: calling it on every page
 * load is safe and can never inflate the count beyond one per visitor per
 * day.
 */
export const SiteVisit = sequelize.define('SiteVisit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  ip: { type: DataTypes.STRING, allowNull: false },
  visitDate: { type: DataTypes.DATEONLY, allowNull: false }
}, {
  timestamps: true,
  updatedAt: false,
  indexes: [
    { unique: true, fields: ['ip', 'visitDate'] }
  ]
});
