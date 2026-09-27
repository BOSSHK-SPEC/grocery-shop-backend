import { sequelize } from '../src/models/index.js';

async function syncSchema() {
  try {
    console.log('[DB Sync] Authenticating...');
    await sequelize.authenticate();
    console.log('[DB Sync] Altering tables to sync schema...');
    await sequelize.sync({ alter: true });
    console.log('[DB Sync] Schema successfully updated!');
    process.exit(0);
  } catch (err) {
    console.error('[DB Sync] Error:', err);
    process.exit(1);
  }
}

syncSchema();
