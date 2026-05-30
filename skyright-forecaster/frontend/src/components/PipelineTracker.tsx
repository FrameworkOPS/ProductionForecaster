import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { API_BASE_URL } from '../utils/apiConfig';

interface PipelineItem {
  id: string;
  job_type: string;
  square_footage: number;
  estimated_days_to_completion: number;
  revenue_per_sq: number;
  total_revenue: number;
  status: string;
  added_date: string;
  target_start_date: string | null;
  notes: string | null;
  is_active: boolean;
}

interface Crew {
  id: string;
  crew_name: string;
  crew_type: string;
  weekly_sq_capacity: number | null;
}

interface PipelineSummary {
  shingles?: { totalSQs: number; jobCount: number };
  metal?: { totalSQs: number; jobCount: number };
  combined?: { totalSQs: number; jobCount: number };
}

interface JobNimbusSQs {
  shingles: number;
  metal: number;
}

const MANUAL_NOTE = 'Manual pipeline input';

export default function PipelineTracker() {
  const { token } = useAuthStore();
  const [summary, setSummary] = useState<PipelineSummary | null>(null);
  const [jobNimbusSQs, setJobNimbusSQs] = useState<JobNimbusSQs | null>(null);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [showPipelineForm, setShowPipelineForm] = useState(false);
  const [pipelineData, setPipelineData] = useState({ shinglesSQS: '', metalSQS: '' });

  useEffect(() => {
    loadSummary();
    loadCrews();
    loadJobNimbusSQs();
  }, []);

  // ─── Data loaders ──────────────────────────────────────────────────────────

  const loadCrews = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/crews?active=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setCrews(data.data || []);
      }
    } catch (err) {
      console.error('Error loading crews:', err);
    }
  };

  const loadSummary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/pipeline/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const summaryData = data.data || {};
        const byType: any[] = summaryData.byType || [];
        const shinglesRow = byType.find((r: any) => r.job_type === 'shingle');
        const metalRow = byType.find((r: any) => r.job_type === 'metal');
        const combined = summaryData.combined || {};
        setSummary({
          shingles: shinglesRow
            ? { totalSQs: shinglesRow.total_sqs, jobCount: shinglesRow.job_count }
            : undefined,
          metal: metalRow
            ? { totalSQs: metalRow.total_sqs, jobCount: metalRow.job_count }
            : undefined,
          combined: { totalSQs: combined.total_sqs || 0, jobCount: combined.job_count || 0 },
        });
      }
    } catch (err) {
      console.error('Error loading summary:', err);
    } finally {
      setLoading(false);
    }
  };

  /** Pull live roofing SQs from the JobNimbus pipeline. */
  const loadJobNimbusSQs = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/jobnimbus/pipeline-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const sqs = data.data?.roofingSquares;
        if (sqs) setJobNimbusSQs({ shingles: sqs.shingles ?? 0, metal: sqs.metal ?? 0 });
      }
    } catch {
      // JobNimbus may not be configured — fail silently
    }
  };

  // ─── Pipeline form ─────────────────────────────────────────────────────────

  const handleSavePipeline = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPipeline(true);
    setPipelineError(null);

    const today = new Date().toISOString().split('T')[0];

    try {
      const listRes = await fetch(`${API_BASE_URL}/api/pipeline?activeOnly=true&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listData = listRes.ok ? await listRes.json() : { data: [] };
      const existingItems: PipelineItem[] = listData.data || [];

      const manualShingle = existingItems.find(
        (item) => item.job_type === 'shingle' && item.notes === MANUAL_NOTE
      );
      const manualMetal = existingItems.find(
        (item) => item.job_type === 'metal' && item.notes === MANUAL_NOTE
      );

      const saves: Promise<Response>[] = [];

      const shingleSQs = parseFloat(pipelineData.shinglesSQS);
      if (!isNaN(shingleSQs) && shingleSQs > 0) {
        saves.push(
          manualShingle
            ? fetch(`${API_BASE_URL}/api/pipeline/${manualShingle.id}`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ squareFootage: shingleSQs, revenuePerSq: 600 }),
              })
            : fetch(`${API_BASE_URL}/api/pipeline`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobType: 'shingle',
                  squareFootage: shingleSQs,
                  estimatedDaysToCompletion: 5,
                  revenuePerSq: 600,
                  addedDate: today,
                  notes: MANUAL_NOTE,
                }),
              })
        );
      }

      const metalSQs = parseFloat(pipelineData.metalSQS);
      if (!isNaN(metalSQs) && metalSQs > 0) {
        saves.push(
          manualMetal
            ? fetch(`${API_BASE_URL}/api/pipeline/${manualMetal.id}`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ squareFootage: metalSQs, revenuePerSq: 1000 }),
              })
            : fetch(`${API_BASE_URL}/api/pipeline`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobType: 'metal',
                  squareFootage: metalSQs,
                  estimatedDaysToCompletion: 7,
                  revenuePerSq: 1000,
                  addedDate: today,
                  notes: MANUAL_NOTE,
                }),
              })
        );
      }

      if (saves.length === 0) {
        setPipelineError('Please enter at least one SQ value greater than 0');
        return;
      }

      const results = await Promise.all(saves);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const errData = await failed.json().catch(() => ({}));
        setPipelineError(
          errData.error || errData.message || `Failed to save pipeline (${failed.status})`
        );
      } else {
        setShowPipelineForm(false);
        setPipelineData({ shinglesSQS: '', metalSQS: '' });
        loadSummary();
      }
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : 'An error occurred while saving');
    } finally {
      setSavingPipeline(false);
    }
  };

  // ─── Crew helpers ──────────────────────────────────────────────────────────

  /** Normalize crew_type strings to 'shingle' or 'metal' for grouping. */
  const normalizeType = (crewType: string): 'shingle' | 'metal' | 'other' => {
    const t = crewType.toLowerCase();
    if (t.includes('metal')) return 'metal';
    if (t.includes('shingle') || t.includes('shingles')) return 'shingle';
    return 'other';
  };

  /** Effective weekly capacity for a single crew — falls back to type-based default
   *  (200 shingle / 100 metal) when weekly_sq_capacity hasn't been explicitly saved. */
  const effectiveCapacity = (crew: Crew): number => {
    if (crew.weekly_sq_capacity != null) return crew.weekly_sq_capacity;
    return normalizeType(crew.crew_type) === 'metal' ? 100 : 200;
  };

  const totalCapacity = (type: 'shingle' | 'metal'): number =>
    crews
      .filter((c) => normalizeType(c.crew_type) === type)
      .reduce((sum, c) => sum + effectiveCapacity(c), 0);

  const shingleCapacity = totalCapacity('shingle');
  const metalCapacity = totalCapacity('metal');

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Pipeline Tracker</h2>
        <button
          onClick={async () => {
            if (showPipelineForm) {
              setShowPipelineForm(false);
              setPipelineError(null);
            } else {
              try {
                const res = await fetch(`${API_BASE_URL}/api/pipeline?activeOnly=true&limit=200`, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  const data = await res.json();
                  const items: PipelineItem[] = data.data || [];
                  const shingle = items.find(
                    (i) => i.job_type === 'shingle' && i.notes === MANUAL_NOTE
                  );
                  const metal = items.find(
                    (i) => i.job_type === 'metal' && i.notes === MANUAL_NOTE
                  );
                  setPipelineData({
                    shinglesSQS: shingle ? String(shingle.square_footage) : '',
                    metalSQS: metal ? String(metal.square_footage) : '',
                  });
                }
              } catch {
                setPipelineData({ shinglesSQS: '', metalSQS: '' });
              }
              setShowPipelineForm(true);
            }
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          {showPipelineForm ? 'Cancel' : 'Update Pipeline'}
        </button>
      </div>

      {/* ── JobNimbus Pipeline (live) ──────────────────────────────────────── */}
      {jobNimbusSQs && (jobNimbusSQs.shingles > 0 || jobNimbusSQs.metal > 0) && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            JobNimbus Pipeline — Live SQs by Type
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-cyan-50 p-4 rounded-lg border border-cyan-200">
              <p className="text-sm font-medium text-cyan-600">Shingle SQs</p>
              <p className="text-2xl font-bold text-cyan-900">
                {jobNimbusSQs.shingles.toFixed(0)}
              </p>
              <p className="text-xs text-cyan-700">from JobNimbus pipeline</p>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <p className="text-sm font-medium text-orange-600">Metal SQs</p>
              <p className="text-2xl font-bold text-orange-900">
                {jobNimbusSQs.metal.toFixed(0)}
              </p>
              <p className="text-xs text-orange-700">from JobNimbus pipeline</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <p className="text-sm font-medium text-gray-600">Total SQs</p>
              <p className="text-2xl font-bold text-gray-900">
                {(jobNimbusSQs.shingles + jobNimbusSQs.metal).toFixed(0)}
              </p>
              <p className="text-xs text-gray-500">shingle + metal</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual pipeline summary ────────────────────────────────────────── */}
      {summary && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Manual Pipeline Entry
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {summary.shingles && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <p className="text-sm font-medium text-blue-600">Shingle Pipeline</p>
                <p className="text-2xl font-bold text-blue-900">
                  {summary.shingles.totalSQs?.toFixed(0) || 0} SQs
                </p>
                <p className="text-xs text-blue-700">{summary.shingles.jobCount || 0} entries</p>
              </div>
            )}
            {summary.metal && (
              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <p className="text-sm font-medium text-red-600">Metal Pipeline</p>
                <p className="text-2xl font-bold text-red-900">
                  {summary.metal.totalSQs?.toFixed(0) || 0} SQs
                </p>
                <p className="text-xs text-red-700">{summary.metal.jobCount || 0} entries</p>
              </div>
            )}
            {summary.combined && (
              <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                <p className="text-sm font-medium text-purple-600">Total Pipeline</p>
                <p className="text-2xl font-bold text-purple-900">
                  {(summary.combined.totalSQs || 0).toFixed(0)} SQs
                </p>
                <p className="text-xs text-purple-700">
                  {summary.combined.jobCount || 0} total entries
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Pipeline input form ────────────────────────────────────────────── */}
      {showPipelineForm && (
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow">
          <h3 className="text-lg font-semibold mb-2">Update Pipeline Inventory</h3>
          <p className="text-xs text-gray-500 mb-4">
            Set the current SQ counts. Saving will update existing manual entries or create new
            ones.
          </p>
          {pipelineError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 flex justify-between items-start">
              <p className="text-sm text-red-700">{pipelineError}</p>
              <button
                onClick={() => setPipelineError(null)}
                className="text-red-500 hover:text-red-700 ml-2 text-xs underline"
              >
                Dismiss
              </button>
            </div>
          )}
          <form onSubmit={handleSavePipeline} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SQs of Shingles
                </label>
                <input
                  type="number"
                  value={pipelineData.shinglesSQS}
                  onChange={(e) =>
                    setPipelineData({ ...pipelineData, shinglesSQS: e.target.value })
                  }
                  placeholder="e.g., 5000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SQs of Metal
                </label>
                <input
                  type="number"
                  value={pipelineData.metalSQS}
                  onChange={(e) =>
                    setPipelineData({ ...pipelineData, metalSQS: e.target.value })
                  }
                  placeholder="e.g., 3000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowPipelineForm(false);
                  setPipelineError(null);
                  setPipelineData({ shinglesSQS: '', metalSQS: '' });
                }}
                className="px-4 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPipeline}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {savingPipeline ? 'Saving…' : 'Update Pipeline'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Crew Capacity (read-only, sourced from Crews tab) ─────────────── */}
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Crew Capacity</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Manage crew names and weekly SQ capacity in the <strong>Crews</strong> tab.
            </p>
          </div>
          <button
            onClick={loadCrews}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 border border-gray-300"
          >
            Refresh
          </button>
        </div>

        {/* Capacity totals */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-blue-50 p-3 rounded border border-blue-200">
            <p className="text-xs text-blue-600 font-medium">Total Shingle Capacity</p>
            <p className="text-xl font-bold text-blue-900">
              {shingleCapacity > 0 ? `${shingleCapacity.toFixed(0)} SQs/wk` : '—'}
            </p>
          </div>
          <div className="bg-red-50 p-3 rounded border border-red-200">
            <p className="text-xs text-red-600 font-medium">Total Metal Capacity</p>
            <p className="text-xl font-bold text-red-900">
              {metalCapacity > 0 ? `${metalCapacity.toFixed(0)} SQs/wk` : '—'}
            </p>
          </div>
        </div>

        {crews.length === 0 ? (
          <p className="text-center py-6 text-gray-500">No active crews found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Crew Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                    SQs / Week
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {crews.map((crew) => {
                  const type = normalizeType(crew.crew_type);
                  return (
                    <tr key={crew.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                        {crew.crew_name || '—'}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            type === 'shingle'
                              ? 'bg-blue-100 text-blue-800'
                              : type === 'metal'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {crew.crew_type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {effectiveCapacity(crew).toFixed(0)} SQs
                        {crew.weekly_sq_capacity == null && (
                          <span className="ml-1 text-xs text-gray-400 italic">(default)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
