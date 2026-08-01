import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { initWebSocket } from './utils/websocket.js';

// Load config
dotenv.config();

// Resolve paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Sequelize database and models
import { sequelize, BusinessType, ProductCategory, Tenant, Coupon } from './models/index.js';
import { CATEGORY_SEED } from './config/categories.js';

// Initialize App
const app = express();
const PORT = process.env.PORT || 8080;

// Security and utility Middlewares
app.use(helmet({
  crossOriginResourcePolicy: false // Allows images to be fetched cross-origin by the app
}));

// CORS: restrict to an explicit allowlist when CORS_ORIGINS is set
// (comma-separated). Falls back to allow-all in development so local
// tooling keeps working without extra setup.
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
if (corsOrigins.length === 0 && process.env.NODE_ENV === 'production') {
  console.warn('[CORS] CORS_ORIGINS is not set in production — allowing all origins. Set CORS_ORIGINS to a comma-separated allowlist to restrict this.');
}
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : {}));

app.use(express.json({ limit: '10mb' })); // Support base64 image uploads
app.use(morgan('dev'));

// Serve uploaded static files
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Database Connection and Sync
// TODO: replace with sequelize-cli migrations before this app has been
// through its first production schema change without alter. Until then,
// alter:true keeps auto-applying new columns/tables (set DB_SYNC_ALTER=false
// once the schema is stable to stop live-altering the prod database).
const shouldAlterSync = process.env.DB_SYNC_ALTER !== 'false';
if (shouldAlterSync && process.env.NODE_ENV === 'production') {
  console.warn('[DB] Starting with sequelize.sync({ alter: true }) in production — this can make unreviewed schema changes. Set DB_SYNC_ALTER=false once your schema is stable and switch to migrations.');
}
sequelize.authenticate()
  .then(() => {
    console.log('Successfully connected to MySQL database.');
    return sequelize.sync({ alter: shouldAlterSync });
  })
  .then(() => {
    console.log('Database synchronized.');
    return seedDatabase();
  })
  .catch(err => {
    console.error('MySQL connection or synchronization error:', err);
  });

// Seed Initial Data Helper
async function seedDatabase() {
  try {
    const businessCount = await BusinessType.count();
    if (businessCount === 0) {
      await BusinessType.bulkCreate([
        { businessType: 'Grocery Store' },
        { businessType: 'Supermarket' },
        { businessType: 'Fruit & Vegetable Shop' },
        { businessType: 'Dairy Boutique' },
        { businessType: 'Bakery' }
      ]);
      console.log('Seeded initial Business Types.');
    }

    // Upsert the full category taxonomy so new categories are added and
    // existing rows are backfilled with icon/units/order on each startup.
    let categoriesSynced = 0;
    for (const cat of CATEGORY_SEED) {
      const [row, created] = await ProductCategory.findOrCreate({
        where: { category: cat.category },
        defaults: { icon: cat.icon, units: cat.units, displayOrder: cat.displayOrder }
      });
      if (!created) {
        await row.update({ icon: cat.icon, units: cat.units, displayOrder: cat.displayOrder });
      }
      categoriesSynced += 1;
    }
    console.log(`Synced ${categoriesSynced} Product Categories.`);

    const tenantCount = await Tenant.count();
    if (tenantCount === 0) {
      await Tenant.bulkCreate([
        { name: 'FreshMart Grocery', code: 'FRESH', status: 'ACTIVE' },
        { name: 'MedLife Pharmacy', code: 'PHARMA', status: 'ACTIVE' }
      ]);
      console.log('Seeded initial Tenants.');
    }

    // Two platform-wide starter coupons so the checkout coupon UI has real,
    // redeemable codes out of the box — findOrCreate keeps this idempotent
    // across restarts without overwriting an admin's later edits.
    const [, welcomeCreated] = await Coupon.findOrCreate({
      where: { code: 'WELCOME50' },
      defaults: {
        code: 'WELCOME50',
        businessId: null,
        discountType: 'flat',
        discountValue: 50,
        minOrderValue: 300,
        perUserLimit: 1,
        description: 'Flat ₹50 off on your first order'
      }
    });
    const [, saveCreated] = await Coupon.findOrCreate({
      where: { code: 'SAVE10' },
      defaults: {
        code: 'SAVE10',
        businessId: null,
        discountType: 'percentage',
        discountValue: 10,
        maxDiscount: 100,
        minOrderValue: 500,
        perUserLimit: 3,
        description: '10% off up to ₹100'
      }
    });
    if (welcomeCreated || saveCreated) console.log('Seeded starter coupons.');
  } catch (error) {
    console.error('Database seeding failed:', error.message);
  }
}

// Global health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: 'MySQL', timestamp: new Date() });
});

// Import and use API routes
import { apiRouter } from './routes/api.js';
app.use('/api', apiRouter);

// Compatibility route matching (direct non-prefixed calls from Flutter app if any)
app.use('/', apiRouter);

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);

  // Handle JSON parsing or Zod validation errors nicely
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        details: err.errors
      }
    });
  }

  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  // In production, only surface messages for expected 4xx client errors;
  // hide internal/5xx error details (ORM/driver messages, stack traces) from clients.
  const message = (!isProd || status < 500) ? (err.message || 'Internal Server Error') : 'Internal Server Error';

  res.status(status).json({
    error: { message, status }
  });
});

// Start Server
const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Grocery Backend listening at http://localhost:${PORT}`);
});

// Graceful shutdown: stop accepting new connections and close the DB pool
// before exiting, so in-flight requests aren't dropped mid-response.
const shutdown = (signal) => {
  console.log(`[Shutdown] ${signal} received, closing server...`);
  server.close(async () => {
    try {
      await sequelize.close();
    } catch (err) {
      console.error('[Shutdown] Error closing database connection:', err);
    }
    console.log('[Shutdown] Server closed.');
    process.exit(0);
  });
  // Force-exit if shutdown hangs (e.g. a stuck connection).
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  process.exit(1);
});

export default app;
