import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';

// A star rating tied to an order. Used both ways:
//  - consumer rates the delivery rider (rateeRole = 'delivery')
//  - rider rates the consumer            (rateeRole = 'consumer')
export const Rating = sequelize.define('Rating', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  orderId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  raterId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  raterRole: {
    type: DataTypes.STRING, // 'consumer' | 'delivery'
    allowNull: false
  },
  rateeId: {
    type: DataTypes.UUID,
    allowNull: false
  },
  rateeRole: {
    type: DataTypes.STRING, // 'delivery' | 'consumer'
    allowNull: false
  },
  stars: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 5 }
  },
  comment: {
    type: DataTypes.STRING,
    allowNull: true
  }
}, {
  timestamps: true,
  indexes: [
    // One rating per order per rater direction.
    { unique: true, fields: ['orderId', 'raterId'] }
  ]
});
