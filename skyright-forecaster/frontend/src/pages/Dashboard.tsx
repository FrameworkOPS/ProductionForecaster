import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import CrewsManagement from '../components/CrewsManagement';
import CustomProjectsManagement from '../components/CustomProjectsManagement';
import PipelineTracker from '../components/PipelineTracker';
import SalesForecastInput from '../components/SalesForecastInput';
import MetricsDashboard from '../components/MetricsDashboard';
import SixMonthForecaster from '../components/SixMonthForecaster';
import JobNimbusSetup from '../components/JobNimbusSetup';

type TabType = 'forecast' | 'crews' | 'projects' | 'pipeline' | 'sales' | 'metrics' | 'jobnimbus-setup';

export default function Dashboard() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabType>('forecast');

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
              onClick={() => setActiveTab('forecast')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'forecast'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Forecast
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
            <button
              onClick={() => setActiveTab('pipeline')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'pipeline'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Pipeline
            </button>
            <button
              onClick={() => setActiveTab('sales')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'sales'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Sales Forecast
            </button>
            <button
              onClick={() => setActiveTab('metrics')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'metrics'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              Metrics
            </button>
            <button
              onClick={() => setActiveTab('jobnimbus-setup')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'jobnimbus-setup'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              JobNimbus Setup
            </button>
          </div>
        </div>

        {/* Crews Tab */}
        {activeTab === 'crews' && <CrewsManagement />}

        {/* Custom Projects Tab */}
        {activeTab === 'projects' && <CustomProjectsManagement />}

        {/* Pipeline Tab */}
        {activeTab === 'pipeline' && <PipelineTracker />}

        {/* Sales Forecast Tab */}
        {activeTab === 'sales' && <SalesForecastInput />}

        {/* Metrics Tab */}
        {activeTab === 'metrics' && <MetricsDashboard />}

        {/* Forecast Tab */}
        {activeTab === 'forecast' && <SixMonthForecaster />}

        {/* JobNimbus Setup Tab */}
        {activeTab === 'jobnimbus-setup' && <JobNimbusSetup />}
      </div>
    </div>
  );
}
