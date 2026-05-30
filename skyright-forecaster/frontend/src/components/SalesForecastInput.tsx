import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store/authStore';
import { API_BASE_URL } from '../utils/apiConfig';
import JobNimbusPipelineDisplay from './JobNimbusPipelineDisplay';

interface SalesForecast {
  forecast_week: string;
  job_type: string;
  projected_square_footage: number;
  projected_job_count?: number;
  notes?: string;
}

// ─── CellInput must live OUTSIDE SalesForecastInput so React never sees a
//     new component type on re-render. Defining it inside caused constant
//     unmount/remount cycles that broke autoFocus, typing, and all buttons.
interface CellInputProps {
  week: string;
  jobType: 'shingle' | 'metal';
  isEditing: boolean;
  value: number;
  formSqs: string;
  onFormChange: (sqs: string) => void;
  onStartEditing: () => void;
  onSave: () => void;
  onCancel: () => void;
}

const CellInput = React.memo(function CellInput({
  isEditing,
  value,
  formSqs,
  onFormChange,
  onStartEditing,
  onSave,
  onCancel,
}: CellInputProps) {
  if (isEditing) {
    return (
      <div className="space-y-2">
        <input
          type="number"
          value={formSqs}
          onChange={(e) => onFormChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
            if (e.key === 'Escape') onCancel();
          }}
          className="w-full px-2 py-1 border border-gray-300 rounded"
          placeholder="SQs"
          autoFocus
        />
        <div className="flex gap-1">
          <button
            onClick={onSave}
            className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700"
          >
            Save
          </button>
          <button
            onClick={onCancel}
            className="px-2 py-1 bg-gray-300 text-gray-800 text-xs rounded hover:bg-gray-400"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onStartEditing}
      className="cursor-pointer hover:bg-gray-100 px-2 py-1 rounded min-h-[28px]"
    >
      {value > 0 ? value.toFixed(0) : <span className="text-gray-300">—</span>}
    </div>
  );
});

// ─── Date helpers ──────────────────────────────────────────────────────────

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

const getDateRange = () => {
  const start = getMonday(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 182);
  return { start: formatDate(start), end: formatDate(end) };
};

const getWeeks = (): string[] => {
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

const isCurrentWeek = (week: string): boolean => {
  const daysDiff =
    (new Date().getTime() - new Date(week + 'T00:00:00').getTime()) /
    (1000 * 60 * 60 * 24);
  return daysDiff >= 0 && daysDiff < 7;
};

// ──────────────────────────────────────────────────────────────────────────

export default function SalesForecastInput() {
  const { token } = useAuthStore();
  const [forecasts, setForecasts] = useState<SalesForecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingWeek, setEditingWeek] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editingSqs, setEditingSqs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyingAll, setCopyingAll] = useState<'shingle' | 'metal' | null>(null);

  useEffect(() => {
    loadForecasts();
  }, []);

  const getValue = useCallback(
    (week: string, jobType: string): number => {
      const item = forecasts.find(
        (f) => f.forecast_week.substring(0, 10) === week && f.job_type === jobType
      );
      return item?.projected_square_footage || 0;
    },
    [forecasts]
  );

  // ─── API calls ─────────────────────────────────────────────────────────────

  const loadForecasts = async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      const params = new URLSearchParams({ startWeek: start, endWeek: end });
      const res = await fetch(`${API_BASE_URL}/api/sales-forecast?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setForecasts(data.data || []);
      }
    } catch (err) {
      console.error('Error loading forecasts:', err);
    } finally {
      setLoading(false);
    }
  };

  const postForecast = async (week: string, jobType: string, sqs: number, notes?: string | null) => {
    const res = await fetch(`${API_BASE_URL}/api/sales-forecast`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forecastWeek: week,
        jobType,
        projectedSquareFootage: sqs,
        projectedJobCount: 0,
        notes: notes ?? null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Save failed (${res.status}) for ${jobType} week ${week}`);
    }
    return res;
  };

  const handleSave = async (week: string, jobType: string) => {
    setError(null);
    const sqValue = parseFloat(editingSqs);
    if (!editingSqs || isNaN(sqValue) || sqValue < 0) {
      setError('Please enter a valid square footage value (0 or more)');
      return;
    }
    try {
      const res = await postForecast(week, jobType, sqValue);
      const responseData = await res.json();
      if (res.ok) {
        setEditingWeek(null);
        setEditingType(null);
        setEditingSqs('');
        await loadForecasts();
      } else {
        setError(responseData.message || `Failed to save forecast (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while saving');
    }
  };

  const handleCopyPreviousWeek = async (fromWeek: string, toWeek: string, jobType: string) => {
    const sourceValue = getValue(fromWeek, jobType);
    if (sourceValue <= 0) {
      setError(`No value in the previous week to copy for ${jobType === 'shingle' ? 'Shingle' : 'Metal'}.`);
      return;
    }
    try {
      const res = await postForecast(toWeek, jobType, sourceValue);
      if (res.ok) {
        await loadForecasts();
      } else {
        setError('Failed to copy week value.');
      }
    } catch (err) {
      console.error('Error copying week:', err);
      setError('Error copying week value.');
    }
  };

  /**
   * Forward-fill: find the FIRST week that has a value, then write that
   * same value to every week after it — overwriting anything already there.
   * This lets you edit week 1, click Copy All, and have all 26 weeks update.
   */
  const handleCopyAllWeeks = async (jobType: 'shingle' | 'metal') => {
    setError(null);
    const currentWeeks = getWeeks();
    const label = jobType === 'shingle' ? 'Shingle' : 'Metal';

    // Snapshot forecasts at click time so getValue is stable
    const snapshot = forecasts;
    const snapGet = (week: string) =>
      snapshot.find(
        (f) => f.forecast_week.substring(0, 10) === week && f.job_type === jobType
      )?.projected_square_footage || 0;

    // Use the FIRST non-zero week as the source value
    const firstFilledIndex = currentWeeks.findIndex((w) => snapGet(w) > 0);

    if (firstFilledIndex === -1) {
      setError(`No ${label} values found. Enter at least one week first.`);
      return;
    }

    const sourceValue = snapGet(currentWeeks[firstFilledIndex]);
    // All weeks after the first filled one get overwritten
    const weeksToCopy = currentWeeks.slice(firstFilledIndex + 1);

    if (weeksToCopy.length === 0) {
      setError(`${label}: only one week in the table — nothing to copy to.`);
      return;
    }

    setCopyingAll(jobType);
    try {
      for (const w of weeksToCopy) {
        await postForecast(w, jobType, sourceValue);
      }
      await loadForecasts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error copying weeks. Please try again.');
      console.error('Copy all error:', err);
    } finally {
      setCopyingAll(null);
    }
  };

  const startEditing = (week: string, jobType: string) => {
    const existing = forecasts.find(
      (f) => f.forecast_week.substring(0, 10) === week && f.job_type === jobType
    );
    setEditingSqs(existing?.projected_square_footage.toString() || '');
    setEditingWeek(week);
    setEditingType(jobType);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingWeek(null);
    setEditingType(null);
    setEditingSqs('');
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const weeks = getWeeks();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Sales Forecast</h2>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="text-sm">{error}</p>
          <button
            onClick={() => setError(null)}
            className="text-xs mt-2 text-red-600 hover:text-red-800 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* JobNimbus Pipeline — weighted jobs + push-to-forecast button */}
      <JobNimbusPipelineDisplay />

      {/* 6-Month Forecast Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        {loading ? (
          <div className="px-6 py-4 text-center text-gray-500">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Week</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  <div className="flex items-center gap-2">
                    Shingle SQs
                    <button
                      onClick={() => handleCopyAllWeeks('shingle')}
                      disabled={copyingAll === 'shingle'}
                      title="Forward-fill all remaining empty weeks from the last entered shingle value"
                      className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 font-normal disabled:opacity-50"
                    >
                      {copyingAll === 'shingle' ? 'Copying…' : 'Copy All ↓'}
                    </button>
                  </div>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">
                  <div className="flex items-center gap-2">
                    Metal SQs
                    <button
                      onClick={() => handleCopyAllWeeks('metal')}
                      disabled={copyingAll === 'metal'}
                      title="Forward-fill all remaining empty weeks from the last entered metal value"
                      className="px-2 py-0.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 font-normal disabled:opacity-50"
                    >
                      {copyingAll === 'metal' ? 'Copying…' : 'Copy All ↓'}
                    </button>
                  </div>
                </th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Total SQs</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">Copy from Prev</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {weeks.map((week, idx) => {
                const shingleValue = getValue(week, 'shingle');
                const metalValue = getValue(week, 'metal');
                const totalValue = shingleValue + metalValue;
                const isCurrent = isCurrentWeek(week);
                const prevWeek = idx > 0 ? weeks[idx - 1] : null;

                return (
                  <tr key={week} className={isCurrent ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">
                      {new Date(week + 'T00:00:00').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: '2-digit',
                      })}
                      {isCurrent && (
                        <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">
                          Current
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <CellInput
                        week={week}
                        jobType="shingle"
                        isEditing={editingWeek === week && editingType === 'shingle'}
                        value={shingleValue}
                        formSqs={editingSqs}
                        onFormChange={setEditingSqs}
                        onStartEditing={() => startEditing(week, 'shingle')}
                        onSave={() => handleSave(week, 'shingle')}
                        onCancel={cancelEditing}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <CellInput
                        week={week}
                        jobType="metal"
                        isEditing={editingWeek === week && editingType === 'metal'}
                        value={metalValue}
                        formSqs={editingSqs}
                        onFormChange={setEditingSqs}
                        onStartEditing={() => startEditing(week, 'metal')}
                        onSave={() => handleSave(week, 'metal')}
                        onCancel={cancelEditing}
                      />
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {totalValue > 0 ? totalValue.toFixed(0) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs space-x-1 whitespace-nowrap">
                      {prevWeek ? (
                        <>
                          <button
                            onClick={() => handleCopyPreviousWeek(prevWeek, week, 'shingle')}
                            title={`Copy shingle value from ${prevWeek}`}
                            className="px-2 py-1 bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
                          >
                            ↑ Shingle
                          </button>
                          <button
                            onClick={() => handleCopyPreviousWeek(prevWeek, week, 'metal')}
                            title={`Copy metal value from ${prevWeek}`}
                            className="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
                          >
                            ↑ Metal
                          </button>
                        </>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-gray-500">
        💡 Click any cell to edit · Enter to save · Esc to cancel ·{' '}
        <strong>Copy All ↓</strong> forward-fills all empty weeks from your last entered value ·{' '}
        <strong>↑ Shingle / ↑ Metal</strong> copies the value from the row above.
      </div>
    </div>
  );
}
