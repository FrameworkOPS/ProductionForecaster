import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import {
  calculateCrewRampUpMultiplier,
  calculateCrewRampDownMultiplier,
  isCrewBlockedByProject,
  calculateQueueGrowth,
  calculateCapacityUtilization,
  detectProductionBottleneck,
  calculateLeadTime,
  daysBetween,
  calculateAverageProductionRate
} from '../utils/calculations';

interface CrewData {
  id: string;
  crew_name: string;
  crew_type: string;
  team_members: number;
  training_period_days: number;
  start_date: string;
  terminate_date: string | null;
  is_active: boolean;
}

interface MetricsInput {
  metricWeek: string;
  jobType: string;
}

export const calculateWeeklyMetrics = asyncHandler(async (req: Request, res: Response) => {
  const { week, jobType } = req.query;

  if (!week || !jobType) {
    throw new AppError('Missing required parameters: week and jobType', 400);
  }

  if (!['shingle', 'metal'].includes(jobType as string)) {
    throw new AppError('jobType must be either "shingle" or "metal"', 400);
  }

  // 1. Gather base data
  const pipelineResult = await query(
    `SELECT COALESCE(SUM(square_footage), 0) as total_sqs, COUNT(*) as job_count
     FROM pipeline_items
     WHERE job_type = $1 AND is_active = true AND status != 'completed'`,
    [jobType]
  );
  const pipelineSQs = parseFloat(pipelineResult.rows[0].total_sqs);

  const salesResult = await query(
    'SELECT COALESCE(projected_square_footage, 0) as total_sqs FROM sales_forecast WHERE forecast_week = $1 AND job_type = $2',
    [week, jobType]
  );
  const salesForecastSQs = parseFloat(salesResult.rows[0]?.total_sqs || 0);

  const productionResult = await query(
    `SELECT COALESCE(SUM(square_footage_completed), 0) as total_sqs
     FROM production_actuals
     WHERE production_week = $1 AND job_type = $2`,
    [week, jobType]
  );
  const productionActualSQs = parseFloat(productionResult.rows[0].total_sqs);

  // 2. Calculate effective production capacity
  const crewsResult = await query(
    `SELECT * FROM crews
     WHERE crew_type = $1 AND is_active = true
     ORDER BY crew_name`,
    [jobType]
  );

  const crews: CrewData[] = crewsResult.rows;
  let totalCapacitySQs = 0;
  const weekDate = new Date(week as string);

  for (const crew of crews) {
    const daysElapsed = daysBetween(crew.start_date, week as string);
    const rampUpMult = calculateCrewRampUpMultiplier(
      crew.crew_type as 'shingle' | 'metal',
      daysElapsed,
      crew.training_period_days
    );

    let rampDownMult = 1.0;
    if (crew.terminate_date) {
      rampDownMult = calculateCrewRampDownMultiplier(crew.terminate_date, weekDate);
    }

    // Check for project blocking
    const projectsResult = await query(
      `SELECT * FROM custom_projects
       WHERE crew_id = $1 AND is_active = true
       AND start_date <= $2::date AND end_date >= $3::date`,
      [crew.id, week, week]
    );

    const isBlocked = projectsResult.rows.length > 0;
    const effectiveMultiplier = isBlocked ? 0.0 : rampUpMult * rampDownMult;

    // Assume base crew capacity of 1000 SQs per week per crew (can be parameterized)
    const crewBaseSQCapacity = 1000;
    totalCapacitySQs += crewBaseSQCapacity * effectiveMultiplier;
  }

  // Get production rate baseline (4-week rolling average)
  const rateResult = await query(
    `SELECT AVG(square_footage_completed) as avg_rate
     FROM production_actuals
     WHERE job_type = $1
       AND production_week >= CURRENT_DATE - interval '28 days'
       AND production_week <= CURRENT_DATE`,
    [jobType]
  );

  const productionRate = parseFloat(rateResult.rows[0]?.avg_rate || 0) || (totalCapacitySQs * 0.8);

  // 3. Calculate queue dynamics
  const queueGrowth = calculateQueueGrowth(pipelineSQs, salesForecastSQs, productionRate);

  // Get previous week's queue growth for bottleneck detection
  const prevWeekDate = new Date(weekDate);
  prevWeekDate.setDate(prevWeekDate.getDate() - 7);
  const prevWeekStr = prevWeekDate.toISOString().split('T')[0];

  const prevMetricsResult = await query(
    `SELECT queue_growth FROM metrics_snapshots
     WHERE metric_week = $1 AND job_type = $2`,
    [prevWeekStr, jobType]
  );
  const previousQueueGrowth = prevMetricsResult.rows.length > 0
    ? parseFloat(prevMetricsResult.rows[0].queue_growth)
    : null;

  // 4. Lead time calculation
  const pipelineItemsResult = await query(
    `SELECT added_date, estimated_days_to_completion
     FROM pipeline_items
     WHERE job_type = $1 AND is_active = true AND status != 'completed'`,
    [jobType]
  );

  let avgLeadTimeDays = 0;
  if (pipelineItemsResult.rows.length > 0) {
    const leadTimes = pipelineItemsResult.rows.map((item: any) =>
      calculateLeadTime(item.added_date, item.estimated_days_to_completion, weekDate)
    );
    avgLeadTimeDays = Math.round(leadTimes.reduce((a: number, b: number) => a + b, 0) / leadTimes.length);
  }

  // 5. Revenue projection
  const revenuePerSq = jobType === 'shingle' ? 600 : 1000;
  const revenueProjected = (pipelineSQs + salesForecastSQs) * revenuePerSq;
  const revenueProduced = productionActualSQs * revenuePerSq;

  // 6. Capacity utilization
  const capacityUtilization = calculateCapacityUtilization(productionActualSQs, totalCapacitySQs);

  // 7. Bottleneck detection
  const [bottleneckDetected, bottleneckReason] = detectProductionBottleneck(
    queueGrowth,
    previousQueueGrowth,
    capacityUtilization
  );

  // 8. Store metrics snapshot
  const insertResult = await query(
    `INSERT INTO metrics_snapshots (
       metric_week, job_type, pipeline_sqs, pipeline_jobs, sales_forecast_sqs,
       production_rate_sqs, revenue_projected, revenue_produced, queue_growth,
       avg_lead_time_days, capacity_utilization, bottleneck_detected, bottleneck_reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (metric_week, job_type) DO UPDATE SET
       pipeline_sqs = $3, pipeline_jobs = $4, sales_forecast_sqs = $5,
       production_rate_sqs = $6, revenue_projected = $7, revenue_produced = $8,
       queue_growth = $9, avg_lead_time_days = $10, capacity_utilization = $11,
       bottleneck_detected = $12, bottleneck_reason = $13
     RETURNING *`,
    [
      week, jobType, pipelineSQs, pipelineResult.rows[0].job_count,
      salesForecastSQs, productionRate, revenueProjected, revenueProduced,
      queueGrowth, avgLeadTimeDays, capacityUtilization,
      bottleneckDetected, bottleneckReason
    ]
  );

  res.json({
    success: true,
    data: insertResult.rows[0],
    message: 'Metrics calculated and stored successfully'
  });
});

export const getMetricsDashboardData = asyncHandler(async (req: Request, res: Response) => {
  const { startWeek, endWeek, jobType } = req.query;

  if (!startWeek || !endWeek) {
    throw new AppError('Missing required parameters: startWeek and endWeek', 400);
  }

  let whereClause = 'WHERE metric_week >= $1 AND metric_week <= $2';
  const params: any[] = [startWeek, endWeek];
  let paramCount = 3;

  if (jobType) {
    if (!['shingle', 'metal'].includes(jobType as string)) {
      throw new AppError('jobType must be either "shingle" or "metal"', 400);
    }
    whereClause += ` AND job_type = $${paramCount}`;
    params.push(jobType);
  }

  const result = await query(
    `SELECT * FROM metrics_snapshots ${whereClause} ORDER BY metric_week ASC, job_type ASC`,
    params
  );

  res.json({
    success: true,
    data: result.rows
  });
});

export const getLeadTimeAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const { jobType, weeks = 4 } = req.query;

  if (!jobType) {
    throw new AppError('jobType parameter is required', 400);
  }

  if (!['shingle', 'metal'].includes(jobType as string)) {
    throw new AppError('jobType must be either "shingle" or "metal"', 400);
  }

  // Get recent metrics
  const numWeeks = parseInt(weeks as string);
  const result = await query(
    `SELECT
       job_type,
       AVG(CAST(avg_lead_time_days AS NUMERIC)) as current_lead_time,
       MAX(CAST(avg_lead_time_days AS NUMERIC)) as max_lead_time,
       MIN(CAST(avg_lead_time_days AS NUMERIC)) as min_lead_time,
       COUNT(*) as weeks_analyzed
     FROM metrics_snapshots
     WHERE job_type = $1
       AND metric_week >= CURRENT_DATE - ($2 || ' weeks')::interval
     GROUP BY job_type`,
    [jobType, numWeeks]
  );

  if (result.rows.length === 0) {
    return res.json({
      success: true,
      data: {
        jobType,
        currentLeadTime: 0,
        avgLeadTime: 0,
        maxLeadTime: 0,
        minLeadTime: 0,
        weeksAnalyzed: 0,
        trend: 'no_data'
      }
    });
  }

  const row = result.rows[0];
  const currentLeadTime = parseFloat(row.current_lead_time || 0);
  const avgLeadTime = parseFloat(row.current_lead_time || 0);

  // Determine trend
  let trend = 'stable';
  if (currentLeadTime > avgLeadTime * 1.1) {
    trend = 'increasing';
  } else if (currentLeadTime < avgLeadTime * 0.9) {
    trend = 'decreasing';
  }

  res.json({
    success: true,
    data: {
      jobType: row.job_type,
      currentLeadTime: Math.round(currentLeadTime),
      avgLeadTime: Math.round(avgLeadTime),
      maxLeadTime: Math.round(parseFloat(row.max_lead_time || 0)),
      minLeadTime: Math.round(parseFloat(row.min_lead_time || 0)),
      weeksAnalyzed: parseInt(row.weeks_analyzed),
      trend
    }
  });
});

export const getRevenueAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const { startWeek, endWeek, jobType } = req.query;

  let whereClause = '';
  const params: any[] = [];
  let paramCount = 1;

  if (startWeek) {
    whereClause += ` AND metric_week >= $${paramCount}`;
    params.push(startWeek);
    paramCount++;
  }

  if (endWeek) {
    whereClause += ` AND metric_week <= $${paramCount}`;
    params.push(endWeek);
    paramCount++;
  }

  if (jobType) {
    if (!['shingle', 'metal'].includes(jobType as string)) {
      throw new AppError('jobType must be either "shingle" or "metal"', 400);
    }
    whereClause += ` AND job_type = $${paramCount}`;
    params.push(jobType);
  }

  const query_text = `SELECT
     job_type,
     COALESCE(SUM(revenue_projected), 0) as total_projected,
     COALESCE(SUM(revenue_produced), 0) as total_produced,
     COUNT(*) as weeks_analyzed,
     AVG(revenue_projected) as avg_projected,
     AVG(revenue_produced) as avg_produced
   FROM metrics_snapshots
   WHERE 1=1 ${whereClause}
   GROUP BY job_type
   ORDER BY job_type`;

  const result = await query(query_text, params);

  const byType: { [key: string]: any } = {};
  let combinedProjected = 0;
  let combinedProduced = 0;

  result.rows.forEach((row: any) => {
    const projected = parseFloat(row.total_projected || 0);
    const produced = parseFloat(row.total_produced || 0);

    byType[row.job_type] = {
      jobType: row.job_type,
      totalProjected: projected.toFixed(0),
      totalProduced: produced.toFixed(0),
      variance: (produced - projected).toFixed(0),
      weeksAnalyzed: parseInt(row.weeks_analyzed),
      avgProjected: parseFloat(row.avg_projected || 0).toFixed(0),
      avgProduced: parseFloat(row.avg_produced || 0).toFixed(0)
    };

    combinedProjected += projected;
    combinedProduced += produced;
  });

  res.json({
    success: true,
    data: {
      byType,
      combined: {
        totalProjected: combinedProjected.toFixed(0),
        totalProduced: combinedProduced.toFixed(0),
        variance: (combinedProduced - combinedProjected).toFixed(0),
        accuracyPercent: combinedProjected > 0
          ? ((combinedProduced / combinedProjected) * 100).toFixed(1)
          : '0'
      }
    }
  });
});

export const getCapacityAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const { jobType, weeks = 4 } = req.query;

  if (!jobType) {
    throw new AppError('jobType parameter is required', 400);
  }

  if (!['shingle', 'metal'].includes(jobType as string)) {
    throw new AppError('jobType must be either "shingle" or "metal"', 400);
  }

  const numWeeks = parseInt(weeks as string);
  const result = await query(
    `SELECT
       job_type,
       AVG(CAST(capacity_utilization AS NUMERIC)) as avg_utilization,
       MAX(CAST(capacity_utilization AS NUMERIC)) as max_utilization,
       MIN(CAST(capacity_utilization AS NUMERIC)) as min_utilization,
       COUNT(CASE WHEN bottleneck_detected = true THEN 1 END) as bottleneck_weeks,
       COUNT(*) as total_weeks
     FROM metrics_snapshots
     WHERE job_type = $1
       AND metric_week >= CURRENT_DATE - ($2 || ' weeks')::interval
     GROUP BY job_type`,
    [jobType, numWeeks]
  );

  if (result.rows.length === 0) {
    return res.json({
      success: true,
      data: {
        jobType,
        avgUtilization: 0,
        maxUtilization: 0,
        bottleneckWeeks: 0,
        totalWeeks: 0,
        recommendations: ['No capacity data available yet']
      }
    });
  }

  const row = result.rows[0];
  const avgUtil = parseFloat(row.avg_utilization || 0);
  const bottleneckCount = parseInt(row.bottleneck_weeks);
  const totalWeeks = parseInt(row.total_weeks);

  const recommendations: string[] = [];

  if (avgUtil > 0.85) {
    recommendations.push('Consider increasing crew capacity or adjusting production schedule');
  }

  if (bottleneckCount > totalWeeks / 2) {
    recommendations.push('Frequent bottlenecks detected - review crew sizing or production rates');
  }

  if (avgUtil < 0.5) {
    recommendations.push('Low utilization - consider optimizing crew allocation or sales strategy');
  }

  if (recommendations.length === 0) {
    recommendations.push('Capacity utilization is healthy');
  }

  res.json({
    success: true,
    data: {
      jobType: row.job_type,
      avgUtilization: (avgUtil * 100).toFixed(1),
      maxUtilization: (parseFloat(row.max_utilization || 0) * 100).toFixed(1),
      minUtilization: (parseFloat(row.min_utilization || 0) * 100).toFixed(1),
      bottleneckWeeks: bottleneckCount,
      totalWeeks: totalWeeks,
      bottleneckPercentage: ((bottleneckCount / totalWeeks) * 100).toFixed(1),
      recommendations
    }
  });
});
