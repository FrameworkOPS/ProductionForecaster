import { Request, Response } from 'express';
import { query } from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';
import {
  calculateCrewRampUpMultiplier,
  calculateCrewRampDownMultiplier,
  isCrewBlockedByProject,
  daysBetween,
  calculateEffectiveCrewCapacity,
} from '../utils/calculations';

interface ForecastRequest {
  forecastDate: string;
  jobIds?: string[];
}

interface ForecastResponse {
  id: string;
  forecastDate: string;
  predictedCapacity: number;
  predictedRevenue?: number;
  confidenceScore: number;
  bottleneckDetected: boolean;
  bottleneckDescription?: string;
  createdAt: string;
}

export const generateForecast = asyncHandler(async (req: Request<{}, {}, ForecastRequest>, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { forecastDate, jobIds } = req.body;

  if (!forecastDate) {
    throw new AppError('Forecast date is required', 400);
  }

  try {
    // Fetch current parameters
    const paramsResult = await query(
      `SELECT * FROM production_parameters ORDER BY updated_at DESC LIMIT 1`
    );

    if (paramsResult.rows.length === 0) {
      throw new AppError('No production parameters configured', 400);
    }

    const params = paramsResult.rows[0];

    // Fetch active crews
    const crewsResult = await query(
      `SELECT id, crew_type, team_members, training_period_days, start_date, terminate_date, revenue_per_sq
       FROM crews WHERE is_active = true`
    );
    const crews = crewsResult.rows;

    // Fetch active custom projects
    const projectsResult = await query(
      `SELECT crew_id, start_date, end_date FROM custom_projects WHERE is_active = true`
    );
    const customProjects = projectsResult.rows;

    // Fetch jobs data with crew information
    let jobsQuery = `SELECT id, crew_id, estimated_duration, crew_size, revenue, square_footage FROM jobs WHERE status != 'completed'`;
    if (jobIds && jobIds.length > 0) {
      jobsQuery += ` AND id IN (${jobIds.map((_, i) => `$${i + 1}`).join(',')})`;
    }

    const jobsResult = await query(jobsQuery, jobIds || []);
    const jobs = jobsResult.rows;

    // Calculate forecast data
    const totalJobs = jobs.length;
    const totalDuration = jobs.reduce((sum: number, job: any) => sum + job.estimated_duration, 0);
    const avgCrewSize = jobs.reduce((sum: number, job: any) => sum + job.crew_size, 0) / Math.max(totalJobs, 1);

    // Calculate revenue with crew-based multipliers
    let totalRevenue = 0;
    const jobDetails: Array<any> = [];

    for (const job of jobs) {
      let jobRevenue = job.revenue || 0;

      // If job has crew assigned, calculate revenue based on crew type
      if (job.crew_id && job.square_footage) {
        const crew = crews.find((c: any) => c.id === job.crew_id);
        if (crew) {
          jobRevenue = job.square_footage * crew.revenue_per_sq;
        }
      }

      // Calculate crew multipliers
      let rampUpMultiplier = 1.0;
      let rampDownMultiplier = 1.0;
      let blockedByProject = false;

      if (job.crew_id) {
        const crew = crews.find((c: any) => c.id === job.crew_id);
        if (crew) {
          // Calculate ramp-up multiplier
          const daysElapsed = daysBetween(crew.start_date, forecastDate);
          rampUpMultiplier = calculateCrewRampUpMultiplier(
            crew.crew_type as 'shingle' | 'metal',
            daysElapsed,
            crew.training_period_days
          );

          // Calculate ramp-down multiplier
          if (crew.terminate_date) {
            rampDownMultiplier = calculateCrewRampDownMultiplier(crew.terminate_date, new Date(forecastDate));
          }

          // Check if crew is blocked by custom project
          const forecastDateObj = new Date(forecastDate);
          const sevenDaysAhead = new Date(forecastDateObj.getTime() + 7 * 24 * 60 * 60 * 1000);
          blockedByProject = isCrewBlockedByProject(
            job.crew_id,
            forecastDateObj,
            sevenDaysAhead, // 7 days ahead
            customProjects
          );
        }
      }

      // Apply multipliers to revenue
      const effectiveMultiplier = calculateEffectiveCrewCapacity(
        rampUpMultiplier,
        rampDownMultiplier,
        blockedByProject
      );
      const adjustedRevenue = jobRevenue * effectiveMultiplier;
      totalRevenue += adjustedRevenue;

      jobDetails.push({
        job,
        rampUpMultiplier,
        rampDownMultiplier,
        blockedByProject,
        effectiveMultiplier,
        adjustedRevenue,
      });
    }

    // Simplified forecast logic with crew capacity
    const productionRate = params.current_production_rate * params.seasonal_adjustment;
    let predictedCapacity = Math.ceil((params.crew_capacity / avgCrewSize) * productionRate);

    // Apply crew multipliers to predicted capacity
    let totalCrewMultiplier = 1.0;
    if (crews.length > 0) {
      let sumMultiplier = 0;
      for (const crew of crews) {
        const daysElapsed = daysBetween(crew.start_date, forecastDate);
        const rampUp = calculateCrewRampUpMultiplier(
          crew.crew_type as 'shingle' | 'metal',
          daysElapsed,
          crew.training_period_days
        );

        let rampDown = 1.0;
        if (crew.terminate_date) {
          rampDown = calculateCrewRampDownMultiplier(crew.terminate_date, new Date(forecastDate));
        }

        sumMultiplier += rampUp * rampDown;
      }
      totalCrewMultiplier = sumMultiplier / crews.length;
      predictedCapacity = Math.ceil(predictedCapacity * totalCrewMultiplier);
    }

    const bottleneckDetected = totalJobs > params.max_concurrent_jobs || totalCrewMultiplier < 0.5;

    const forecastId = await getUUID();

    // Save forecast
    await query(
      `INSERT INTO forecasts
       (id, forecast_date, predicted_capacity, predicted_revenue, confidence_score, bottleneck_detected, bottleneck_description, parameters_snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        forecastId,
        forecastDate,
        predictedCapacity,
        totalRevenue,
        bottleneckDetected ? 0.65 : 0.85,
        bottleneckDetected,
        bottleneckDetected
          ? `${totalJobs} jobs exceed capacity or crews at reduced capacity (${(totalCrewMultiplier * 100).toFixed(0)}%)`
          : null,
        JSON.stringify(params),
        req.user.userId,
      ]
    );

    // Save forecast details for each job
    for (const detail of jobDetails) {
      const job = detail.job;
      const estimatedCompletionDays = Math.ceil(
        job.estimated_duration / (productionRate * detail.effectiveMultiplier)
      );
      const completionDate = new Date(forecastDate);
      completionDate.setDate(completionDate.getDate() + estimatedCompletionDays);

      const detailId = await getUUID();
      await query(
        `INSERT INTO forecast_details
         (id, forecast_id, job_id, crew_id, predicted_completion_date, completion_probability,
          ramp_up_multiplier, ramp_down_multiplier, blocked_by_project, risk_flag)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          detailId,
          forecastId,
          job.id,
          job.crew_id || null,
          completionDate.toISOString().split('T')[0],
          bottleneckDetected ? 0.65 : 0.85,
          detail.rampUpMultiplier,
          detail.rampDownMultiplier,
          detail.blockedByProject,
          bottleneckDetected || detail.blockedByProject,
        ]
      );
    }

    const response: ForecastResponse = {
      id: forecastId,
      forecastDate,
      predictedCapacity,
      predictedRevenue: totalRevenue,
      confidenceScore: bottleneckDetected ? 0.65 : 0.85,
      bottleneckDetected,
      bottleneckDescription: bottleneckDetected
        ? `${totalJobs} jobs exceed capacity or crews at reduced capacity (${(totalCrewMultiplier * 100).toFixed(0)}%)`
        : undefined,
      createdAt: new Date().toISOString(),
    };

    res.status(201).json({
      success: true,
      message: 'Forecast generated successfully',
      data: response,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Forecast generation error:', error);
    throw new AppError('Failed to generate forecast', 500);
  }
});

export const getForecast = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;

  const result = await query(
    `SELECT id, forecast_date, predicted_capacity, predicted_revenue, confidence_score,
            bottleneck_detected, bottleneck_description, created_at
     FROM forecasts WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new AppError('Forecast not found', 404);
  }

  const forecast = result.rows[0];

  // Get forecast details
  const detailsResult = await query(
    `SELECT j.job_id, fd.predicted_completion_date, fd.completion_probability, fd.risk_flag
     FROM forecast_details fd
     JOIN jobs j ON fd.job_id = j.id
     WHERE fd.forecast_id = $1`,
    [id]
  );

  res.json({
    success: true,
    data: {
      id: forecast.id,
      forecastDate: forecast.forecast_date,
      predictedCapacity: forecast.predicted_capacity,
      predictedRevenue: forecast.predicted_revenue,
      confidenceScore: forecast.confidence_score,
      bottleneckDetected: forecast.bottleneck_detected,
      bottleneckDescription: forecast.bottleneck_description,
      createdAt: forecast.created_at,
      details: detailsResult.rows,
    },
  });
});

export const getForecastHistory = asyncHandler(async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = (page - 1) * limit;

  const countResult = await query('SELECT COUNT(*) as count FROM forecasts');
  const total = countResult.rows[0].count;

  const result = await query(
    `SELECT id, forecast_date, predicted_capacity, predicted_revenue, confidence_score,
            bottleneck_detected, created_at
     FROM forecasts
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

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

export const getForecastInsights = asyncHandler(async (req: Request<{ id: string }>, res: Response) => {
  const { id } = req.params;

  // Fetch forecast
  const forecastResult = await query('SELECT * FROM forecasts WHERE id = $1', [id]);
  if (forecastResult.rows.length === 0) {
    throw new AppError('Forecast not found', 404);
  }

  const forecast = forecastResult.rows[0];

  // Generate AI insights (placeholder - will call Claude API)
  const insights = {
    summary: `Based on the forecast generated on ${forecast.forecast_date}`,
    recommendations: [
      `Current predicted capacity: ${forecast.predicted_capacity} jobs/week`,
      forecast.bottleneck_detected
        ? `⚠️ Bottleneck detected: ${forecast.bottleneck_description}`
        : '✅ No bottlenecks detected in current schedule',
      `Confidence score: ${(forecast.confidence_score * 100).toFixed(1)}%`,
    ],
    risks: forecast.bottleneck_detected ? ['Scheduling conflicts', 'Crew overallocation'] : [],
  };

  res.json({
    success: true,
    data: insights,
  });
});

/**
 * Export forecast as PDF
 */
export const exportForecastPDF = asyncHandler(
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PDFDocument = require('pdfkit');

    // Fetch forecast
    const forecastResult = await query(
      `SELECT id, forecast_date, predicted_capacity, predicted_revenue, confidence_score,
              bottleneck_detected, bottleneck_description, parameters_snapshot
       FROM forecasts WHERE id = $1`,
      [id]
    );

    if (forecastResult.rows.length === 0) {
      throw new AppError('Forecast not found', 404);
    }

    const forecast = forecastResult.rows[0];

    // Fetch forecast details with crew info
    const detailsResult = await query(
      `SELECT fd.id, fd.job_id, fd.crew_id, fd.predicted_completion_date,
              fd.completion_probability, fd.ramp_up_multiplier, fd.ramp_down_multiplier,
              fd.blocked_by_project, j.customer_name, j.square_footage, c.crew_name, c.crew_type
       FROM forecast_details fd
       JOIN jobs j ON fd.job_id = j.id
       LEFT JOIN crews c ON fd.crew_id = c.id
       WHERE fd.forecast_id = $1
       ORDER BY j.customer_name`,
      [id]
    );

    const details = detailsResult.rows;

    // Create PDF document
    const doc = new PDFDocument({
      bufferPages: true,
      size: 'LETTER',
      margin: 50,
    });

    // Set up response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="forecast-${forecast.forecast_date}.pdf"`
    );

    // Pipe to response
    doc.pipe(res);

    // Add title
    doc.fontSize(24).font('Helvetica-Bold').text('Production Forecast Report', {
      align: 'center',
    });

    doc.moveDown();
    doc.fontSize(12).font('Helvetica').text(`Generated: ${new Date().toLocaleDateString()}`, {
      align: 'center',
    });
    doc.text(`Forecast Date: ${forecast.forecast_date}`, { align: 'center' });

    doc.moveDown(1.5);

    // Summary section
    doc.fontSize(14).font('Helvetica-Bold').text('Summary');
    doc.fontSize(11).font('Helvetica');
    doc.text(`Predicted Capacity: ${forecast.predicted_capacity} jobs/week`);
    doc.text(`Predicted Revenue: $${parseFloat(forecast.predicted_revenue).toLocaleString()}`);
    doc.text(
      `Confidence Score: ${(forecast.confidence_score * 100).toFixed(1)}%`,
      { link: null }
    );
    doc.text(`Status: ${forecast.bottleneck_detected ? '⚠️ Bottleneck Detected' : '✅ Normal'}`);

    if (forecast.bottleneck_description) {
      doc.text(`Details: ${forecast.bottleneck_description}`);
    }

    doc.moveDown(1.5);

    // Crew allocation section
    doc.fontSize(14).font('Helvetica-Bold').text('Crew Allocation & Job Details');

    // Table header
    const startX = 50;
    const colWidths = [60, 100, 80, 70, 60, 60];
    const rowHeight = 20;
    let y = doc.y + 10;

    const headers = ['Crew', 'Customer', 'Est. Completion', 'Ramp Up', 'Ramp Down', 'Blocked'];
    let x = startX;

    doc.fontSize(10).font('Helvetica-Bold');
    for (let i = 0; i < headers.length; i++) {
      doc.text(headers[i], x, y, { width: colWidths[i], height: rowHeight });
      x += colWidths[i];
    }

    y += rowHeight;
    doc.strokeColor('#cccccc').moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b), y).stroke();

    doc.fontSize(9).font('Helvetica');

    for (const detail of details) {
      y += rowHeight;

      // Wrap text for each column
      const crewName = detail.crew_name || 'Unassigned';
      const customerName = detail.customer_name || 'N/A';
      const completionDate = detail.predicted_completion_date || 'N/A';
      const rampUp = detail.ramp_up_multiplier
        ? (parseFloat(detail.ramp_up_multiplier) * 100).toFixed(0) + '%'
        : '100%';
      const rampDown = detail.ramp_down_multiplier
        ? (parseFloat(detail.ramp_down_multiplier) * 100).toFixed(0) + '%'
        : '100%';
      const blocked = detail.blocked_by_project ? 'Yes' : 'No';

      x = startX;
      doc.text(crewName, x, y, { width: colWidths[0], height: rowHeight });
      x += colWidths[0];
      doc.text(customerName, x, y, { width: colWidths[1], height: rowHeight });
      x += colWidths[1];
      doc.text(completionDate, x, y, { width: colWidths[2], height: rowHeight });
      x += colWidths[2];
      doc.text(rampUp, x, y, { width: colWidths[3], height: rowHeight });
      x += colWidths[3];
      doc.text(rampDown, x, y, { width: colWidths[4], height: rowHeight });
      x += colWidths[4];
      doc.text(blocked, x, y, { width: colWidths[5], height: rowHeight });

      // Add light divider
      if (y > 700) {
        // New page if too long
        doc.addPage();
        y = 50;
      }
    }

    doc.moveDown(2);
    doc.fontSize(10)
      .font('Helvetica')
      .text('This report was generated by the Production Forecaster system.', {
        align: 'center',
      });

    // Finalize PDF
    doc.end();
  }
);
