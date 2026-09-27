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
import { storageRequestContext } from './storage/requestContext.js';
import { verifyStorage } from './storage/imageStorage.js';
import { BUSINESS_TYPE_SEED } from './config/businessTypes.js';

// Initialize App
const app = express();
// Behind the reverse proxy (nginx) the client IP arrives in X-Forwarded-For.
// Trusting exactly one hop lets express-rate-limit key on the real client IP
// instead of lumping every user into the proxy's single bucket (and clears
// its ERR_ERL_UNEXPECTED_X_FORWARDED_FOR error).
app.set('trust proxy', 1);
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

// 10mb still covers older app versions that send images as base64 inside
// the JSON. Current versions upload straight to object storage and send only
// a short "upload:<id>" reference.
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Lets image references in responses become links for *this* client
// (see src/storage/requestContext.js).
app.use(storageRequestContext);

// LEGACY, read-only: images uploaded before object storage lived on local
// disk and some rows still point here. Nothing writes to this folder any
// more. Remove once `npm run storage:migrate -- --apply` has moved them.
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Image storage must work before the server claims to be healthy. In
// production a missing or unreachable store stops startup outright — the
// alternative is a server that accepts products and silently drops their
// photos. Locally it is a loud warning so the rest of the API stays usable.
let storageReady = false;
verifyStorage()
  .then(() => {
    storageReady = true;
    console.log('[Storage] Object storage ready.');
  })
  .catch((err) => {
    if (process.env.NODE_ENV === 'production') {
      console.error(`[Storage] FATAL: ${err.message}`);
      process.exit(1);
    }
    console.warn(`[Storage] Image uploads will fail until this is fixed: ${err.message}`);
  });

// Database Connection and Sync
// sync() creates any missing tables and never touches existing ones. That is
// the default on purpose: sync({ alter: true }) re-issues every `unique: true`
// column as a brand-new UNIQUE index on each boot (orderCode, orderCode_2, ...),
// and MySQL stops at 64 indexes per table, after which startup fails with
// ER_TOO_MANY_KEYS. Adding a column to an existing table is therefore an
// explicit act: run once with DB_SYNC_ALTER=true, then switch it back off.
// TODO: replace with sequelize-cli migrations before the first production
// schema change.
const shouldAlterSync = process.env.DB_SYNC_ALTER === 'true';
if (shouldAlterSync) {
  console.warn('[DB] DB_SYNC_ALTER=true: altering tables to match the models. Run this once, then unset it — it adds a duplicate unique index per run.');
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
    // Upsert the full business-type list so newly added types show up in the
    // onboarding dropdown on the next restart. findOrCreate keeps this
    // idempotent and never renames or removes a type a business is linked to.
    let businessTypesAdded = 0;
    for (const businessType of BUSINESS_TYPE_SEED) {
      const [, created] = await BusinessType.findOrCreate({
        where: { businessType },
        defaults: { businessType }
      });
      if (created) businessTypesAdded += 1;
    }
    if (businessTypesAdded > 0) {
      console.log(`Seeded ${businessTypesAdded} new Business Types.`);
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
  res.json({
    status: 'ok',
    database: 'MySQL',
    storage: storageReady ? 'ok' : 'unavailable',
    timestamp: new Date()
  });
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

  // A stable machine-readable code (e.g. UPLOAD_INVALID) lets clients react
  // to a specific failure without parsing the message.
  const code = (!isProd || status < 500) ? err.code : undefined;
  res.status(status).json({
    error: { message, status, ...(typeof code === 'string' ? { code } : {}) }
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
