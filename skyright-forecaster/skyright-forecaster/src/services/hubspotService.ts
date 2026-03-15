import axios, { AxiosInstance } from 'axios';
import { query } from '../config/database';
import { getUUID } from '../utils/uuid';

interface HubSpotJob {
  id: string;
  properties: {
    [key: string]: any;
  };
}

interface JobMapping {
  jobId: string;
  installDate: string;
  estimatedDuration: number;
  crewSize: number;
  revenue?: number;
  customerName?: string;
  jobAddress?: string;
}

export class HubSpotService {
  private accessToken: string | null = null;
  private apiClient: AxiosInstance;
  private readonly HUBSPOT_API_BASE = 'https://api.hubapi.com';

  constructor(accessToken?: string) {
    this.accessToken = accessToken || null;
    this.apiClient = axios.create({
      baseURL: this.HUBSPOT_API_BASE,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
    this.apiClient.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  /**
   * Fetch pending jobs from HubSpot
   * Assumes jobs are stored in a custom object or deals
   */
  async fetchPendingJobs(limit: number = 100): Promise<HubSpotJob[]> {
    try {
      const response = await this.apiClient.get('/crm/v3/objects/deals', {
        params: {
          limit,
          filterGroups: [
            {
              filters: [
                {
                  propertyName: 'dealstage',
                  operator: 'IN',
                  values: ['qualifiedtobuy', 'presentationsched', 'proposalsubmitted'],
                },
              ],
            },
          ],
          properties: [
            'dealname',
            'dealstage',
            'amount',
            'closedate',
            'notes',
            'associatedcompany',
          ],
        },
      });

      return response.data.results || [];
    } catch (error) {
      console.error('Error fetching jobs from HubSpot:', error);
      throw new Error('Failed to fetch jobs from HubSpot');
    }
  }

  /**
   * Map HubSpot job data to internal format
   */
  mapJobData(hubspotJob: HubSpotJob): JobMapping {
    const props = hubspotJob.properties;

    // Extract estimated duration from notes or use default
    const estimatedDuration = this.extractDurationFromNotes(props.notes) || 5;

    return {
      jobId: hubspotJob.id,
      installDate: this.formatDate(props.closedate),
      estimatedDuration,
      crewSize: this.extractCrewSizeFromNotes(props.notes) || 3,
      revenue: props.amount ? parseFloat(props.amount) : undefined,
      customerName: props.associatedcompany || props.dealname,
      jobAddress: props.notes || '',
    };
  }

  /**
   * Sync jobs from HubSpot to local database
   */
  async syncJobs(userId: string): Promise<{ created: number; updated: number; total: number }> {
    try {
      const hubspotJobs = await this.fetchPendingJobs();
      let created = 0;
      let updated = 0;

      for (const hubspotJob of hubspotJobs) {
        const mappedJob = this.mapJobData(hubspotJob);

        // Check if job already exists
        const existingResult = await query(
          'SELECT id FROM jobs WHERE job_id = $1',
          [mappedJob.jobId]
        );

        if (existingResult.rows.length > 0) {
          // Update existing job
          await query(
            `UPDATE jobs SET
              install_date = $1,
              estimated_duration = $2,
              crew_size = $3,
              revenue = $4,
              customer_name = $5,
              job_address = $6,
              updated_at = CURRENT_TIMESTAMP
             WHERE job_id = $7`,
            [
              mappedJob.installDate,
              mappedJob.estimatedDuration,
              mappedJob.crewSize,
              mappedJob.revenue || null,
              mappedJob.customerName,
              mappedJob.jobAddress,
              mappedJob.jobId,
            ]
          );
          updated++;
        } else {
          // Create new job
          await query(
            `INSERT INTO jobs
             (id, job_id, hubspot_id, install_date, estimated_duration, crew_size, revenue, customer_name, job_address, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              await getUUID(),
              mappedJob.jobId,
              hubspotJob.id,
              mappedJob.installDate,
              mappedJob.estimatedDuration,
              mappedJob.crewSize,
              mappedJob.revenue || null,
              mappedJob.customerName,
              mappedJob.jobAddress,
              'pending',
            ]
          );
          created++;
        }
      }

      return {
        created,
        updated,
        total: hubspotJobs.length,
      };
    } catch (error) {
      console.error('Error syncing jobs:', error);
      throw new Error('Failed to sync jobs from HubSpot');
    }
  }

  /**
   * Extract duration from notes field (looks for "X days" pattern)
   */
  private extractDurationFromNotes(notes: string | undefined): number | null {
    if (!notes) return null;
    const match = notes.match(/(\d+)\s*days?/i);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Extract crew size from notes field (looks for "X crew" or "X people" pattern)
   */
  private extractCrewSizeFromNotes(notes: string | undefined): number | null {
    if (!notes) return null;
    const match = notes.match(/(\d+)\s*(crew|people|team members?)/i);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Format date from HubSpot format (typically ISO) to YYYY-MM-DD
   */
  private formatDate(dateString: string | undefined): string {
    if (!dateString) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }
    return dateString.split('T')[0];
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthorizationUrl(clientId: string, redirectUri: string, scopes: string[] = []): string {
    const defaultScopes = [
      'crm.objects.deals.read',
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
    ];

    const allScopes = scopes.length > 0 ? scopes : defaultScopes;

    return (
      `https://app.hubapi.com/oauth/authorize?` +
      `client_id=${clientId}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `scope=${encodeURIComponent(allScopes.join(' '))}&` +
      `response_type=code`
    );
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ): Promise<string> {
    try {
      const response = await axios.post('https://api.hubapi.com/oauth/v1/token', {
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      });

      return response.data.access_token;
    } catch (error) {
      console.error('Error exchanging code for token:', error);
      throw new Error('Failed to obtain access token from HubSpot');
    }
  }
}

export default HubSpotService;
