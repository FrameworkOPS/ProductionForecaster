/**
 * JobNimbus integration tests.
 *
 * These exercise the field-mapping logic (job-type classification, roof-squares
 * extraction, pipeline filtering, record mapping) against mock JobNimbus job
 * payloads, plus the sync upsert path against a mocked database. No network or
 * real Postgres is touched.
 */

// Mock the database layer so syncJobs can run without Postgres.
const mockQuery = jest.fn();
jest.mock('../config/database', () => ({
  query: (...args: any[]) => mockQuery(...args),
}));

import JobNimbusService, { JobNimbusJob } from '../services/jobNimbusService';

// Helper to build a service with a clean env for each scenario.
function makeService(env: Record<string, string | undefined> = {}): JobNimbusService {
  const keys = [
    'JOBNIMBUS_PIPELINE_STATUSES',
    'JOBNIMBUS_ROOF_SQUARES_FIELDS',
    'JOBNIMBUS_TYPE_FIELDS',
    'JOBNIMBUS_METAL_KEYWORDS',
    'JOBNIMBUS_SHINGLE_KEYWORDS',
    'JOBNIMBUS_ESTIMATING_STATUSES',
    'JOBNIMBUS_ESTIMATING_CLOSE_RATE',
    'JOBNIMBUS_ESTIMATING_DEFAULT_SQS',
    'JOBNIMBUS_API_BASE',
  ];
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return new JobNimbusService('test-api-key');
}

describe('JobNimbusService', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('classifyJobType (default keywords)', () => {
    const svc = makeService();

    it('detects metal from record_type_name', () => {
      expect(svc.classifyJobType({ jnid: '1', record_type_name: 'Metal Roof' })).toBe('metal');
    });

    it('detects shingle from status_name', () => {
      expect(svc.classifyJobType({ jnid: '2', status_name: 'Shingle Install' })).toBe('shingle');
    });

    it('returns null when no roofing keyword is present', () => {
      expect(svc.classifyJobType({ jnid: '3', record_type_name: 'Gutters', status_name: 'Lead' })).toBeNull();
    });

    it('prefers metal when both keywords appear', () => {
      expect(svc.classifyJobType({ jnid: '4', name: 'Metal and Shingle tearoff' })).toBe('metal');
    });
  });

  describe('classifyJobType (custom config)', () => {
    it('honors custom type fields and keywords', () => {
      const svc = makeService({
        JOBNIMBUS_TYPE_FIELDS: 'job_type_custom',
        JOBNIMBUS_METAL_KEYWORDS: 'standing seam,metal',
        JOBNIMBUS_SHINGLE_KEYWORDS: 'asphalt,comp',
      });
      // record_type_name is no longer inspected; only the custom field is.
      expect(svc.classifyJobType({ jnid: '5', record_type_name: 'Metal', job_type_custom: 'Asphalt Comp' })).toBe('shingle');
      expect(svc.classifyJobType({ jnid: '6', job_type_custom: 'Standing Seam' })).toBe('metal');
    });
  });

  describe('extractRoofSquares', () => {
    it('reads the default roof_squares field', () => {
      const svc = makeService();
      expect(svc.extractRoofSquares({ jnid: '1', roof_squares: '28.5' })).toBe(28.5);
    });

    it('tries fields in order and skips blanks/zeros', () => {
      const svc = makeService();
      expect(svc.extractRoofSquares({ jnid: '2', roof_squares: '', squares: '0', sqs: '12' })).toBe(12);
    });

    it('returns 0 when nothing parseable is present', () => {
      const svc = makeService();
      expect(svc.extractRoofSquares({ jnid: '3', notes: 'no squares here' })).toBe(0);
    });

    it('honors a custom field name from env', () => {
      const svc = makeService({ JOBNIMBUS_ROOF_SQUARES_FIELDS: 'cf_roof_sq' });
      expect(svc.extractRoofSquares({ jnid: '4', roof_squares: '99', cf_roof_sq: '40' })).toBe(40);
    });
  });

  describe('filterPipelineJobs', () => {
    const jobs: JobNimbusJob[] = [
      { jnid: '1', status_name: 'Contract Signed' },
      { jnid: '2', status_name: 'Lead' },
      { jnid: '3', status_name: 'Estimating' },
    ];

    it('returns all jobs when no statuses configured', () => {
      const svc = makeService();
      expect(svc.filterPipelineJobs(jobs)).toHaveLength(3);
    });

    it('filters to configured statuses, case-insensitively', () => {
      const svc = makeService({ JOBNIMBUS_PIPELINE_STATUSES: 'contract signed, estimating' });
      const result = svc.filterPipelineJobs(jobs).map((j) => j.jnid);
      expect(result).toEqual(['1', '3']);
    });
  });

  describe('aggregateRoofingSquares', () => {
    it('sums squares by inferred type', () => {
      const svc = makeService();
      const jobs: JobNimbusJob[] = [
        { jnid: '1', record_type_name: 'Metal Roof', roof_squares: '10' },
        { jnid: '2', record_type_name: 'Shingle Roof', roof_squares: '20' },
        { jnid: '3', record_type_name: 'Metal Roof', roof_squares: '5' },
        { jnid: '4', record_type_name: 'Gutters', roof_squares: '100' }, // ignored
      ];
      expect(svc.aggregateRoofingSquares(jobs)).toEqual({ metal: 15, shingles: 20 });
    });

    it('uses Work Order squares from the squaresByJob map over on-job values', () => {
      const svc = makeService();
      const jobs: JobNimbusJob[] = [
        { jnid: 'j1', record_type_name: 'Metal Roof', roof_squares: '1' },
      ];
      const byJob = new Map<string, number>([['j1', 42]]);
      expect(svc.aggregateRoofingSquares(jobs, byJob)).toEqual({ metal: 42, shingles: 0 });
    });
  });

  describe('Summit field defaults (What Material? / # Of SQS)', () => {
    const svc = makeService();

    it('classifies from the "What Material?" job field', () => {
      expect(svc.classifyJobType({ jnid: '1', 'What Material?': 'Asphalt Shingle' })).toBe('shingle');
      expect(svc.classifyJobType({ jnid: '2', 'What Material?': 'Standing Seam Metal' })).toBe('metal');
    });

    it('reads squares from the "# Of SQS" field', () => {
      expect(svc.extractRoofSquares({ jnid: '1', '# Of SQS': '27' })).toBe(27);
    });
  });

  describe('Work Orders → squares-by-job', () => {
    it('sums work-order squares onto the related job id', async () => {
      const svc = makeService();
      jest.spyOn(svc, 'fetchWorkOrders').mockResolvedValue([
        { jnid: 'wo1', '# Of SQS': '20', related: [{ id: 'job-a', type: 'job' }] },
        { jnid: 'wo2', '# Of SQS': '5', related: [{ id: 'job-a', type: 'job' }] },
        { jnid: 'wo3', '# Of SQS': '12', primary: { id: 'job-b', type: 'job' } },
        { jnid: 'wo4', '# Of SQS': '0', related: [{ id: 'job-c', type: 'job' }] }, // skipped
      ]);
      const map = await svc.fetchRoofSquaresByJob();
      expect(map.get('job-a')).toBe(25);
      expect(map.get('job-b')).toBe(12);
      expect(map.has('job-c')).toBe(false);
    });

    it('fails soft to an empty map when work orders error', async () => {
      const svc = makeService();
      jest.spyOn(svc, 'fetchWorkOrders').mockRejectedValue(new Error('boom'));
      const map = await svc.fetchRoofSquaresByJob();
      expect(map.size).toBe(0);
    });
  });

  describe('estimating-stage weighting', () => {
    it('weights estimating jobs by close rate against the default roof size', () => {
      const svc = makeService(); // defaults: estimating status, 0.35, 30 SQS
      const job: JobNimbusJob = { jnid: 'e1', status_name: 'Estimating', 'What Material?': 'Shingle' };
      // 30 default × 0.35 = 10.5
      expect(svc.squaresForJob(job)).toBeCloseTo(10.5);
    });

    it('weights estimating jobs against measured squares when present', () => {
      const svc = makeService();
      const job: JobNimbusJob = { jnid: 'e2', status_name: 'Estimating' };
      const byJob = new Map([['e2', 40]]);
      // 40 measured × 0.35 = 14
      expect(svc.squaresForJob(job, byJob)).toBeCloseTo(14);
    });

    it('does not weight sold jobs — uses full measured squares', () => {
      const svc = makeService();
      const job: JobNimbusJob = { jnid: 's1', status_name: 'Sold' };
      const byJob = new Map([['s1', 40]]);
      expect(svc.squaresForJob(job, byJob)).toBe(40);
    });

    it('honors custom close rate and default SQS from env', () => {
      const svc = makeService({
        JOBNIMBUS_ESTIMATING_STATUSES: 'quoting',
        JOBNIMBUS_ESTIMATING_CLOSE_RATE: '0.5',
        JOBNIMBUS_ESTIMATING_DEFAULT_SQS: '25',
      });
      const job: JobNimbusJob = { jnid: 'q1', status_name: 'Quoting' };
      // 25 × 0.5 = 12.5
      expect(svc.squaresForJob(job)).toBeCloseTo(12.5);
    });

    it('filterForecastJobs includes estimating jobs alongside pipeline statuses', () => {
      const svc = makeService({ JOBNIMBUS_PIPELINE_STATUSES: 'Sold,In Production' });
      const jobs: JobNimbusJob[] = [
        { jnid: '1', status_name: 'Sold' },
        { jnid: '2', status_name: 'Estimating' },
        { jnid: '3', status_name: 'Lead' },
        { jnid: '4', status_name: 'In Production' },
      ];
      const ids = svc.filterForecastJobs(jobs).map((j) => j.jnid).sort();
      expect(ids).toEqual(['1', '2', '4']);
    });
  });

  describe('mapJobData', () => {
    const svc = makeService();

    it('maps a metal job with squares and revenue', () => {
      const job: JobNimbusJob = {
        jnid: 'abc123',
        display_name: 'Smith Residence',
        record_type_name: 'Metal Roof',
        roof_squares: '32',
        total: '15000',
        date_start: 1748563200, // epoch seconds
        address_line1: '1 Main St',
        city: 'Quincy',
        state_text: 'MA',
      };
      const m = svc.mapJobData(job);
      expect(m.jobId).toBe('abc123');
      expect(m.crewType).toBe('Metal Roof');
      expect(m.squareFootage).toBe(32);
      expect(m.revenue).toBe(15000);
      expect(m.customerName).toBe('Smith Residence');
      expect(m.jobAddress).toBe('1 Main St, Quincy, MA');
      expect(m.installDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('falls back to 30 SQ default when squares are missing', () => {
      const m = svc.mapJobData({ jnid: 'x', record_type_name: 'Shingle Roof' });
      expect(m.squareFootage).toBe(30);
      expect(m.crewType).toBe('Shingles Roof');
    });
  });

  describe('syncJobs (mocked DB)', () => {
    it('inserts new jobs and updates existing ones', async () => {
      const svc = makeService();

      // Stub fetchJobs so no network call happens.
      const jobs: JobNimbusJob[] = [
        { jnid: 'new-1', record_type_name: 'Metal Roof', roof_squares: '20', status_name: 'Contract Signed' },
        { jnid: 'existing-1', record_type_name: 'Shingle Roof', roof_squares: '15', status_name: 'Contract Signed' },
      ];
      jest.spyOn(svc, 'fetchJobs').mockResolvedValue(jobs);
      jest.spyOn(svc, 'fetchWorkOrders').mockResolvedValue([]);

      // First job: SELECT returns empty (insert). Second: SELECT returns a row (update).
      mockQuery.mockImplementation((sql: string) => {
        if (sql.trim().startsWith('SELECT')) {
          // Return a row only for the existing job lookup (2nd SELECT).
          const callCount = mockQuery.mock.calls.filter((c: any[]) => String(c[0]).trim().startsWith('SELECT')).length;
          return Promise.resolve({ rows: callCount === 2 ? [{ id: 'row-id' }] : [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await svc.syncJobs('user-1');
      expect(result).toEqual({ created: 1, updated: 1, total: 2 });

      const insertCalled = mockQuery.mock.calls.some((c: any[]) => String(c[0]).includes('INSERT INTO jobs'));
      const updateCalled = mockQuery.mock.calls.some((c: any[]) => String(c[0]).includes('UPDATE jobs SET'));
      expect(insertCalled).toBe(true);
      expect(updateCalled).toBe(true);
    });

    it('respects the pipeline status filter before syncing', async () => {
      const svc = makeService({ JOBNIMBUS_PIPELINE_STATUSES: 'Contract Signed' });
      jest.spyOn(svc, 'fetchJobs').mockResolvedValue([
        { jnid: 'a', status_name: 'Contract Signed', record_type_name: 'Metal Roof' },
        { jnid: 'b', status_name: 'Lead', record_type_name: 'Metal Roof' },
      ]);
      jest.spyOn(svc, 'fetchWorkOrders').mockResolvedValue([]);
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await svc.syncJobs('user-1');
      expect(result.total).toBe(1); // only the Contract Signed job
      expect(result.created).toBe(1);
    });
  });
});
