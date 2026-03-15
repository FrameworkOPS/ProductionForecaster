import { Request, Response } from 'express';
import { query } from '../config/database';
import ClaudeService from '../services/claudeService';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';

const claudeService = new ClaudeService();

export const generateInsights = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { forecastId } = req.body;

  if (!forecastId) {
    throw new AppError('Forecast ID required', 400);
  }

  try {
    // Fetch the forecast
    const forecastResult = await query(
      `SELECT
        id, forecast_date, predicted_capacity, predicted_revenue,
        confidence_score, bottleneck_detected, bottleneck_description
       FROM forecasts WHERE id = $1`,
      [forecastId]
    );

    if (forecastResult.rows.length === 0) {
      throw new AppError('Forecast not found', 404);
    }

    const forecast = forecastResult.rows[0];

    // Generate insights using Claude
    const insights = await claudeService.generateInsights({
      predictedCapacity: forecast.predicted_capacity,
      predictedRevenue: forecast.predicted_revenue,
      confidenceScore: forecast.confidence_score,
      bottleneckDetected: forecast.bottleneck_detected,
      bottleneckDescription: forecast.bottleneck_description,
    });

    // Save insights to database
    const insightId = await getUUID();
    await query(
      `INSERT INTO insights (id, forecast_id, summary, recommendations, risks, opportunities, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        insightId,
        forecastId,
        insights.summary,
        JSON.stringify(insights.recommendations),
        JSON.stringify(insights.risks),
        JSON.stringify(insights.opportunities),
        req.user.userId,
      ]
    );

    res.json({
      success: true,
      message: 'Insights generated successfully',
      data: {
        id: insightId,
        ...insights,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Failed to generate insights', 500);
  }
});

export const getInsights = asyncHandler(async (req: Request, res: Response) => {
  const { forecastId } = req.params;

  const result = await query(
    `SELECT id, forecast_id, summary, recommendations, risks, opportunities, created_at
     FROM insights WHERE forecast_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [forecastId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Insights not found', 404);
  }

  const insight = result.rows[0];

  res.json({
    success: true,
    data: {
      id: insight.id,
      forecastId: insight.forecast_id,
      summary: insight.summary,
      recommendations: JSON.parse(insight.recommendations),
      risks: JSON.parse(insight.risks),
      opportunities: JSON.parse(insight.opportunities),
      createdAt: insight.created_at,
    },
  });
});

export const askQuestion = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { forecastId, question } = req.body;

  if (!forecastId || !question) {
    throw new AppError('Forecast ID and question required', 400);
  }

  try {
    // Fetch forecast data
    const forecastResult = await query(
      `SELECT
        id, forecast_date, predicted_capacity, predicted_revenue,
        confidence_score, bottleneck_detected
       FROM forecasts WHERE id = $1`,
      [forecastId]
    );

    if (forecastResult.rows.length === 0) {
      throw new AppError('Forecast not found', 404);
    }

    const forecast = forecastResult.rows[0];

    // Use Claude to answer the question
    const prompt = `
Based on this forecast data:
- Capacity: ${forecast.predicted_capacity} jobs/week
- Revenue: $${forecast.predicted_revenue}
- Confidence: ${(forecast.confidence_score * 100).toFixed(0)}%

User Question: ${question}

Provide a concise, actionable answer.`;

    const answer = await claudeService.generateInsights({
      predictedCapacity: forecast.predicted_capacity,
      predictedRevenue: forecast.predicted_revenue,
      confidenceScore: forecast.confidence_score,
      bottleneckDetected: forecast.bottleneck_detected,
    });

    res.json({
      success: true,
      data: {
        question,
        answer: answer.summary,
        recommendations: answer.recommendations,
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Failed to process question', 500);
  }
});

// Create insights table if needed
export async function initializeInsightsTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS insights (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        forecast_id UUID NOT NULL REFERENCES forecasts(id) ON DELETE CASCADE,
        summary TEXT NOT NULL,
        recommendations JSONB,
        risks JSONB,
        opportunities JSONB,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_insights_forecast_id ON insights(forecast_id);
    `);
  } catch (error) {
    console.error('Error initializing insights table:', error);
  }
}
