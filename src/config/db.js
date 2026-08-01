import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.DB_PASS) {
  throw new Error('DB_PASS must be set in production — refusing to start with an empty database password.');
}

const sequelize = new Sequelize(
  process.env.DB_NAME || 'grocery_app',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || '',
  {
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    // Sequelize SQL query logging is disabled — keep the console to API logs
    // (morgan) only. Set SEQUELIZE_LOGGING=true to re-enable for debugging.
    logging: process.env.SEQUELIZE_LOGGING === 'true' ? console.log : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  }
);

export default sequelize;
