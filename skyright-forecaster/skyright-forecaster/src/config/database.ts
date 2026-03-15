import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Support both Railway's DATABASE_URL and individual environment variables
const poolConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'skyright_forecaster',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    };

const pool = new Pool(poolConfig);

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
});

export async function getConnection(): Promise<PoolClient> {
  return pool.connect();
}

export async function query(text: string, params?: any[]) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Query executed', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('Database query error', error);
    throw error;
  }
}

export async function initializeDatabase(): Promise<void> {
  try {
    // Create tables if they don't exist
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        role VARCHAR(50) NOT NULL DEFAULT 'viewer',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS crews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        crew_name VARCHAR(255) NOT NULL,
        crew_type VARCHAR(50) NOT NULL,
        team_members INTEGER NOT NULL,
        training_period_days INTEGER NOT NULL,
        start_date DATE NOT NULL,
        terminate_date DATE,
        revenue_per_sq DECIMAL(10, 2),
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id VARCHAR(100) NOT NULL UNIQUE,
        hubspot_id VARCHAR(100),
        crew_id UUID REFERENCES crews(id),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        install_date DATE NOT NULL,
        estimated_duration INTEGER NOT NULL,
        crew_size INTEGER NOT NULL,
        crew_type VARCHAR(50),
        square_footage DECIMAL(10, 2),
        revenue DECIMAL(10, 2),
        job_address TEXT,
        customer_name VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS custom_projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        crew_id UUID NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
        project_name VARCHAR(255) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS production_parameters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        current_production_rate DECIMAL(10, 2) NOT NULL,
        ramp_up_time_days INTEGER NOT NULL,
        crew_capacity INTEGER NOT NULL,
        max_concurrent_jobs INTEGER NOT NULL,
        seasonal_adjustment DECIMAL(5, 2) DEFAULT 1.0,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by UUID REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS forecasts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_date DATE NOT NULL,
        predicted_capacity DECIMAL(10, 2) NOT NULL,
        predicted_revenue DECIMAL(12, 2),
        confidence_score DECIMAL(5, 2),
        bottleneck_detected BOOLEAN DEFAULT false,
        bottleneck_description TEXT,
        parameters_snapshot JSONB,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS forecast_details (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id UUID NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        job_id UUID NOT NULL REFERENCES jobs(id),
        crew_id UUID REFERENCES crews(id),
        predicted_completion_date DATE,
        completion_probability DECIMAL(5, 2),
        ramp_up_multiplier DECIMAL(5, 2),
        ramp_down_multiplier DECIMAL(5, 2),
        blocked_by_project BOOLEAN DEFAULT false,
        risk_flag BOOLEAN DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100),
        entity_id UUID,
        old_values JSONB,
        new_values JSONB,
        timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pipeline_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_type VARCHAR(50) NOT NULL,
        square_footage DECIMAL(10, 2) NOT NULL,
        estimated_days_to_completion INTEGER NOT NULL,
        revenue_per_sq DECIMAL(10, 2) NOT NULL,
        total_revenue DECIMAL(12, 2) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        added_date DATE NOT NULL,
        target_start_date DATE,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS sales_forecast (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_week DATE NOT NULL,
        job_type VARCHAR(50) NOT NULL,
        projected_square_footage DECIMAL(10, 2) NOT NULL,
        projected_job_count INTEGER DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by UUID REFERENCES users(id),
        UNIQUE(forecast_week, job_type)
      );

      CREATE TABLE IF NOT EXISTS crew_staff (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        crew_id UUID NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
        lead_count INTEGER NOT NULL DEFAULT 0,
        super_count INTEGER NOT NULL DEFAULT 0,
        added_date DATE NOT NULL,
        notes TEXT,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS production_actuals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        production_week DATE NOT NULL,
        job_type VARCHAR(50) NOT NULL,
        crew_id UUID REFERENCES crews(id),
        square_footage_completed DECIMAL(10, 2) NOT NULL,
        jobs_completed INTEGER NOT NULL DEFAULT 0,
        hours_worked DECIMAL(8, 2),
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_by UUID REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS metrics_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        metric_week DATE NOT NULL,
        job_type VARCHAR(50) NOT NULL,
        pipeline_sqs DECIMAL(12, 2) NOT NULL,
        pipeline_jobs INTEGER NOT NULL DEFAULT 0,
        sales_forecast_sqs DECIMAL(12, 2) NOT NULL,
        production_rate_sqs DECIMAL(12, 2) NOT NULL,
        revenue_projected DECIMAL(14, 2) NOT NULL,
        revenue_produced DECIMAL(14, 2) NOT NULL,
        queue_growth DECIMAL(12, 2) NOT NULL,
        avg_lead_time_days INTEGER NOT NULL,
        capacity_utilization DECIMAL(5, 4) NOT NULL,
        bottleneck_detected BOOLEAN DEFAULT false,
        bottleneck_reason TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_install_date ON jobs(install_date);
      CREATE INDEX IF NOT EXISTS idx_jobs_crew_id ON jobs(crew_id);
      CREATE INDEX IF NOT EXISTS idx_crews_type ON crews(crew_type);
      CREATE INDEX IF NOT EXISTS idx_crews_active ON crews(is_active);
      CREATE INDEX IF NOT EXISTS idx_custom_projects_crew_id ON custom_projects(crew_id);
      CREATE INDEX IF NOT EXISTS idx_custom_projects_dates ON custom_projects(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_forecasts_date ON forecasts(forecast_date);
      CREATE INDEX IF NOT EXISTS idx_forecast_details_forecast_id ON forecast_details(forecast_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_pipeline_type ON pipeline_items(job_type);
      CREATE INDEX IF NOT EXISTS idx_pipeline_status ON pipeline_items(status);
      CREATE INDEX IF NOT EXISTS idx_pipeline_dates ON pipeline_items(added_date, target_start_date);
      CREATE INDEX IF NOT EXISTS idx_sales_forecast_week_type ON sales_forecast(forecast_week, job_type);
      CREATE INDEX IF NOT EXISTS idx_crew_staff_crew_id ON crew_staff(crew_id);
      CREATE INDEX IF NOT EXISTS idx_production_actuals_week_type ON production_actuals(production_week, job_type);
      CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_week_type ON metrics_snapshots(metric_week, job_type);
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database', error);
    throw error;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export default pool;
