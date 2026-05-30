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

/**
 * GET /api/jobnimbus/debug
 * Diagnostic: reports what JobNimbus returns and how jobs classify, so we can
 * see why the pipeline panel may be empty (e.g. custom fields not returned by
 * the list endpoint, or status names not matching the configured filters).
 */
export const debugJobNimbus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw new AppError('User not authenticated', 401);

  try {
    const service = new JobNimbusService(getApiKey());
    const data = await service.debug();
    res.json({ success: true, data });
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    const status = error?.response?.status;
    const apiMsg = error?.response?.data?.message || error?.response?.data?.error;
    const detail = apiMsg ? `JobNimbus ${status}: ${apiMsg}` : error?.message || 'Unknown error';
    res.json({ success: false, error: detail });
  }
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
    const [jobsRaw, squaresByJob] = await Promise.all([
      service.fetchJobs(),
      service.fetchRoofSquaresByJob(),
    ]);
    // Forecast view includes the active pipeline (Sold / In Production) plus
    // estimating-stage jobs, which squaresForJob weights down by the close rate.
    const pipelineJobs = service.filterForecastJobs(jobsRaw);

    const deals = pipelineJobs
      .map((job) => {
        const jobType = service.classifyJobType(job);
        if (jobType === null) return null;

        const estimating = service.isEstimating(job);
        const rawSqs = service.rawSquaresForJob(job, squaresByJob);
        // squaresForJob already applies the estimating close-rate weighting and
        // the default-roof-size assumption; this is the forecast SQ figure.
        const forecastSqs = service.squaresForJob(job, squaresByJob);

        const revenuePerSq = jobType === 'metal' ? REVENUE_PER_SQ.metal : REVENUE_PER_SQ.shingles;
        // Display roof size: actual squares, or the default when none recorded.
        const displaySqs = rawSqs > 0 ? rawSqs : 30;
        const grossValue = displaySqs * revenuePerSq;
        // Sold/in-production work counts in full; estimating is already weighted
        // by close rate inside forecastSqs, so derive weighted value from it.
        const weightedValue = forecastSqs * revenuePerSq;

        return {
          jobnimbus_id: job.jnid,
          dealname: job.display_name || job.name || 'Unnamed Job',
          job_type: jobType,
          stage: estimating ? 'estimating' : 'pipeline',
          roof_sqs: displaySqs,
          using_default_sqs: rawSqs <= 0,
          gross_value: grossValue,
          weighted_value: weightedValue,
          estimated_sqs: forecastSqs,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    const totalWeightedValue = deals.reduce((sum, d) => sum + d.weighted_value, 0);
    const totalWeightedSqs = deals.reduce((sum, d) => sum + d.estimated_sqs, 0);
    // aggregateRoofingSquares uses squaresForJob, so estimating jobs contribute
    // their close-rate-weighted squares and sold work contributes full squares.
    const roofingSquares: RoofingSquaresSummary = service.aggregateRoofingSquares(pipelineJobs, squaresByJob);

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
