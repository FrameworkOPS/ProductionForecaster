import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../store/authStore';
import { API_BASE_URL } from '../utils/apiConfig';

interface JobNimbusStatus {
  configured: boolean;
  message: string;
}

export default function JobNimbusSetup() {
  const { token } = useAuthStore();
  const [status, setStatus] = useState<JobNimbusStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostic, setDiagnostic] = useState<any | null>(null);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/jobnimbus/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data.data);
      } else {
        setStatus({ configured: false, message: 'Unable to check JobNimbus status. Ensure the backend is running.' });
      }
    } catch (error) {
      console.error('Error checking JobNimbus status:', error);
      setStatus({ configured: false, message: 'Unable to connect to backend. Ensure the server is running.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/jobnimbus/sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        const result = data.data;
        setSyncResult(`Sync complete: ${result.created} created, ${result.updated} updated, ${result.total} total jobs.`);
      } else {
        const errData = await res.json().catch(() => ({}));
        setSyncResult(`Sync failed: ${errData.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error syncing:', error);
      setSyncResult('Sync failed: Could not connect to backend.');
    } finally {
      setSyncing(false);
    }
  };

  const handleDiagnostic = async () => {
    setDiagnosing(true);
    setDiagnostic(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/jobnimbus/debug`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      setDiagnostic(data.data ?? data);
    } catch (error) {
      console.error('Error running diagnostic:', error);
      setDiagnostic({ error: 'Could not connect to backend.' });
    } finally {
      setDiagnosing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">JobNimbus Integration Setup</h2>
        <button
          onClick={checkStatus}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Refresh Status
        </button>
      </div>

      {loading && <div className="text-center py-8 text-gray-500">Checking JobNimbus status...</div>}

      {status && (
        <div
          className={`border-l-4 p-4 rounded ${
            status.configured ? 'border-green-400 bg-green-50' : 'border-yellow-400 bg-yellow-50'
          }`}
        >
          <p className={`font-medium ${status.configured ? 'text-green-800' : 'text-yellow-800'}`}>
            {status.message}
          </p>
        </div>
      )}

      {/* Sync section — visible when configured */}
      {status && status.configured && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <span className="text-green-700 font-bold text-lg">JN</span>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900">JobNimbus Integration Active</h3>
              <p className="text-sm text-gray-600">
                Your JobNimbus jobs are connected. Pipeline data displays on the Sales Forecast tab.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleDiagnostic}
                disabled={diagnosing}
                className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
              >
                {diagnosing ? 'Running…' : 'Run Diagnostic'}
              </button>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync Jobs Now'}
              </button>
            </div>
          </div>

          {syncResult && (
            <div
              className={`p-3 rounded text-sm ${
                syncResult.includes('failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
              }`}
            >
              {syncResult}
            </div>
          )}

          {diagnostic && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">
                  Diagnostic — what JobNimbus is returning
                </p>
                <button
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2))}
                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  Copy
                </button>
              </div>
              {typeof diagnostic.classifiedAsMetalOrShingle === 'number' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div className="bg-gray-50 border rounded p-2">
                    <div className="text-xs text-gray-500">Total jobs</div>
                    <div className="font-bold text-gray-900">{diagnostic.totalJobs}</div>
                  </div>
                  <div className="bg-gray-50 border rounded p-2">
                    <div className="text-xs text-gray-500">Classified metal/shingle</div>
                    <div className={`font-bold ${diagnostic.classifiedAsMetalOrShingle === 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {diagnostic.classifiedAsMetalOrShingle}
                    </div>
                  </div>
                  <div className="bg-gray-50 border rounded p-2">
                    <div className="text-xs text-gray-500">In forecast filter</div>
                    <div className="font-bold text-gray-900">{diagnostic.forecastJobCount}</div>
                  </div>
                  <div className="bg-gray-50 border rounded p-2">
                    <div className="text-xs text-gray-500">Jobs with squares</div>
                    <div className="font-bold text-gray-900">{diagnostic.jobsWithSquares}</div>
                  </div>
                </div>
              )}
              <pre className="bg-gray-900 text-green-200 text-xs p-3 rounded overflow-auto max-h-96">
                {JSON.stringify(diagnostic, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Setup instructions — shown when not configured */}
      {status && !status.configured && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Setup Instructions</h3>

            <ol className="space-y-4 text-gray-700">
              <li className="flex gap-4">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                  1
                </span>
                <div>
                  <p className="font-medium">Generate a JobNimbus API key</p>
                  <p className="text-sm text-gray-600">
                    In JobNimbus go to Settings → API and create a new API key with read access to Jobs.
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                  2
                </span>
                <div>
                  <p className="font-medium">Set environment variables on the backend</p>
                  <p className="text-sm text-gray-600 mb-2">
                    Add these to your backend <code className="bg-gray-100 px-1 rounded">.env</code> file:
                  </p>
                  <div className="space-y-2">
                    <div className="bg-gray-100 px-3 py-2 rounded text-sm">
                      <code>JOBNIMBUS_API_KEY=your_api_key_here</code>
                    </div>
                    <div className="bg-gray-100 px-3 py-2 rounded text-sm">
                      <code>JOBNIMBUS_PIPELINE_STATUSES=Contract Signed,Estimating</code>
                      <span className="text-xs text-gray-500"> (optional — comma-separated status names)</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Leave <code className="bg-gray-100 px-1 rounded">JOBNIMBUS_PIPELINE_STATUSES</code> unset to include all jobs.
                  </p>
                </div>
              </li>

              <li className="flex gap-4">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center font-semibold text-sm">
                  3
                </span>
                <div>
                  <p className="font-medium">Restart the backend server</p>
                  <p className="text-sm text-gray-600">
                    After setting the variables, restart the backend and click "Refresh Status" above.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
