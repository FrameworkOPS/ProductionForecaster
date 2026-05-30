import { Request, Response } from 'express';
import { query } from '../config/database';
import JobNimbusService, { RoofingSquaresSummary } from '../services/jobNimbusService';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';
import { CLOSING_RATE, REVENUE_PER_SQ } from '../constants/businessConstants';

function getApiKey(): string {
  const key = process.env.JOBNIMBUS_API_KEY;
  if (!key) {
    throw new AppError('JOBNIMBUS_API_KEY is not configured on the server', 500);
  }
  return key;
}

export const getJobNimbusStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('User not authenticated', 401);

  const configured = !!process.env.JOBNIMBUS_API_KEY;
  res.json({
    success: true,
    data: {
      configured,
      message: configured
        ? 'JobNimbus integration configured (API key)'
        : 'JobNimbus integration not configured. Set JOBNIMBUS_API_KEY on the backend.',
    },
  });
});

export const syncJobs = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('User not authenticated', 401);

  try {
    const service = new JobNimbusService(getApiKey());
    const syncResult = await service.syncJobs(req.user.userId);

    await query(
      `INSERT INTO audit_log (id, user_id, action, entity_type, new_values, timestamp)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [await getUUID(), req.user.userId, 'SYNC', 'jobs', JSON.stringify(syncResult)]
    );

    res.json({ success: true, message: 'Jobs synchronized successfully', data: syncResult });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    const status = error?.response?.status;
    const apiMsg = error?.response?.data?.message || error?.response?.data?.error;
    const detail = apiMsg ? `JobNimbus ${status}: ${apiMsg}` : error?.message || 'Unknown error';
    console.error('[JobNimbus] syncJobs failed:', detail, error?.response?.data);
    throw new AppError(`JobNimbus sync failed — ${detail}`, 502);
  }
});

/**
 * GET /api/jobnimbus/pipeline-summary
 * Returns weighted deal pipeline + roofing square totals in the shape the
 * Sales Forecast UI consumes.
 */
export const getPipelineSummary = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('User not authenticated', 401);

  try {
    const service = new JobNimbusService(getApiKey());
    const pipelineJobs = service.filterPipelineJobs(await service.fetchJobs());

    const DEFAULT_SQS = 30;
    const deals = pipelineJobs
      .map((job) => {
        const jobType = service.classifyJobType(job);
        if (jobType === null) return null;

        const raw = service.extractRoofSquares(job);
        const roofSqs = raw > 0 ? raw : DEFAULT_SQS;

        const revenuePerSq = jobType === 'metal' ? REVENUE_PER_SQ.metal : REVENUE_PER_SQ.shingles;
        const grossValue = roofSqs * revenuePerSq;
        const weightedValue = grossValue * CLOSING_RATE;
        const estimatedSqs = roofSqs * CLOSING_RATE;

        return {
          jobnimbus_id: job.jnid,
          dealname: job.display_name || job.name || 'Unnamed Job',
          job_type: jobType,
          roof_sqs: roofSqs,
          using_default_sqs: raw <= 0,
          gross_value: grossValue,
          weighted_value: weightedValue,
          estimated_sqs: estimatedSqs,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    const totalWeightedValue = deals.reduce((sum, d) => sum + d.weighted_value, 0);
    const totalWeightedSqs = deals.reduce((sum, d) => sum + d.estimated_sqs, 0);
    const roofingSquares: RoofingSquaresSummary = service.aggregateRoofingSquares(pipelineJobs);

    res.json({
      success: true,
      data: {
        deals,
        totalWeightedValue,
        totalWeightedSqs,
        roofingSquares,
        message: 'JobNimbus pipeline summary (live data)',
        source: 'JobNimbus API',
      },
    });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    const status = error?.response?.status;
    const apiMsg = error?.response?.data?.message || error?.response?.data?.error;
    const detail = apiMsg ? `JobNimbus ${status}: ${apiMsg}` : error?.message || 'Unknown error';
    console.error('[JobNimbus] getPipelineSummary failed:', detail, error?.response?.data);
    throw new AppError(`JobNimbus API error — ${detail}`, 502);
  }
});
