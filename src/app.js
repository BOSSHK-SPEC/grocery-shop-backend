import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load config
dotenv.config();

// Resolve paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import Sequelize database and models
import { sequelize, BusinessType, ProductCategory } from './models/index.js';

// Initialize App
const app = express();
const PORT = process.env.PORT || 8080;

// Security and utility Middlewares
app.use(helmet({
  crossOriginResourcePolicy: false // Allows images to be fetched cross-origin by the app
}));
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Support base64 image uploads
app.use(morgan('dev'));

// Serve uploaded static files
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Database Connection and Sync
sequelize.authenticate()
  .then(() => {
    console.log('Successfully connected to MySQL database.');
    return sequelize.sync({ alter: true });
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

    const categoryCount = await ProductCategory.count();
    if (categoryCount === 0) {
      await ProductCategory.bulkCreate([
        { category: 'Fruits' },
        { category: 'Vegetables' },
        { category: 'Dairy & Eggs' },
        { category: 'Bakery & Bread' },
        { category: 'Beverages' },
        { category: 'Snacks & Sweets' },
        { category: 'Pantry Staples' }
      ]);
      console.log('Seeded initial Product Categories.');
    }
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

  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Grocery Backend listening at http://localhost:${PORT}`);
});

export default app;
