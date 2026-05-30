import axios, { AxiosInstance } from 'axios';
import { query } from '../config/database';
import { getUUID } from '../utils/uuid';

/**
 * JobNimbus integration.
 *
 * JobNimbus exposes a REST API (api1) authenticated with an API key passed as a
 * Bearer token. We read Jobs and map them into the local `jobs` table and the
 * weighted sales pipeline, mirroring the shape the frontend already consumes.
 *
 * Configuration (environment variables). Field/status names vary per JobNimbus
 * account, so the mapping is driven entirely by config — no code change needed
 * once the account's field names are known:
 *
 *   JOBNIMBUS_API_KEY            — required, the API key from JobNimbus settings
 *   JOBNIMBUS_API_BASE           — optional, defaults to https://app.jobnimbus.com/api1
 *   JOBNIMBUS_PIPELINE_STATUSES  — optional CSV of status names that count as the
 *                                  active sales pipeline (e.g. "Contract Signed,Estimating").
 *                                  When unset, all jobs are included.
 *   JOBNIMBUS_ROOF_SQUARES_FIELDS — optional CSV of field names to read roof squares
 *                                  from, tried in order. Defaults to a set of common
 *                                  names (roof_squares, Roof Squares, squares, sqs).
 *   JOBNIMBUS_TYPE_FIELDS        — optional CSV of field names to inspect when
 *                                  classifying metal vs. shingle. Defaults to
 *                                  record_type_name, status_name, name, display_name.
 *   JOBNIMBUS_METAL_KEYWORDS     — optional CSV of substrings that mark a metal job
 *                                  (default "metal").
 *   JOBNIMBUS_SHINGLE_KEYWORDS   — optional CSV of substrings that mark a shingle job
 *                                  (default "shingle").
 */

function csvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

export interface JobNimbusJob {
  jnid: string;
  recid?: number;
  name?: string;
  display_name?: string;
  status_name?: string;
  record_type_name?: string;
  date_created?: number;
  date_updated?: number;
  date_start?: number;
  // Custom / measurement fields vary by account — captured loosely.
  [key: string]: any;
}

export interface RoofingSquaresSummary {
  metal: number;
  shingles: number;
}

interface JobMapping {
  jobId: string;
  installDate: string;
  estimatedDuration: number;
  crewSize: number;
  crewType?: string;
  squareFootage?: number;
  revenue?: number;
  customerName?: string;
  jobAddress?: string;
}

export class JobNimbusService {
  private apiClient: AxiosInstance;
  private readonly pipelineStatuses: string[];
  private readonly roofSquaresFields: string[];
  private readonly typeFields: string[];
  private readonly metalKeywords: string[];
  private readonly shingleKeywords: string[];

  constructor(apiKey: string) {
    const baseURL = process.env.JOBNIMBUS_API_BASE || 'https://app.jobnimbus.com/api1';
    this.apiClient = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    this.pipelineStatuses = csvEnv('JOBNIMBUS_PIPELINE_STATUSES', []).map((s) => s.toLowerCase());
    this.roofSquaresFields = csvEnv('JOBNIMBUS_ROOF_SQUARES_FIELDS', [
      'roof_squares',
      'Roof Squares',
      'squares',
      'Squares',
      'sqs',
      'SQs',
    ]);
    this.typeFields = csvEnv('JOBNIMBUS_TYPE_FIELDS', [
      'record_type_name',
      'status_name',
      'name',
      'display_name',
    ]);
    this.metalKeywords = csvEnv('JOBNIMBUS_METAL_KEYWORDS', ['metal']).map((s) => s.toLowerCase());
    this.shingleKeywords = csvEnv('JOBNIMBUS_SHINGLE_KEYWORDS', ['shingle']).map((s) =>
      s.toLowerCase()
    );
  }

  /**
   * Fetch jobs from JobNimbus, paginating until exhausted. JobNimbus returns
   * { count, results } and accepts `from` / `size` query params.
   */
  async fetchJobs(): Promise<JobNimbusJob[]> {
    const all: JobNimbusJob[] = [];
    const size = 100;
    let from = 0;

    try {
      // Guard against runaway loops — cap at 50 pages (5,000 jobs).
      for (let page = 0; page < 50; page++) {
        const response = await this.apiClient.get('/jobs', { params: { from, size } });
        const results: JobNimbusJob[] = response.data?.results || [];
        all.push(...results);

        if (results.length < size) break;
        from += size;
      }
      return all;
    } catch (error) {
      console.error('Error fetching jobs from JobNimbus:', error);
      throw new Error('Failed to fetch jobs from JobNimbus');
    }
  }

  /**
   * Jobs in one of the configured pipeline statuses. When no statuses are
   * configured, every job is considered in-pipeline.
   */
  filterPipelineJobs(jobs: JobNimbusJob[]): JobNimbusJob[] {
    if (this.pipelineStatuses.length === 0) return jobs;
    return jobs.filter((j) =>
      this.pipelineStatuses.includes((j.status_name || '').toLowerCase())
    );
  }

  /**
   * Classify a job as 'metal' or 'shingle' by scanning the configured type
   * fields for the configured keywords. Returns null when neither matches.
   * If both match, metal wins (a metal+shingle job is treated as metal).
   */
  classifyJobType(job: JobNimbusJob): 'metal' | 'shingle' | null {
    const haystack = this.typeFields
      .map((f) => job[f])
      .filter((v) => v != null && v !== '')
      .join(' ')
      .toLowerCase();

    if (this.metalKeywords.some((k) => haystack.includes(k))) return 'metal';
    if (this.shingleKeywords.some((k) => haystack.includes(k))) return 'shingle';
    return null;
  }

  /**
   * Pull a numeric "roof squares" value from the configured field names, tried
   * in order. Falls back to 0 when none are present or parseable.
   */
  extractRoofSquares(job: JobNimbusJob): number {
    for (const key of this.roofSquaresFields) {
      const val = parseFloat(job[key]);
      if (!Number.isNaN(val) && val > 0) return val;
    }
    return 0;
  }

  aggregateRoofingSquares(jobs: JobNimbusJob[]): RoofingSquaresSummary {
    let metal = 0;
    let shingles = 0;
    for (const job of jobs) {
      const sqs = this.extractRoofSquares(job);
      const type = this.classifyJobType(job);
      if (type === 'metal') metal += sqs;
      else if (type === 'shingle') shingles += sqs;
    }
    return { metal, shingles };
  }

  mapJobData(job: JobNimbusJob): JobMapping {
    const type = this.classifyJobType(job);
    const sqs = this.extractRoofSquares(job);
    return {
      jobId: job.jnid,
      installDate: this.formatDate(job.date_start || job.date_created),
      estimatedDuration: 5,
      crewSize: 3,
      crewType: type === 'metal' ? 'Metal Roof' : type === 'shingle' ? 'Shingles Roof' : undefined,
      squareFootage: sqs > 0 ? sqs : 30,
      revenue: parseFloat(job.total) || undefined,
      customerName: job.display_name || job.name || 'Unnamed Job',
      jobAddress: [job.address_line1, job.city, job.state_text].filter(Boolean).join(', '),
    };
  }

  /**
   * Sync JobNimbus jobs into the local `jobs` table (upsert by job_id).
   */
  async syncJobs(_userId: string): Promise<{ created: number; updated: number; total: number }> {
    const jobs = this.filterPipelineJobs(await this.fetchJobs());
    let created = 0;
    let updated = 0;

    for (const job of jobs) {
      const mapped = this.mapJobData(job);
      const existing = await query('SELECT id FROM jobs WHERE job_id = $1', [mapped.jobId]);

      if (existing.rows.length > 0) {
        await query(
          `UPDATE jobs SET
            install_date = $1,
            estimated_duration = $2,
            crew_size = $3,
            crew_type = $4,
            square_footage = $5,
            revenue = $6,
            customer_name = $7,
            job_address = $8,
            jobnimbus_id = $9,
            updated_at = CURRENT_TIMESTAMP
           WHERE job_id = $10`,
          [
            mapped.installDate,
            mapped.estimatedDuration,
            mapped.crewSize,
            mapped.crewType || null,
            mapped.squareFootage || null,
            mapped.revenue || null,
            mapped.customerName,
            mapped.jobAddress,
            mapped.jobId,
            mapped.jobId,
          ]
        );
        updated++;
      } else {
        await query(
          `INSERT INTO jobs
           (id, job_id, jobnimbus_id, install_date, estimated_duration, crew_size, crew_type, square_footage, revenue, customer_name, job_address, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            await getUUID(),
            mapped.jobId,
            mapped.jobId,
            mapped.installDate,
            mapped.estimatedDuration,
            mapped.crewSize,
            mapped.crewType || null,
            mapped.squareFootage || null,
            mapped.revenue || null,
            mapped.customerName,
            mapped.jobAddress,
            'pending',
          ]
        );
        created++;
      }
    }

    return { created, updated, total: jobs.length };
  }

  private formatDate(epoch: number | undefined): string {
    if (!epoch) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }
    // JobNimbus dates are unix epoch seconds.
    return new Date(epoch * 1000).toISOString().split('T')[0];
  }
}

export default JobNimbusService;
