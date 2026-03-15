import { Request, Response } from 'express';
import { query } from '../config/database';
import HubSpotService from '../services/hubspotService';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { getUUID } from '../utils/uuid';

export const initiateOAuth = asyncHandler(async (req: Request, res: Response) => {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new AppError('HubSpot credentials not configured', 500);
  }

  const hubspotService = new HubSpotService();
  const authUrl = hubspotService.getAuthorizationUrl(clientId, redirectUri);

  res.json({
    success: true,
    message: 'Redirect user to this URL to authorize HubSpot access',
    authUrl,
  });
});

export const handleOAuthCallback = asyncHandler(async (req: Request, res: Response) => {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    throw new AppError('Authorization code not provided', 400);
  }

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const redirectUri = process.env.HUBSPOT_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new AppError('HubSpot credentials not configured', 500);
  }

  try {
    const hubspotService = new HubSpotService();
    const accessToken = await hubspotService.exchangeCodeForToken(
      clientId,
      clientSecret,
      code,
      redirectUri
    );

    // Store access token securely (in production, use encrypted storage)
    // For now, store in environment or database
    res.json({
      success: true,
      message: 'Successfully authenticated with HubSpot',
      accessToken,
      // In production, you'd want to securely store this token
      nextStep: 'Use this token in the sync endpoint or store it securely',
    });
  } catch (error) {
    throw new AppError('Failed to authenticate with HubSpot', 500);
  }
});

export const syncJobs = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { accessToken } = req.body;

  if (!accessToken) {
    throw new AppError('HubSpot access token required', 400);
  }

  try {
    const hubspotService = new HubSpotService(accessToken);
    const syncResult = await hubspotService.syncJobs(req.user.userId);

    // Log audit entry
    await query(
      `INSERT INTO audit_log (id, user_id, action, entity_type, new_values, timestamp)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [
        await getUUID(),
        req.user.userId,
        'SYNC',
        'jobs',
        JSON.stringify(syncResult),
      ]
    );

    res.json({
      success: true,
      message: 'Jobs synchronized successfully',
      data: syncResult,
    });
  } catch (error) {
    throw new AppError('Failed to sync jobs from HubSpot', 500);
  }
});

export const getHubSpotStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  res.json({
    success: true,
    data: {
      configured: !!(clientId && clientSecret),
      message: clientId && clientSecret
        ? 'HubSpot integration configured'
        : 'HubSpot integration not configured. Please set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET',
    },
  });
});
