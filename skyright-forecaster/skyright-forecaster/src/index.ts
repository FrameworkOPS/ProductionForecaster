import express, { Express, Request, Response, NextFunction } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { initializeDatabase, closePool } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/authRoutes';
import jobsRoutes from './routes/jobsRoutes';
import parametersRoutes from './routes/parametersRoutes';
import forecastRoutes from './routes/forecastRoutes';
import hubspotRoutes from './routes/hubspotRoutes';
import insightsRoutes from './routes/insightsRoutes';
import crewsRoutes from './routes/crewsRoutes';
import customProjectsRoutes from './routes/customProjectsRoutes';
import pipelineRoutes from './routes/pipelineRoutes';
import salesForecastRoutes from './routes/salesForecastRoutes';
import crewStaffRoutes from './routes/crewStaffRoutes';
import productionActualsRoutes from './routes/productionActualsRoutes';
import metricsRoutes from './routes/metricsRoutes';
import estimatingRoutes from './routes/estimatingRoutes';
import pricesRoutes from './routes/pricesRoutes';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 5000;

// CORS must run before helmet so headers are present on all responses
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(helmet({ crossOriginResourcePolicy: false }));

// Generous body-parser limits so structured payloads (bulk operations, large
// JSON imports) don't hit the default 100KB ceiling. Actual PDF uploads go
// through multer, not body parser.
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/parameters', parametersRoutes);
app.use('/api/forecasts', forecastRoutes);
app.use('/api/crews', crewsRoutes);
app.use('/api/custom-projects', customProjectsRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/sales-forecast', salesForecastRoutes);
app.use('/api/crew-staff', crewStaffRoutes);
app.use('/api/production-actuals', productionActualsRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/hubspot', hubspotRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/estimating', estimatingRoutes);
app.use('/api/prices', pricesRoutes);

// Serve React frontend static files
const frontendDist = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDist));

// All non-API routes return the React app (client-side routing)
app.use((req: Request, res: Response) => {
  res.sendFile(path.join(frontendDist, 'index.html'));
});

// Error handler (must be last)
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  await closePool();
  process.exit(0);
});

// Start server
async function startServer() {
  try {
    console.log('Initializing database...');
    try {
      await initializeDatabase();
      console.log('✅ Database initialized successfully');
    } catch (dbError) {
      console.warn('⚠️  Database initialization failed (will retry on next request):', (dbError as Error).message);
      console.warn('⚠️  Proceeding without database - configure DATABASE_URL to enable database features');
    }

    app.listen(PORT, () => {
      console.log(`✅ Server running on http://localhost:${PORT}`);
      console.log(`📚 API Health: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
