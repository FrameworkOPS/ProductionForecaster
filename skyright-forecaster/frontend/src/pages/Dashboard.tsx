import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuthStore } from '../store/authStore';
import CrewsManagement from '../components/CrewsManagement';
import CustomProjectsManagement from '../components/CustomProjectsManagement';

interface Forecast {
  id: string;
  forecastDate: string;
  predictedCapacity: number;
  predictedRevenue: number;
  confidenceScore: number;
  bottleneckDetected: boolean;
  bottleneckDescription?: string;
}

interface Parameters {
  currentProductionRate: number;
  rampUpTimeDays: number;
  crewCapacity: number;
  maxConcurrentJobs: number;
  seasonalAdjustment: number;
}

type TabType = 'forecasts' | 'crews' | 'projects';

export default function Dashboard() {
  const { user, token } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('forecasts');
  const [parameters, setParameters] = useState<Parameters | null>(null);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingParameters, setEditingParameters] = useState(false);
  const [newParameters, setNewParameters] = useState<Partial<Parameters>>({});
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load parameters
      const paramsRes = await fetch('http://localhost:5001/api/parameters', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (paramsRes.ok) {
        const data = await paramsRes.json();
        setParameters(data.data);
      }

      // Load forecasts
      const forecastsRes = await fetch('http://localhost:5001/api/forecasts/history', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (forecastsRes.ok) {
        const data = await forecastsRes.json();
        setForecasts(data.data || []);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleParameterUpdate = async () => {
    try {
      const res = await fetch('http://localhost:5001/api/parameters', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newParameters),
      });

      if (res.ok) {
        const data = await res.json();
        setParameters(data.data);
        setEditingParameters(false);
        loadData();
      }
    } catch (error) {
      console.error('Error updating parameters:', error);
    }
  };

  const handleGenerateForecast = async () => {
    try {
      const res = await fetch('http://localhost:5001/api/forecasts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          forecastDate: new Date().toISOString().split('T')[0],
        }),
      });

      if (res.ok) {
        loadData();
      } else {
        alert('Error generating forecast');
      }
    } catch (error) {
      console.error('Error generating forecast:', error);
      alert('Failed to generate forecast');
    }
  };

  const handleDownloadForecast = async (forecastId: string) => {
    setDownloadingId(forecastId);
    try {
      const res = await fetch(`http://localhost:5001/api/forecasts/${forecastId}/export`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (res.ok) {
        // Create blob and download
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `forecast-${forecastId}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        alert('Error downloading forecast');
      }
    } catch (error) {
      console.error('Error downloading forecast:', error);
      alert('Failed to download forecast');
    } finally {
      setDownloadingId(null);
    }
  };

  const chartData = forecasts.map((f) => ({
    date: f.forecastDate,
    capacity: f.predictedCapacity,
    confidence: f.confidenceScore * 100,
  }));

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900">Production Forecaster</h1>
          <p className="text-gray-600 mt-2">Welcome, {user?.email}</p>
        </div>

        {/* Tabs */}
        <div className="mb-8 border-b border-gray-200">
          <div className="flex space-x-8">
            <button
              onClick={() => setActiveTab('forecasts')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'forecasts'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Forecasts
            </button>
            <button
              onClick={() => setActiveTab('crews')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'crews'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Crews
            </button>
            <button
              onClick={() => setActiveTab('projects')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'projects'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Custom Projects
            </button>
          </div>
        </div>

        {/* Forecasts Tab */}
        {activeTab === 'forecasts' && (
          <>
            {/* Key Metrics */}
            {parameters && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">Production Rate</p>
                  <p className="text-3xl font-bold text-blue-600">{parameters.currentProductionRate}</p>
                  <p className="text-gray-500 text-xs mt-2">jobs/week</p>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">Crew Capacity</p>
                  <p className="text-3xl font-bold text-green-600">{parameters.crewCapacity}</p>
                  <p className="text-gray-500 text-xs mt-2">team members</p>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">Max Concurrent</p>
                  <p className="text-3xl font-bold text-purple-600">{parameters.maxConcurrentJobs}</p>
                  <p className="text-gray-500 text-xs mt-2">jobs</p>
                </div>

                <div className="bg-white rounded-lg shadow p-6">
                  <p className="text-gray-600 text-sm">Seasonal Adj</p>
                  <p className="text-3xl font-bold text-orange-600">
                    {(parameters.seasonalAdjustment * 100).toFixed(0)}%
                  </p>
                  <p className="text-gray-500 text-xs mt-2">multiplier</p>
                </div>
              </div>
            )}

            {/* Parameters Section */}
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Production Settings</h2>
                <button
                  onClick={() => {
                    if (editingParameters) {
                      handleParameterUpdate();
                    } else {
                      setNewParameters(parameters || {});
                      setEditingParameters(true);
                    }
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {editingParameters ? 'Save' : 'Edit'}
                </button>
              </div>

              {editingParameters && parameters ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Production Rate</label>
                    <input
                      type="number"
                      step="0.1"
                      value={newParameters.currentProductionRate || 0}
                      onChange={(e) =>
                        setNewParameters({
                          ...newParameters,
                          currentProductionRate: parseFloat(e.target.value),
                        })
                      }
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Crew Capacity</label>
                    <input
                      type="number"
                      value={newParameters.crewCapacity || 0}
                      onChange={(e) =>
                        setNewParameters({
                          ...newParameters,
                          crewCapacity: parseInt(e.target.value),
                        })
                      }
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Max Concurrent Jobs</label>
                    <input
                      type="number"
                      value={newParameters.maxConcurrentJobs || 0}
                      onChange={(e) =>
                        setNewParameters({
                          ...newParameters,
                          maxConcurrentJobs: parseInt(e.target.value),
                        })
                      }
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Seasonal Adjustment</label>
                    <input
                      type="number"
                      step="0.1"
                      value={newParameters.seasonalAdjustment || 0}
                      onChange={(e) =>
                        setNewParameters({
                          ...newParameters,
                          seasonalAdjustment: parseFloat(e.target.value),
                        })
                      }
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
              ) : (
                <div className="text-gray-600">
                  <p>
                    <strong>Note:</strong> Individual crew parameters override these global settings.
                  </p>
                </div>
              )}
            </div>

            {/* Forecast Section */}
            <div className="bg-white rounded-lg shadow p-6 mb-8">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-gray-900">Forecast Overview</h2>
                <button
                  onClick={handleGenerateForecast}
                  disabled={loading}
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                >
                  {loading ? 'Generating...' : 'Generate Forecast'}
                </button>
              </div>

              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="capacity" stroke="#3b82f6" />
                    <Line type="monotone" dataKey="confidence" stroke="#10b981" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-gray-600 text-center py-8">
                  No forecasts available. Generate one to see data.
                </div>
              )}
            </div>

            {/* Recent Forecasts */}
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-6 py-4 border-b">
                <h2 className="text-xl font-bold text-gray-900">Recent Forecasts</h2>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Date</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Capacity</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Revenue</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Confidence</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Status</th>
                      <th className="px-6 py-3 text-left text-sm font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecasts.map((forecast) => (
                      <tr key={forecast.id} className="border-t hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900">{forecast.forecastDate}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">{forecast.predictedCapacity}</td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          ${parseFloat(String(forecast.predictedRevenue)).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {(forecast.confidenceScore * 100).toFixed(0)}%
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {forecast.bottleneckDetected ? (
                            <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                              ⚠️ Bottleneck
                            </span>
                          ) : (
                            <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                              ✓ Normal
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <button
                            onClick={() => handleDownloadForecast(forecast.id)}
                            disabled={downloadingId === forecast.id}
                            className="text-blue-600 hover:text-blue-800 disabled:text-gray-400"
                          >
                            {downloadingId === forecast.id ? 'Downloading...' : 'Download PDF'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* Crews Tab */}
        {activeTab === 'crews' && <CrewsManagement />}

        {/* Custom Projects Tab */}
        {activeTab === 'projects' && <CustomProjectsManagement />}
      </div>
    </div>
  );
}
