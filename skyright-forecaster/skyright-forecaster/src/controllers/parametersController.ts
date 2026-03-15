import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';

interface ParameterData {
  currentProductionRate: number;
  rampUpTimeDays: number;
  crewCapacity: number;
  maxConcurrentJobs: number;
  seasonalAdjustment?: number;
  notes?: string;
}

export const getParameters = asyncHandler(async (req: Request, res: Response) => {
  const result = await query(
    `SELECT id, current_production_rate, ramp_up_time_days, crew_capacity, max_concurrent_jobs,
            seasonal_adjustment, notes, created_at, updated_at
     FROM production_parameters
     ORDER BY updated_at DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    throw new AppError('No production parameters found', 404);
  }

  const params = result.rows[0];
  res.json({
    success: true,
    data: {
      id: params.id,
      currentProductionRate: params.current_production_rate,
      rampUpTimeDays: params.ramp_up_time_days,
      crewCapacity: params.crew_capacity,
      maxConcurrentJobs: params.max_concurrent_jobs,
      seasonalAdjustment: params.seasonal_adjustment,
      notes: params.notes,
      createdAt: params.created_at,
      updatedAt: params.updated_at,
    },
  });
});

export const updateParameters = asyncHandler(async (req: Request<{}, {}, ParameterData>, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const {
    currentProductionRate,
    rampUpTimeDays,
    crewCapacity,
    maxConcurrentJobs,
    seasonalAdjustment,
    notes,
  } = req.body;

  if (!currentProductionRate || !rampUpTimeDays || !crewCapacity || !maxConcurrentJobs) {
    throw new AppError('Missing required fields', 400);
  }

  const id = await getUUID();
  const result = await query(
    `INSERT INTO production_parameters
     (id, current_production_rate, ramp_up_time_days, crew_capacity, max_concurrent_jobs, seasonal_adjustment, notes, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      id,
      currentProductionRate,
      rampUpTimeDays,
      crewCapacity,
      maxConcurrentJobs,
      seasonalAdjustment || 1.0,
      notes || null,
      req.user.userId,
    ]
  );

  const params = result.rows[0];
  res.status(201).json({
    success: true,
    message: 'Production parameters updated successfully',
    data: {
      id: params.id,
      currentProductionRate: params.current_production_rate,
      rampUpTimeDays: params.ramp_up_time_days,
      crewCapacity: params.crew_capacity,
      maxConcurrentJobs: params.max_concurrent_jobs,
      seasonalAdjustment: params.seasonal_adjustment,
      notes: params.notes,
      updatedAt: params.updated_at,
    },
  });
});

export const getParametersHistory = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = (page - 1) * limit;

  const countResult = await query('SELECT COUNT(*) as count FROM production_parameters');
  const total = countResult.rows[0].count;

  const result = await query(
    `SELECT id, current_production_rate, ramp_up_time_days, crew_capacity, max_concurrent_jobs,
            seasonal_adjustment, notes, created_at, updated_at
     FROM production_parameters
     ORDER BY updated_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  res.json({
    success: true,
    data: result.rows.map((row: any) => ({
      id: row.id,
      currentProductionRate: row.current_production_rate,
      rampUpTimeDays: row.ramp_up_time_days,
      crewCapacity: row.crew_capacity,
      maxConcurrentJobs: row.max_concurrent_jobs,
      seasonalAdjustment: row.seasonal_adjustment,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});
