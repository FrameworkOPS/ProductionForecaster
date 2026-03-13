import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';

export const createProductionActual = asyncHandler(async (req: Request, res: Response) => {
  const {
    productionWeek,
    jobType,
    crewId,
    squareFootageCompleted,
    jobsCompleted,
    hoursWorked,
    notes
  } = req.body;

  // Validate required fields
  if (!productionWeek || !jobType || squareFootageCompleted === undefined || jobsCompleted === undefined) {
    throw new AppError('Missing required fields: productionWeek, jobType, squareFootageCompleted, jobsCompleted', 400);
  }

  // Validate job type
  if (!['shingle', 'metal'].includes(jobType)) {
    throw new AppError('jobType must be either "shingle" or "metal"', 400);
  }

  // If crewId provided, verify it exists
  if (crewId) {
    const crew = await query(
      'SELECT * FROM crews WHERE id = $1',
      [crewId]
    );
    if (crew.rows.length === 0) {
      throw new AppError('Crew not found', 404);
    }
  }

  const result = await query(
    `INSERT INTO production_actuals (production_week, job_type, crew_id, square_footage_completed, jobs_completed, hours_worked, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [productionWeek, jobType, crewId || null, squareFootageCompleted, jobsCompleted, hoursWorked || null, notes || null, req.user?.id || null]
  );

  res.status(201).json({
    success: true,
    data: result.rows[0],
    message: 'Production actual recorded successfully'
  });
});

export const getProductionActuals = asyncHandler(async (req: Request, res: Response) => {
  const { productionWeek, jobType, crewId, page = 1, limit = 50 } = req.query;

  let whereConditions = [];
  const params: any[] = [];
  let paramCount = 1;

  if (productionWeek) {
    whereConditions.push(`production_week = $${paramCount}`);
    params.push(productionWeek);
    paramCount++;
  }

  if (jobType) {
    whereConditions.push(`job_type = $${paramCount}`);
    params.push(jobType);
    paramCount++;
  }

  if (crewId) {
    whereConditions.push(`crew_id = $${paramCount}`);
    params.push(crewId);
    paramCount++;
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  const offset = ((parseInt(page as string) || 1) - 1) * parseInt(limit as string);

  const result = await query(
    `SELECT * FROM production_actuals ${whereClause} ORDER BY production_week DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...params, limit, offset]
  );

  const countResult = await query(
    `SELECT COUNT(*) as total FROM production_actuals ${whereClause}`,
    params
  );

  res.json({
    success: true,
    data: result.rows,
    pagination: {
      total: parseInt(countResult.rows[0].total),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      pages: Math.ceil(parseInt(countResult.rows[0].total) / parseInt(limit as string))
    }
  });
});

export const getProductionRate = asyncHandler(async (req: Request, res: Response) => {
  const { jobType, weeks = 4 } = req.query;

  if (!jobType) {
    throw new AppError('jobType parameter is required', 400);
  }

  // Get production actuals for the past N weeks
  const numWeeks = parseInt(weeks as string);
  const result = await query(
    `SELECT
       job_type,
       AVG(square_footage_completed) as avg_sqs_per_week,
       AVG(jobs_completed) as avg_jobs_per_week,
       MAX(square_footage_completed) as max_sqs_week,
       MIN(square_footage_completed) as min_sqs_week,
       COUNT(*) as weeks_recorded,
       SUM(square_footage_completed) as total_sqs
     FROM production_actuals
     WHERE job_type = $1
       AND production_week >= CURRENT_DATE - ($2 || ' weeks')::interval
     GROUP BY job_type`,
    [jobType, numWeeks]
  );

  if (result.rows.length === 0) {
    return res.json({
      success: true,
      data: {
        jobType: jobType,
        avgSQsPerWeek: 0,
        avgJobsPerWeek: 0,
        maxSQsWeek: 0,
        minSQsWeek: 0,
        weeksRecorded: 0,
        totalSQs: 0,
        message: 'No production data found for this period'
      }
    });
  }

  const row = result.rows[0];
  res.json({
    success: true,
    data: {
      jobType: row.job_type,
      avgSQsPerWeek: parseFloat(row.avg_sqs_per_week || 0).toFixed(2),
      avgJobsPerWeek: parseFloat(row.avg_jobs_per_week || 0).toFixed(2),
      maxSQsWeek: parseFloat(row.max_sqs_week || 0).toFixed(2),
      minSQsWeek: parseFloat(row.min_sqs_week || 0).toFixed(2),
      weeksRecorded: parseInt(row.weeks_recorded),
      totalSQs: parseFloat(row.total_sqs || 0).toFixed(2)
    }
  });
});

export const updateProductionActual = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    squareFootageCompleted,
    jobsCompleted,
    hoursWorked,
    notes
  } = req.body;

  // Check if record exists
  const existing = await query(
    'SELECT * FROM production_actuals WHERE id = $1',
    [id]
  );

  if (existing.rows.length === 0) {
    throw new AppError('Production actual not found', 404);
  }

  // Build update query dynamically
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (squareFootageCompleted !== undefined) {
    updates.push(`square_footage_completed = $${paramCount}`);
    values.push(squareFootageCompleted);
    paramCount++;
  }

  if (jobsCompleted !== undefined) {
    updates.push(`jobs_completed = $${paramCount}`);
    values.push(jobsCompleted);
    paramCount++;
  }

  if (hoursWorked !== undefined) {
    updates.push(`hours_worked = $${paramCount}`);
    values.push(hoursWorked);
    paramCount++;
  }

  if (notes !== undefined) {
    updates.push(`notes = $${paramCount}`);
    values.push(notes);
    paramCount++;
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);

  if (updates.length === 1) {
    return res.json({
      success: true,
      data: existing.rows[0],
      message: 'No changes to apply'
    });
  }

  values.push(id);

  const result = await query(
    `UPDATE production_actuals SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
    values
  );

  res.json({
    success: true,
    data: result.rows[0],
    message: 'Production actual updated successfully'
  });
});
