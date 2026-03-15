import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';

interface CustomProjectRequest {
  crew_id: string;
  project_name: string;
  start_date: string; // ISO date
  end_date: string; // ISO date
  notes?: string;
}

interface CustomProjectResponse {
  id: string;
  crew_id: string;
  project_name: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get all custom projects (optionally filtered by crew_id or active status)
 */
export const getCustomProjects = asyncHandler(async (req: Request, res: Response) => {
  const { crew_id, active } = req.query;
  const isActive = active === 'true' ? true : active === 'false' ? false : undefined;

  let whereClause = 'WHERE 1=1';
  const params: any[] = [];
  let paramIndex = 1;

  if (crew_id) {
    whereClause += ` AND crew_id = $${paramIndex++}`;
    params.push(crew_id);
  }

  if (isActive !== undefined) {
    whereClause += ` AND is_active = $${paramIndex++}`;
    params.push(isActive);
  }

  const result = await query(
    `SELECT id, crew_id, project_name, start_date, end_date, is_active, notes, created_at, updated_at
     FROM custom_projects
     ${whereClause}
     ORDER BY start_date DESC`,
    params
  );

  const projects: CustomProjectResponse[] = result.rows.map((row: any) => ({
    id: row.id,
    crew_id: row.crew_id,
    project_name: row.project_name,
    start_date: row.start_date,
    end_date: row.end_date,
    is_active: row.is_active,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  res.json({
    success: true,
    data: projects,
  });
});

/**
 * Get a specific custom project by ID
 */
export const getCustomProject = asyncHandler(
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    const result = await query(
      `SELECT id, crew_id, project_name, start_date, end_date, is_active, notes, created_at, updated_at
       FROM custom_projects WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Custom project not found', 404);
    }

    const row = result.rows[0];
    const project: CustomProjectResponse = {
      id: row.id,
      crew_id: row.crew_id,
      project_name: row.project_name,
      start_date: row.start_date,
      end_date: row.end_date,
      is_active: row.is_active,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    res.json({
      success: true,
      data: project,
    });
  }
);

/**
 * Create a new custom project
 */
export const createCustomProject = asyncHandler(
  async (req: Request<{}, {}, CustomProjectRequest>, res: Response) => {
    if (!req.user) {
      throw new AppError('User not authenticated', 401);
    }

    const { crew_id, project_name, start_date, end_date, notes } = req.body;

    // Validation
    if (!crew_id || !project_name || !start_date || !end_date) {
      throw new AppError('Missing required fields', 400);
    }

    // Verify crew exists
    const crewResult = await query('SELECT id FROM crews WHERE id = $1', [crew_id]);
    if (crewResult.rows.length === 0) {
      throw new AppError('Crew not found', 404);
    }

    // Validate date range
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);

    if (startDate >= endDate) {
      throw new AppError('start_date must be before end_date', 400);
    }

    const projectId = await getUUID();

    try {
      await query(
        `INSERT INTO custom_projects
         (id, crew_id, project_name, start_date, end_date, is_active, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [projectId, crew_id, project_name, start_date, end_date, true, notes || null, req.user.userId]
      );

      const response: CustomProjectResponse = {
        id: projectId,
        crew_id,
        project_name,
        start_date,
        end_date,
        is_active: true,
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      res.status(201).json({
        success: true,
        message: 'Custom project created successfully',
        data: response,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Failed to create custom project', 500);
    }
  }
);

/**
 * Update a custom project
 */
export const updateCustomProject = asyncHandler(
  async (req: Request<{ id: string }, {}, Partial<CustomProjectRequest>>, res: Response) => {
    const { id } = req.params;
    const { crew_id, project_name, start_date, end_date, notes } = req.body;

    // Check project exists
    const existingResult = await query(
      'SELECT crew_id FROM custom_projects WHERE id = $1',
      [id]
    );
    if (existingResult.rows.length === 0) {
      throw new AppError('Custom project not found', 404);
    }

    // If updating crew_id, verify new crew exists
    if (crew_id) {
      const crewResult = await query('SELECT id FROM crews WHERE id = $1', [crew_id]);
      if (crewResult.rows.length === 0) {
        throw new AppError('Crew not found', 404);
      }
    }

    // Validate date range if both provided
    if (start_date && end_date) {
      const startDate = new Date(start_date);
      const endDate = new Date(end_date);
      if (startDate >= endDate) {
        throw new AppError('start_date must be before end_date', 400);
      }
    }

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (crew_id !== undefined) {
      updates.push(`crew_id = $${paramIndex++}`);
      params.push(crew_id);
    }
    if (project_name !== undefined) {
      updates.push(`project_name = $${paramIndex++}`);
      params.push(project_name);
    }
    if (start_date !== undefined) {
      updates.push(`start_date = $${paramIndex++}`);
      params.push(start_date);
    }
    if (end_date !== undefined) {
      updates.push(`end_date = $${paramIndex++}`);
      params.push(end_date);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      params.push(notes || null);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(id);

    if (updates.length === 1) {
      throw new AppError('No fields to update', 400);
    }

    const updateQuery = `UPDATE custom_projects SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

    const result = await query(updateQuery, params);
    const row = result.rows[0];

    const response: CustomProjectResponse = {
      id: row.id,
      crew_id: row.crew_id,
      project_name: row.project_name,
      start_date: row.start_date,
      end_date: row.end_date,
      is_active: row.is_active,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    res.json({
      success: true,
      message: 'Custom project updated successfully',
      data: response,
    });
  }
);

/**
 * Delete a custom project
 */
export const deleteCustomProject = asyncHandler(
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    // Check project exists
    const existingResult = await query('SELECT id FROM custom_projects WHERE id = $1', [id]);
    if (existingResult.rows.length === 0) {
      throw new AppError('Custom project not found', 404);
    }

    // Hard delete
    await query('DELETE FROM custom_projects WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Custom project deleted successfully',
    });
  }
);
