import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Support both Railway's DATABASE_URL and individual environment variables
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    }
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
        weekly_sq_capacity DECIMAL(10, 2),
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
      CREATE UNIQUE INDEX IF NOT EXISTS uq_metrics_snapshots_week_type ON metrics_snapshots(metric_week, job_type);
    `);

    // Estimating tool tables
    await query(`
      CREATE TABLE IF NOT EXISTS estimate_projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        project_address VARCHAR(500),
        gc_name VARCHAR(255),
        bid_date DATE,
        project_type VARCHAR(50) DEFAULT 'roofing',
        status VARCHAR(50) DEFAULT 'draft',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS estimate_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES estimate_projects(id) ON DELETE CASCADE,
        file_name VARCHAR(500) NOT NULL,
        file_path VARCHAR(1000) NOT NULL,
        doc_type VARCHAR(50),
        parsed BOOLEAN DEFAULT false,
        parsed_data JSONB,
        parsed_at TIMESTAMP,
        file_bytes BYTEA,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS estimate_specs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES estimate_projects(id) ON DELETE CASCADE,
        section VARCHAR(255),
        spec_type VARCHAR(100),
        description TEXT,
        value TEXT,
        source_doc_id UUID REFERENCES estimate_documents(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS estimate_line_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES estimate_projects(id) ON DELETE CASCADE,
        category VARCHAR(100),
        description VARCHAR(500) NOT NULL,
        quantity DECIMAL(12,2),
        unit VARCHAR(50),
        unit_price DECIMAL(10,2),
        line_total DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
        waste_factor DECIMAL(5,2) DEFAULT 0,
        notes TEXT,
        sort_order INTEGER DEFAULT 0,
        material_key VARCHAR(150),
        price_flagged BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS material_prices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_key VARCHAR(150) NOT NULL UNIQUE,
        category VARCHAR(100) NOT NULL,
        description VARCHAR(500) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        unit_cost DECIMAL(10,2) NOT NULL,
        vendor VARCHAR(255),
        notes TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS labor_prices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        material_key VARCHAR(150) NOT NULL UNIQUE,
        category VARCHAR(100) NOT NULL,
        description VARCHAR(500) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        unit_cost DECIMAL(10,2) NOT NULL,
        notes TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS estimate_concerns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES estimate_projects(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        severity VARCHAR(50) DEFAULT 'medium',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS estimate_takeoffs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES estimate_projects(id) ON DELETE CASCADE,
        label VARCHAR(255) NOT NULL,
        value DECIMAL(12,2),
        unit VARCHAR(50),
        category VARCHAR(100),
        source VARCHAR(100),
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_estimate_docs_project ON estimate_documents(project_id);
      CREATE INDEX IF NOT EXISTS idx_estimate_specs_project ON estimate_specs(project_id);
      CREATE INDEX IF NOT EXISTS idx_estimate_line_items_project ON estimate_line_items(project_id);
      CREATE INDEX IF NOT EXISTS idx_estimate_concerns_project ON estimate_concerns(project_id);
      CREATE INDEX IF NOT EXISTS idx_estimate_takeoffs_project ON estimate_takeoffs(project_id);
      CREATE INDEX IF NOT EXISTS idx_material_prices_key ON material_prices(material_key);
      CREATE INDEX IF NOT EXISTS idx_labor_prices_key ON labor_prices(material_key);
    `);

    // Migrations: add columns to existing tables if they don't exist
    await query(`
      ALTER TABLE crews ADD COLUMN IF NOT EXISTS weekly_sq_capacity DECIMAL(10, 2);
      ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS material_key VARCHAR(150);
      ALTER TABLE estimate_line_items ADD COLUMN IF NOT EXISTS price_flagged BOOLEAN DEFAULT false;
      ALTER TABLE estimate_documents ADD COLUMN IF NOT EXISTS file_bytes BYTEA;
    `);

    // Seed a starter price database (Pacific Northwest commercial roofing & siding).
    // Only inserts if the key doesn't already exist — safe to re-run.
    await query(`
      INSERT INTO material_prices (material_key, category, description, unit, unit_cost, vendor) VALUES
        ('TPO_MEMBRANE_60MIL_WHITE_MECH', 'Roofing - Membrane', 'TPO membrane 60 mil white, mechanically fastened', 'SQ', 185.00, 'GAF / Carlisle / Versico'),
        ('TPO_MEMBRANE_60MIL_WHITE_ADHERED', 'Roofing - Membrane', 'TPO membrane 60 mil white, fully adhered', 'SQ', 245.00, 'GAF / Carlisle'),
        ('EPDM_MEMBRANE_60MIL_BLACK', 'Roofing - Membrane', 'EPDM membrane 60 mil black, mechanically fastened', 'SQ', 175.00, 'Carlisle / Firestone'),
        ('PVC_MEMBRANE_60MIL_WHITE_MECH', 'Roofing - Membrane', 'PVC membrane 60 mil white, mechanically fastened', 'SQ', 210.00, 'Sika Sarnafil'),
        ('POLYISO_INSULATION_2IN', 'Roofing - Insulation', 'Polyiso roof insulation 2"', 'SF', 1.40, 'GAF / Hunter'),
        ('POLYISO_INSULATION_3IN', 'Roofing - Insulation', 'Polyiso roof insulation 3"', 'SF', 2.05, 'GAF / Hunter'),
        ('COVERBOARD_HD_1_2IN', 'Roofing - Insulation', 'HD cover board 1/2"', 'SF', 0.95, 'DensDeck'),
        ('GAF_TIMBERLINE_HDZ', 'Roofing - Shingles', 'GAF Timberline HDZ architectural shingles', 'SQ', 165.00, 'GAF'),
        ('OWENS_DURATION', 'Roofing - Shingles', 'Owens Corning Duration architectural shingles', 'SQ', 160.00, 'Owens Corning'),
        ('UNDERLAYMENT_SYNTHETIC', 'Roofing - Underlayment', 'Synthetic underlayment', 'SQ', 35.00, 'GAF FeltBuster / Tiger Paw'),
        ('ICE_WATER_SHIELD', 'Roofing - Underlayment', 'Ice & water shield', 'SQ', 95.00, 'Grace / GAF StormGuard'),
        ('DRIP_EDGE_METAL', 'Roofing - Metal', 'Drip edge metal, prefinished', 'LF', 2.50, 'Various'),
        ('STEP_FLASHING', 'Roofing - Metal', 'Step flashing, prefinished', 'LF', 4.00, 'Various'),
        ('PIPE_BOOT', 'Roofing - Accessories', 'Lead pipe flashing / boot', 'EA', 28.00, 'Oatey'),
        ('RIDGE_VENT', 'Roofing - Ventilation', 'Ridge vent, shingle-over', 'LF', 8.50, 'GAF Cobra / Air Vent'),
        ('ROOF_DRAIN_LARGE', 'Roofing - Drainage', 'Roof drain, large with strainer', 'EA', 425.00, 'Jay R. Smith / Watts'),
        ('SCUPPER_OVERFLOW', 'Roofing - Drainage', 'Overflow scupper assembly', 'EA', 285.00, 'Custom fab'),
        ('PARAPET_COPING', 'Roofing - Metal', 'Coping cap, prefinished metal, 24ga', 'LF', 22.00, 'Custom fab'),
        ('JAMES_HARDIE_PLANK_SELECT_CEDARMILL', 'Siding - Fiber Cement', 'James Hardie HardiePlank Select CedarMill lap siding', 'SF', 3.85, 'James Hardie'),
        ('JAMES_HARDIE_PANEL_SIERRA8', 'Siding - Fiber Cement', 'James Hardie HardiePanel Sierra 8 vertical', 'SF', 3.55, 'James Hardie'),
        ('JAMES_HARDIE_TRIM_4IN', 'Siding - Fiber Cement', 'James Hardie HardieTrim 4" smooth', 'LF', 4.20, 'James Hardie'),
        ('LP_SMARTSIDE_LAP_38', 'Siding - Engineered Wood', 'LP SmartSide 3/8 lap siding', 'SF', 2.75, 'LP Building Solutions'),
        ('LP_SMARTSIDE_TRIM_4IN', 'Siding - Engineered Wood', 'LP SmartSide trim 4"', 'LF', 3.10, 'LP Building Solutions'),
        ('METAL_PANEL_24GA_STANDING_SEAM', 'Siding - Metal', '24 ga standing seam metal panel, prefinished', 'SF', 7.50, 'AEP Span / McElroy'),
        ('CEDAR_SHINGLE_18IN_NUMBER1', 'Siding - Wood', 'Cedar #1 18" shingles', 'SQ', 425.00, 'Various'),
        ('WRB_HOUSEWRAP_TYVEK', 'Siding - WRB', 'Tyvek CommercialWrap housewrap', 'SF', 0.32, 'DuPont'),
        ('WRB_HOUSEWRAP_HARDIEWRAP', 'Siding - WRB', 'HardieWrap housewrap', 'SF', 0.35, 'James Hardie'),
        ('FLASHING_TAPE_4IN', 'Siding - Flashing', 'Flashing tape 4" self-adhered', 'LF', 1.10, 'DuPont StraightFlash'),
        ('J_CHANNEL_VINYL', 'Siding - Trim', 'J-channel, vinyl', 'LF', 1.40, 'Various'),
        ('STARTER_STRIP_VINYL', 'Siding - Trim', 'Starter strip, vinyl', 'LF', 1.35, 'Various'),
        ('CORNER_OUTSIDE_4IN', 'Siding - Trim', 'Outside corner trim, 4"', 'LF', 3.25, 'Various'),
        ('SOFFIT_VENTED_VINYL', 'Siding - Soffit', 'Vented vinyl soffit', 'SF', 2.10, 'Various'),
        ('CAULK_NP1_TUBE', 'Siding - Sealant', 'NP1 polyurethane caulk', 'EA', 8.50, 'BASF Sonneborn'),
        ('FASTENERS_SIDING_LB', 'Siding - Fasteners', 'Stainless ring-shank siding nails', 'LB', 4.50, 'Maze'),
        ('DUMPSTER_30YD', 'General - Disposal', '30-yard dumpster, dump fees included', 'EA', 850.00, 'Local'),
        ('PERMIT_COMMERCIAL_ROOF', 'General - Permits', 'Commercial reroof permit (jurisdiction varies)', 'EA', 650.00, 'Jurisdiction')
      ON CONFLICT (material_key) DO NOTHING;
    `);

    await query(`
      INSERT INTO labor_prices (material_key, category, description, unit, unit_cost) VALUES
        ('LABOR_TEAROFF_SHINGLE', 'Roofing - Labor', 'Tear-off composition shingles, 1 layer', 'SQ', 65.00),
        ('LABOR_TEAROFF_MEMBRANE', 'Roofing - Labor', 'Tear-off existing membrane roof system', 'SQ', 95.00),
        ('LABOR_DECK_REPAIR', 'Roofing - Labor', 'Deck repair, 1/2 OSB replacement', 'SF', 4.50),
        ('LABOR_INSTALL_TPO', 'Roofing - Labor', 'Install TPO membrane system', 'SQ', 195.00),
        ('LABOR_INSTALL_SHINGLE', 'Roofing - Labor', 'Install architectural shingles', 'SQ', 110.00),
        ('LABOR_INSTALL_FLASHING', 'Roofing - Labor', 'Install flashing, complex details', 'LF', 12.00),
        ('LABOR_INSTALL_SIDING_HARDIE', 'Siding - Labor', 'Install Hardie lap siding', 'SF', 3.25),
        ('LABOR_INSTALL_SIDING_LP', 'Siding - Labor', 'Install LP SmartSide lap', 'SF', 2.75),
        ('LABOR_INSTALL_SIDING_METAL', 'Siding - Labor', 'Install standing seam metal panel siding', 'SF', 5.50),
        ('LABOR_TEAROFF_SIDING', 'Siding - Labor', 'Tear-off existing siding', 'SF', 1.85),
        ('LABOR_INSTALL_WRB', 'Siding - Labor', 'Install housewrap WRB', 'SF', 0.65),
        ('LABOR_INSTALL_TRIM', 'Siding - Labor', 'Install trim packages', 'LF', 4.50)
      ON CONFLICT (material_key) DO NOTHING;
    `);

    // Estimating: add stage column (workflow: new → plans_reviewed → quote_built)
    await query(`
      ALTER TABLE estimate_projects ADD COLUMN IF NOT EXISTS stage VARCHAR(50) DEFAULT 'new'
    `);
    // Backfill any nulls so the UI grouping always has a stage
    await query(`
      UPDATE estimate_projects SET stage = 'new' WHERE stage IS NULL
    `);

    // Seed default production parameters if none exist
    await query(`
      INSERT INTO production_parameters
        (current_production_rate, ramp_up_time_days, crew_capacity, max_concurrent_jobs, seasonal_adjustment, notes)
      SELECT 100, 30, 5, 10, 1.0, 'Default parameters - update as needed'
      WHERE NOT EXISTS (SELECT 1 FROM production_parameters)
    `);

    // Seed default user accounts (idempotent — only inserts if email doesn't exist)
    await seedDefaultUsers();

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database', error);
    throw error;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Default user seeding — idempotent, runs on every startup
// ────────────────────────────────────────────────────────────────────────────
const DEFAULT_USERS: Array<{
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: string;
}> = [
  {
    email: 'office@skyright.com',
    password: 'Password',
    firstName: 'Quincy',
    lastName: 'Greene',
    role: 'admin',
  },
];

async function seedDefaultUsers(): Promise<void> {
  // Lazy import so this file doesn't pull bcrypt eagerly when the module loads
  const { hashPassword } = await import('../utils/auth');
  const { randomUUID } = await import('crypto');

  for (const user of DEFAULT_USERS) {
    try {
      const existing = await query('SELECT id FROM users WHERE email = $1', [user.email]);
      if (existing.rows.length > 0) continue;

      const hash = await hashPassword(user.password);
      await query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), user.email, hash, user.firstName, user.lastName, user.role]
      );
      console.log(`Seeded default user: ${user.email}`);
    } catch (err) {
      console.warn(`Could not seed user ${user.email}:`, (err as Error).message);
    }
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export default pool;
