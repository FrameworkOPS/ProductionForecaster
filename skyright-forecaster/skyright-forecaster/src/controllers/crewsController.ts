import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';

interface CrewRequest {
  crew_name: string;
  crew_type: 'shingle' | 'metal';
  team_members: number;
  training_period_days: number;
  start_date: string; // ISO date
  terminate_date?: string; // ISO date, optional
  revenue_per_sq?: number;
}

interface CrewResponse {
  id: string;
  crew_name: string;
  crew_type: string;
  team_members: number;
  training_period_days: number;
  start_date: string;
  terminate_date?: string;
  revenue_per_sq: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Get all crews (optionally filtered by active status)
 */
export const getCrews = asyncHandler(async (req: Request, res: Response) => {
  const { active } = req.query;
  const isActive = active === 'true' ? true : active === 'false' ? false : undefined;

  let whereClause = '';
  const params: any[] = [];

  if (isActive !== undefined) {
    whereClause = 'WHERE is_active = $1';
    params.push(isActive);
  }

  const result = await query(
    `SELECT id, crew_name, crew_type, team_members, training_period_days, start_date,
            terminate_date, revenue_per_sq, is_active, created_at, updated_at
     FROM crews
     ${whereClause}
     ORDER BY created_at DESC`,
    params
  );

  const crews: CrewResponse[] = result.rows.map((row: any) => ({
    id: row.id,
    crew_name: row.crew_name,
    crew_type: row.crew_type,
    team_members: row.team_members,
    training_period_days: row.training_period_days,
    start_date: row.start_date,
    terminate_date: row.terminate_date,
    revenue_per_sq: parseFloat(row.revenue_per_sq),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  res.json({
    success: true,
    data: crews,
  });
});

/**
 * Get a specific crew by ID
 */
export const getCrew = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;

  const result = await query(
    `SELECT id, crew_name, crew_type, team_members, training_period_days, start_date,
            terminate_date, revenue_per_sq, is_active, created_at, updated_at
     FROM crews WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Crew not found', 404);
  }

  const row = result.rows[0];
  const crew: CrewResponse = {
    id: row.id,
    crew_name: row.crew_name,
    crew_type: row.crew_type,
    team_members: row.team_members,
    training_period_days: row.training_period_days,
    start_date: row.start_date,
    terminate_date: row.terminate_date,
    revenue_per_sq: parseFloat(row.revenue_per_sq),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  res.json({
    success: true,
    data: crew,
  });
});

/**
 * Create a new crew
 */
export const createCrew = asyncHandler(async (req: Request<{}, {}, CrewRequest>, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const {
    crew_name,
    crew_type,
    team_members,
    training_period_days,
    start_date,
    terminate_date,
    revenue_per_sq,
  } = req.body;

  // Validation
  if (!crew_name || !crew_type || !team_members || !training_period_days || !start_date) {
    throw new AppError('Missing required fields', 400);
  }

  if (!['shingle', 'metal'].includes(crew_type)) {
    throw new AppError('crew_type must be "shingle" or "metal"', 400);
  }

  if (team_members <= 0) {
    throw new AppError('team_members must be greater than 0', 400);
  }

  if (training_period_days <= 0) {
    throw new AppError('training_period_days must be greater than 0', 400);
  }

  // Set default revenue_per_sq based on crew type
  const defaultRevenue = crew_type === 'shingle' ? 600 : 1000;
  const finalRevenuePerSq = revenue_per_sq ?? defaultRevenue;

  const crewId = await getUUID();

  try {
    await query(
      `INSERT INTO crews
       (id, crew_name, crew_type, team_members, training_period_days, start_date,
        terminate_date, revenue_per_sq, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        crewId,
        crew_name,
        crew_type,
        team_members,
        training_period_days,
        start_date,
        terminate_date || null,
        finalRevenuePerSq,
        true,
        req.user.userId,
      ]
    );

    const response: CrewResponse = {
      id: crewId,
      crew_name,
      crew_type,
      team_members,
      training_period_days,
      start_date,
      terminate_date,
      revenue_per_sq: finalRevenuePerSq,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    res.status(201).json({
      success: true,
      message: 'Crew created successfully',
      data: response,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Failed to create crew', 500);
  }
});

/**
 * Update a crew
 */
export const updateCrew = asyncHandler(
  async (req: Request<{ id: string }, {}, Partial<CrewRequest>>, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { id } = req.params;
    const {
      crew_name,
      crew_type,
      team_members,
      training_period_days,
      start_date,
      terminate_date,
      revenue_per_sq,
    } = req.body;

    // Check crew exists
    const existingResult = await query('SELECT id FROM crews WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      throw new AppError('Crew not found', 404);
    }

    // Validate crew_type if provided
    if (crew_type && !['shingle', 'metal'].includes(crew_type)) {
      throw new AppError('crew_type must be "shingle" or "metal"', 400);
    }

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (crew_name !== undefined) {
      updates.push(`crew_name = $${paramIndex++}`);
      params.push(crew_name);
    }
    if (crew_type !== undefined) {
      updates.push(`crew_type = $${paramIndex++}`);
      params.push(crew_type);
    }
    if (team_members !== undefined) {
      updates.push(`team_members = $${paramIndex++}`);
      params.push(team_members);
    }
    if (training_period_days !== undefined) {
      updates.push(`training_period_days = $${paramIndex++}`);
      params.push(training_period_days);
    }
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramIndex++}`);
      params.push(start_date);
    }
    if (terminate_date !== undefined) {
      updates.push(`terminate_date = $${paramIndex++}`);
      params.push(terminate_date || null);
    }
    if (revenue_per_sq !== undefined) {
      updates.push(`revenue_per_sq = $${paramIndex++}`);
      params.push(revenue_per_sq);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    if (updates.length === 1) {
      // Only updated_at, no changes
      throw new AppError('No fields to update', 400);
    }

    const updateQuery = `UPDATE crews SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const result = await query(updateQuery, params);
    const row = result.rows[0];

    const response: CrewResponse = {
      id: row.id,
      crew_name: row.crew_name,
      crew_type: row.crew_type,
      team_members: row.team_members,
      training_period_days: row.training_period_days,
      start_date: row.start_date,
      terminate_date: row.terminate_date,
      revenue_per_sq: parseFloat(row.revenue_per_sq),
      is_active: row.is_active,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    res.json({
      success: true,
      message: 'Crew updated successfully',
      data: response,
    });
  }
);

/**
 * Delete a crew (soft delete - set is_active to false)
 */
export const deleteCrew = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;

  // Check crew exists
  const existingResult = await query('SELECT id FROM crews WHERE id = $1', [id]);
  if (existingResult.rows.length === 0) {
    throw new AppError('Crew not found', 404);
  }

  // Soft delete
  const result = await query(
    'UPDATE crews SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
    [id]
  );

  const row = result.rows[0];
  const response: CrewResponse = {
    id: row.id,
    crew_name: row.crew_name,
    crew_type: row.crew_type,
    team_members: row.team_members,
    training_period_days: row.training_period_days,
    start_date: row.start_date,
    terminate_date: row.terminate_date,
    revenue_per_sq: parseFloat(row.revenue_per_sq),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  res.json({
    success: true,
    message: 'Crew deleted successfully',
    data: response,
  });
});
