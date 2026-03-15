import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';

interface JobData {
  jobId: string;
  installDate: string;
  estimatedDuration: number;
  crewSize: number;
  revenue?: number;
  customerName?: string;
  jobAddress?: string;
}

export const getJobs = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const status = req.query.status as string;

  const offset = (page - 1) * limit;

  let queryStr = 'SELECT * FROM jobs WHERE 1=1';
  const params: any[] = [];

  if (status) {
    queryStr += ' AND status = $' + (params.length + 1);
    params.push(status);
  }

  // Get total count
  const countResult = await query(queryStr.replace('SELECT *', 'SELECT COUNT(*) as count'));
  const total = countResult.rows[0].count;

  // Get paginated results
  queryStr += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await query(queryStr, params);

  res.json({
    success: true,
    data: result.rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

export const createJob = asyncHandler(async (req: Request<{}, {}, JobData>, res: Response) => {
  const { jobId, installDate, estimatedDuration, crewSize, revenue, customerName, jobAddress } = req.body;

  if (!jobId || !installDate || !estimatedDuration || !crewSize) {
    throw new AppError('Missing required fields', 400);
  }

  const id = await getUUID();
  const result = await query(
    `INSERT INTO jobs (id, job_id, install_date, estimated_duration, crew_size, revenue, customer_name, job_address, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id, jobId, installDate, estimatedDuration, crewSize, revenue || null, customerName || null, jobAddress || null, 'pending']
  );

  res.status(201).json({
    success: true,
    message: 'Job created successfully',
    data: result.rows[0],
  });
});

export const updateJobStatus = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    throw new AppError('Status is required', 400);
  }

  const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const result = await query(
    `UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
    [status, id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  res.json({
    success: true,
    message: 'Job updated successfully',
    data: result.rows[0],
  });
});

export const deleteJob = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;

  const result = await query('DELETE FROM jobs WHERE id = $1 RETURNING id', [id]);

  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404);
  }

  res.json({
    success: true,
    message: 'Job deleted successfully',
  });
});

export const uploadJobsCSV = asyncHandler(async (req: Request, res: Response) => {
  // This will be implemented with CSV parsing
  // For now, return a placeholder response
  res.json({
    success: true,
    message: 'CSV upload endpoint ready',
  });
});
