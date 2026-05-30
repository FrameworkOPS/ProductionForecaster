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
 *                                  active sales pipeline (e.g. "Sold,In Production").
 *                                  When unset, all jobs are included.
 *   JOBNIMBUS_ROOF_SQUARES_FIELDS — optional CSV of field names to read roof squares
 *                                  from, tried in order. Defaults include the Summit
 *                                  Work Order field "# Of SQS".
 *   JOBNIMBUS_TYPE_FIELDS        — optional CSV of field names to inspect when
 *                                  classifying metal vs. shingle. Defaults include the
 *                                  Summit Job field "What Material?".
 *   JOBNIMBUS_METAL_KEYWORDS     — optional CSV of substrings that mark a metal job
 *                                  (default "metal").
 *   JOBNIMBUS_SHINGLE_KEYWORDS   — optional CSV of substrings that mark a shingle job
 *                                  (default "shingle").
 *
 * Note on roof squares: in this account the squares live on a Work Order custom
 * field ("# Of SQS"), not on the Job. syncJobs / pipeline therefore fetch Work
 * Orders too and join their squares back onto the parent job by jnid.
 */

function csvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : fallback;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const val = parseFloat(raw);
  return Number.isNaN(val) ? fallback : val;
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
  private readonly gutterKeywords: string[];
  private readonly estimatingStatuses: string[];
  private readonly estimatingCloseRate: number;
  private readonly estimatingDefaultSqs: number;

  constructor(apiKey: string) {
    const baseURL = process.env.JOBNIMBUS_API_BASE || 'https://app.jobnimbus.com/api1';
    this.apiClient = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    // Defaults match the Summit JobNimbus account's firm/sold statuses; override
    // via JOBNIMBUS_PIPELINE_STATUSES. Set it to "*" to include all jobs.
    const pipelineRaw = csvEnv('JOBNIMBUS_PIPELINE_STATUSES', [
      'Signed Contract',
      'Sent To Production',
      'T/O to Production',
      'Long Term Schedule',
    ]);
    this.pipelineStatuses = pipelineRaw.includes('*')
      ? []
      : pipelineRaw.map((s) => s.toLowerCase());
    this.roofSquaresFields = csvEnv('JOBNIMBUS_ROOF_SQUARES_FIELDS', [
      '# Of SQS',
      'roof_squares',
      'Roof Squares',
      'squares',
      'Squares',
      'sqs',
      'SQs',
    ]);
    this.typeFields = csvEnv('JOBNIMBUS_TYPE_FIELDS', [
      'What Material?',
      'record_type_name',
      'status_name',
      'name',
      'display_name',
    ]);
    // Defaults map the Summit account's "What Material?" values:
    //   metal   ← Standing Seam, Exposed Fastener, anything with "metal"
    //   shingle ← Shingles, Premium Shingles, Synthetic
    //   Gutters matches neither, so gutter jobs are excluded from the forecast.
    this.metalKeywords = csvEnv('JOBNIMBUS_METAL_KEYWORDS', [
      'metal',
      'standing seam',
      'exposed fastener',
    ]).map((s) => s.toLowerCase());
    this.shingleKeywords = csvEnv('JOBNIMBUS_SHINGLE_KEYWORDS', ['shingle', 'synthetic']).map((s) =>
      s.toLowerCase()
    );
    // Gutters are tracked separately (by job count + crew type), not by squares,
    // so they're kept out of classifyJobType / the squares-based forecast.
    this.gutterKeywords = csvEnv('JOBNIMBUS_GUTTER_KEYWORDS', ['gutter']).map((s) =>
      s.toLowerCase()
    );

    // Estimating-stage jobs are speculative: weight their squares by a close
    // rate and assume a default roof size since squares often aren't measured
    // until the job is sold. All tunable via env.
    this.estimatingStatuses = csvEnv('JOBNIMBUS_ESTIMATING_STATUSES', ['Contract Sent']).map((s) =>
      s.toLowerCase()
    );
    this.estimatingCloseRate = numEnv('JOBNIMBUS_ESTIMATING_CLOSE_RATE', 0.35);
    this.estimatingDefaultSqs = numEnv('JOBNIMBUS_ESTIMATING_DEFAULT_SQS', 30);
  }

  /** True when a job is in an estimating (pre-sold) status. */
  isEstimating(job: JobNimbusJob): boolean {
    return this.estimatingStatuses.includes((job.status_name || '').toLowerCase());
  }

  /**
   * Diagnostic snapshot — used by GET /api/jobnimbus/debug to see exactly what
   * JobNimbus returns and why jobs may not be classifying. Never throws on the
   * work-order side.
   */
  async debug(): Promise<Record<string, any>> {
    const jobs = await this.fetchJobs();
    const squaresByJob = await this.fetchRoofSquaresByJob();

    // Tally status names so we can see what to put in PIPELINE/ESTIMATING vars.
    const statusCounts: Record<string, number> = {};
    for (const j of jobs) {
      const s = j.status_name || '(none)';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }

    const classified = jobs.filter((j) => this.classifyJobType(j) !== null).length;
    const forecastJobs = this.filterForecastJobs(jobs);
    const withSquares = jobs.filter((j) => this.rawSquaresForJob(j, squaresByJob) > 0).length;

    // How often is the material field actually populated, and what values does
    // it take? Confirms whether "What Material?" comes back from the list API.
    const materialField = this.typeFields[0]; // configured material field, e.g. "What Material?"
    const materialValueCounts: Record<string, number> = {};
    let jobsWithMaterial = 0;
    for (const j of jobs) {
      const v = j[materialField];
      if (v != null && v !== '') {
        jobsWithMaterial++;
        const key = String(v);
        materialValueCounts[key] = (materialValueCounts[key] || 0) + 1;
      }
    }

    // record_type_name distribution — a fallback signal for roof type.
    const recordTypeCounts: Record<string, number> = {};
    for (const j of jobs) {
      const v = j.record_type_name || '(none)';
      recordTypeCounts[v] = (recordTypeCounts[v] || 0) + 1;
    }

    const sample = jobs[0] || null;
    return {
      totalJobs: jobs.length,
      statusCounts,
      classifiedAsMetalOrShingle: classified,
      forecastJobCount: forecastJobs.length,
      jobsWithSquares: withSquares,
      workOrdersLinkedToJobs: squaresByJob.size,
      materialField,
      jobsWithMaterialField: jobsWithMaterial,
      materialValueCounts,
      recordTypeCounts,
      config: {
        pipelineStatuses: this.pipelineStatuses,
        estimatingStatuses: this.estimatingStatuses,
        typeFields: this.typeFields,
        roofSquaresFields: this.roofSquaresFields,
        metalKeywords: this.metalKeywords,
        shingleKeywords: this.shingleKeywords,
        gutterKeywords: this.gutterKeywords,
      },
      gutterJobsTotal: jobs.filter((j) => this.isGutterJob(j)).length,
      gutterJobsInForecast: this.countGutterJobs(forecastJobs),
      // Field names present on the first job — reveals whether custom fields
      // like "What Material?" actually come back from the list endpoint.
      sampleJobFieldNames: sample ? Object.keys(sample).sort() : [],
      sampleJobValues: sample
        ? {
            jnid: sample.jnid,
            status_name: sample.status_name,
            record_type_name: sample.record_type_name,
            'What Material?': sample['What Material?'] ?? null,
            '# Of SQS': sample['# Of SQS'] ?? null,
            classifiedAs: this.classifyJobType(sample),
          }
        : null,
    };
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
   * Fetch Work Orders from JobNimbus, paginating until exhausted. Same
   * { count, results } / from+size shape as /jobs.
   */
  async fetchWorkOrders(): Promise<JobNimbusJob[]> {
    const all: JobNimbusJob[] = [];
    const size = 100;
    let from = 0;

    for (let page = 0; page < 50; page++) {
      const response = await this.apiClient.get('/workorders', { params: { from, size } });
      const results: JobNimbusJob[] = response.data?.results || [];
      all.push(...results);
      if (results.length < size) break;
      from += size;
    }
    return all;
  }

  /**
   * Build a map of jobId → roof squares from Work Orders. A work order links to
   * its parent job via `related[].id` (type 'job') or a `primary`/`job` ref.
   * When multiple work orders touch the same job, their squares are summed.
   *
   * Fails soft: any error fetching work orders yields an empty map so jobs can
   * still sync (they'll fall back to the default square count).
   */
  async fetchRoofSquaresByJob(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    let workOrders: JobNimbusJob[];
    try {
      workOrders = await this.fetchWorkOrders();
    } catch (error) {
      console.warn('[JobNimbus] could not fetch work orders for squares:', (error as Error).message);
      return map;
    }

    for (const wo of workOrders) {
      const sqs = this.extractRoofSquares(wo);
      if (sqs <= 0) continue;
      for (const jobId of this.relatedJobIds(wo)) {
        map.set(jobId, (map.get(jobId) || 0) + sqs);
      }
    }
    return map;
  }

  /** Collect parent-job jnids a work order references. */
  private relatedJobIds(wo: JobNimbusJob): string[] {
    const ids = new Set<string>();
    const related = Array.isArray(wo.related) ? wo.related : [];
    for (const r of related) {
      if (r && r.type === 'job' && r.id) ids.add(r.id);
    }
    if (wo.primary && wo.primary.type === 'job' && wo.primary.id) ids.add(wo.primary.id);
    if (typeof wo.job === 'string') ids.add(wo.job);
    return [...ids];
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
   * Jobs that should appear in the weighted sales forecast: the active pipeline
   * statuses PLUS estimating-stage jobs (which are weighted down by the close
   * rate in squaresForJob). When no pipeline statuses are configured, all jobs
   * are already included.
   */
  filterForecastJobs(jobs: JobNimbusJob[]): JobNimbusJob[] {
    if (this.pipelineStatuses.length === 0) return jobs;
    const include = new Set([...this.pipelineStatuses, ...this.estimatingStatuses]);
    return jobs.filter((j) => include.has((j.status_name || '').toLowerCase()));
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
   * Gutters are a distinct trade tracked by job count + crew type, not roof
   * squares. Kept separate from classifyJobType so they never enter the
   * squares-based shingle/metal forecast.
   */
  isGutterJob(job: JobNimbusJob): boolean {
    const haystack = this.typeFields
      .map((f) => job[f])
      .filter((v) => v != null && v !== '')
      .join(' ')
      .toLowerCase();
    // Only a gutter job if it matches a gutter keyword and isn't a roof type.
    if (this.metalKeywords.some((k) => haystack.includes(k))) return false;
    if (this.shingleKeywords.some((k) => haystack.includes(k))) return false;
    return this.gutterKeywords.some((k) => haystack.includes(k));
  }

  /** Count gutter jobs within a set (e.g. the forecast-filtered jobs). */
  countGutterJobs(jobs: JobNimbusJob[]): number {
    return jobs.filter((j) => this.isGutterJob(j)).length;
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

  /**
   * Raw (unweighted) roof squares for a job: prefer a Work Order value (passed
   * in via the squaresByJob map) and fall back to any on-job custom field.
   */
  rawSquaresForJob(job: JobNimbusJob, squaresByJob?: Map<string, number>): number {
    const fromWorkOrder = squaresByJob?.get(job.jnid) ?? 0;
    if (fromWorkOrder > 0) return fromWorkOrder;
    return this.extractRoofSquares(job);
  }

  /**
   * Forecast roof squares for a job, applying estimating-stage weighting:
   *   - Estimating (pre-sold): squares aren't measured yet, so assume the
   *     default roof size and weight it by the close rate
   *     (e.g. 30 SQS × 35% = 10.5 SQS expected).
   *   - Sold / in production: use the actual measured squares at full weight,
   *     falling back to the default size if none are recorded.
   *
   * The job's material ("What Material?") is read normally via classifyJobType,
   * so an estimating job still counts toward the correct shingle/metal bucket.
   */
  squaresForJob(job: JobNimbusJob, squaresByJob?: Map<string, number>): number {
    const raw = this.rawSquaresForJob(job, squaresByJob);
    if (this.isEstimating(job)) {
      const base = raw > 0 ? raw : this.estimatingDefaultSqs;
      return base * this.estimatingCloseRate;
    }
    return raw;
  }

  /** Revenue for a job, reading JobNimbus's real money fields in priority order. */
  revenueForJob(job: JobNimbusJob): number | undefined {
    const candidates = [
      job.approved_estimate_total,
      job.last_estimate,
      job.approved_invoice_total,
      job.total,
    ];
    for (const c of candidates) {
      const val = parseFloat(c);
      if (!Number.isNaN(val) && val > 0) return val;
    }
    return undefined;
  }

  aggregateRoofingSquares(jobs: JobNimbusJob[], squaresByJob?: Map<string, number>): RoofingSquaresSummary {
    let metal = 0;
    let shingles = 0;
    for (const job of jobs) {
      const sqs = this.squaresForJob(job, squaresByJob);
      const type = this.classifyJobType(job);
      if (type === 'metal') metal += sqs;
      else if (type === 'shingle') shingles += sqs;
    }
    return { metal, shingles };
  }

  mapJobData(job: JobNimbusJob, squaresByJob?: Map<string, number>): JobMapping {
    const type = this.classifyJobType(job);
    const sqs = this.squaresForJob(job, squaresByJob);
    return {
      jobId: job.jnid,
      installDate: this.formatDate(job.date_start || job.date_created),
      estimatedDuration: 5,
      crewSize: 3,
      crewType: type === 'metal' ? 'Metal Roof' : type === 'shingle' ? 'Shingles Roof' : undefined,
      squareFootage: sqs > 0 ? sqs : 30,
      revenue: this.revenueForJob(job),
      customerName: job.display_name || job.name || 'Unnamed Job',
      jobAddress: [job.address_line1, job.city, job.state_text].filter(Boolean).join(', '),
    };
  }

  /**
   * Sync JobNimbus jobs into the local `jobs` table (upsert by job_id).
   */
  async syncJobs(_userId: string): Promise<{ created: number; updated: number; total: number }> {
    const [jobsRaw, squaresByJob] = await Promise.all([
      this.fetchJobs(),
      this.fetchRoofSquaresByJob(),
    ]);
    const jobs = this.filterPipelineJobs(jobsRaw);
    let created = 0;
    let updated = 0;

    for (const job of jobs) {
      const mapped = this.mapJobData(job, squaresByJob);
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
