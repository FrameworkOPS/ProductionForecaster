import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../utils/apiConfig';
import { useAuthStore } from '../store/authStore';
import { CLOSING_RATE, REVENUE_PER_SQ } from '../constants/businessConstants';

interface JobNimbusDeal {
  jobnimbus_id: string;
  dealname: string;
  job_type: 'shingle' | 'metal';
  roof_sqs: number;
  using_default_sqs: boolean;
  gross_value: number;
  weighted_value: number;
  estimated_sqs: number;
}

interface RoofingSquares {
  metal: number;
  shingles: number;
}

// ─── Date helpers (mirror SalesForecastInput) ──────────────────────────────

const getMonday = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d;
};

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getForecastWeeks = (): string[] => {
  const weeks: string[] = [];
  let current = getMonday(new Date());
  const end = new Date(current);
  end.setDate(end.getDate() + 182);
  while (current <= end) {
    weeks.push(formatDate(new Date(current)));
    current.setDate(current.getDate() + 7);
  }
  return weeks;
};

// ──────────────────────────────────────────────────────────────────────────

export default function JobNimbusPipelineDisplay() {
  const { token } = useAuthStore();
  const [deals, setDeals] = useState<JobNimbusDeal[]>([]);
  const [roofingSquares, setRoofingSquares] = useState<RoofingSquares | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'all' | 'shingle' | 'metal'>('all');

  useEffect(() => {
    loadPipeline();
  }, []);

  const loadPipeline = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/jobnimbus/pipeline-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        setError(
          res.status === 401
            ? 'JobNimbus not connected. Set JOBNIMBUS_API_KEY on the backend.'
            : 'Failed to load JobNimbus pipeline'
        );
        return;
      }

      const data = await res.json();
      setDeals(data.data?.deals || []);
      setRoofingSquares(data.data?.roofingSquares ?? null);
    } catch (err) {
      setError('Error loading JobNimbus pipeline');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ─── Push helper ───────────────────────────────────────────────────────────

  const PUSH_WEEKS = 8; // only push into the nearest 8 weeks

  const fetchExistingForecasts = async (
    weeks: string[]
  ): Promise<Map<string, { shingle: number; metal: number }>> => {
    const map = new Map<string, { shingle: number; metal: number }>();
    weeks.forEach((w) => map.set(w, { shingle: 0, metal: 0 }));
    try {
      const params = new URLSearchParams({
        startWeek: weeks[0],
        endWeek: weeks[weeks.length - 1],
        limit: '200',
      });
      const res = await fetch(`${API_BASE_URL}/api/sales-forecast?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        (data.data || []).forEach((row: any) => {
          const w = row.forecast_week.substring(0, 10);
          const entry = map.get(w);
          if (entry) {
            if (row.job_type === 'shingle') entry.shingle = row.projected_square_footage || 0;
            if (row.job_type === 'metal') entry.metal = row.projected_square_footage || 0;
          }
        });
      }
    } catch (err) {
      console.warn('Could not fetch existing forecasts, will add to 0:', err);
    }
    return map;
  };

  const postForecastValue = (week: string, jobType: string, sqs: number, notes: string) =>
    fetch(`${API_BASE_URL}/api/sales-forecast`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forecastWeek: week,
        jobType,
        projectedSquareFootage: Math.round(sqs),
        projectedJobCount: 0,
        notes,
      }),
    });

  const handlePushToSalesForecast = async () => {
    const shingleTotal = deals
      .filter((d) => d.job_type === 'shingle')
      .reduce((s, d) => s + d.estimated_sqs, 0);
    const metalTotal = deals
      .filter((d) => d.job_type === 'metal')
      .reduce((s, d) => s + d.estimated_sqs, 0);

    if (shingleTotal === 0 && metalTotal === 0) {
      alert('No weighted SQs to push — no jobs in pipeline.');
      return;
    }

    const weeks = getForecastWeeks().slice(0, PUSH_WEEKS);
    const weeklyShingle = shingleTotal / weeks.length;
    const weeklyMetal = metalTotal / weeks.length;

    const confirmed = window.confirm(
      `Push weighted JobNimbus pipeline to Sales Forecast?\n\n` +
        `Shingle: ${shingleTotal.toFixed(0)} total SQs → +${Math.round(weeklyShingle)} SQs/week\n` +
        `Metal:   ${metalTotal.toFixed(0)} total SQs → +${Math.round(weeklyMetal)} SQs/week\n\n` +
        `Added on top of existing values across the next ${weeks.length} weeks.`
    );
    if (!confirmed) return;

    setPushing(true);
    try {
      const existing = await fetchExistingForecasts(weeks);
      const posts: Promise<Response>[] = [];

      weeks.forEach((w) => {
        const cur = existing.get(w) || { shingle: 0, metal: 0 };
        if (weeklyShingle > 0) {
          posts.push(postForecastValue(w, 'shingle', cur.shingle + weeklyShingle, 'JobNimbus weighted pipeline'));
        }
        if (weeklyMetal > 0) {
          posts.push(postForecastValue(w, 'metal', cur.metal + weeklyMetal, 'JobNimbus weighted pipeline'));
        }
      });

      await Promise.all(posts);
      alert(`Done! Added pipeline SQs to the next ${weeks.length} weeks. Refresh the Sales Forecast table to see the changes.`);
    } catch (err) {
      console.error('Error pushing to sales forecast:', err);
      alert('Failed to push to sales forecast. Check console for details.');
    } finally {
      setPushing(false);
    }
  };

  const handleAssignType = (jobnimbusId: string, newType: 'shingle' | 'metal') => {
    setDeals(
      deals.map((d) =>
        d.jobnimbus_id === jobnimbusId
          ? {
              ...d,
              job_type: newType,
              gross_value: d.roof_sqs * (newType === 'metal' ? REVENUE_PER_SQ.metal : REVENUE_PER_SQ.shingles),
              weighted_value:
                d.roof_sqs * (newType === 'metal' ? REVENUE_PER_SQ.metal : REVENUE_PER_SQ.shingles) * CLOSING_RATE,
              estimated_sqs: d.roof_sqs * CLOSING_RATE,
            }
          : d
      )
    );
  };

  if (error) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
        <p className="text-yellow-800">{error}</p>
        <button
          onClick={loadPipeline}
          className="mt-2 px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  const filteredDeals =
    selectedType === 'all' ? deals : deals.filter((d) => d.job_type === selectedType);

  const totalWeightedValue = filteredDeals.reduce((s, d) => s + d.weighted_value, 0);
  const totalWeightedSqs = filteredDeals.reduce((s, d) => s + d.estimated_sqs, 0);

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-bold text-gray-900">JobNimbus Pipeline</h3>
        <div className="flex gap-2">
          <button
            onClick={handlePushToSalesForecast}
            disabled={pushing || loading || deals.length === 0}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            {pushing ? 'Pushing…' : '↓ Push to Sales Forecast'}
          </button>
          <button
            onClick={loadPipeline}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Deal summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="bg-blue-50 p-4 rounded border border-blue-200">
          <p className="text-sm text-blue-600 font-medium">Jobs</p>
          <p className="text-2xl font-bold text-blue-900">{filteredDeals.length}</p>
        </div>
        <div className="bg-green-50 p-4 rounded border border-green-200">
          <p className="text-sm text-green-600 font-medium">Weighted Value</p>
          <p className="text-2xl font-bold text-green-900">
            ${((totalWeightedValue ?? 0) / 1000).toFixed(1)}K
          </p>
        </div>
        <div className="bg-purple-50 p-4 rounded border border-purple-200">
          <p className="text-sm text-purple-600 font-medium">Projected SQs</p>
          <p className="text-2xl font-bold text-purple-900">{(totalWeightedSqs ?? 0).toFixed(0)}</p>
        </div>
      </div>

      {/* Roofing SQs across pipeline */}
      {roofingSquares && (roofingSquares.metal > 0 || roofingSquares.shingles > 0) && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Pipeline — Roofing SQs by Type
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-cyan-50 p-3 rounded border border-cyan-200">
              <p className="text-xs text-cyan-600 font-medium">Shingle SQs</p>
              <p className="text-xl font-bold text-cyan-900">{roofingSquares.shingles.toFixed(0)}</p>
            </div>
            <div className="bg-orange-50 p-3 rounded border border-orange-200">
              <p className="text-xs text-orange-600 font-medium">Metal SQs</p>
              <p className="text-xl font-bold text-orange-900">{roofingSquares.metal.toFixed(0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Type filter */}
      <div className="mb-4 flex gap-2">
        {(['all', 'shingle', 'metal'] as const).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            className={`px-4 py-2 rounded font-medium text-sm ${
              selectedType === type
                ? type === 'all'
                  ? 'bg-gray-600 text-white'
                  : type === 'shingle'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-pink-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {type === 'all' ? 'All Types' : type === 'shingle' ? 'Shingles' : 'Metal'}
          </button>
        ))}
      </div>

      {/* Deals table */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading JobNimbus jobs…</div>
      ) : filteredDeals.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No jobs in pipeline</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Job Name</th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">Job Type</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">Roof SQs</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">Gross Value</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">Weighted Value (×40%)</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">Est. SQs (×40%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredDeals.map((deal) => (
                <tr key={deal.jobnimbus_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900 font-medium">{deal.dealname}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        deal.job_type === 'shingle'
                          ? 'bg-cyan-100 text-cyan-800'
                          : 'bg-pink-100 text-pink-800'
                      }`}
                    >
                      {deal.job_type === 'shingle' ? 'Shingle' : 'Metal'}
                    </span>
                    <button
                      onClick={() =>
                        handleAssignType(
                          deal.jobnimbus_id,
                          deal.job_type === 'shingle' ? 'metal' : 'shingle'
                        )
                      }
                      className="ml-2 text-xs text-gray-400 hover:text-gray-600 underline"
                      title="Toggle job type"
                    >
                      switch
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    {deal.roof_sqs}
                    {deal.using_default_sqs && (
                      <span
                        className="ml-1 text-xs text-gray-400 italic"
                        title="No roof squares in JobNimbus yet — using 30 SQ default"
                      >
                        est.
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    ${(deal.gross_value ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900 font-medium">
                    ${(deal.weighted_value ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-900">
                    {(deal.estimated_sqs ?? 0).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-500">
        Roof SQs: actual value from JobNimbus, or <strong>30 SQ default</strong> until it's entered (<em>est.</em> label).{' '}
        Gross Value = Roof SQs × per-SQ price (Shingle ${REVENUE_PER_SQ.shingles}/SQ · Metal ${REVENUE_PER_SQ.metal}/SQ).{' '}
        Weighted Value = Gross Value × {(CLOSING_RATE * 100).toFixed(0)}% closing rate.{' '}
        Est. SQs = Roof SQs × {(CLOSING_RATE * 100).toFixed(0)}%.{' '}
        <strong>Push to Sales Forecast</strong> distributes estimated SQs evenly across the nearest 8 weeks.
      </div>
    </div>
  );
}
