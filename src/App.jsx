import React, { useState, useEffect } from 'react';
import './App.css';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export default function App() {
  // Data inputs
  const [sqsWaiting, setSqsWaiting] = useState(1239);
  const [weeklySalesForecast, setWeeklySalesForecast] = useState(200);
  const [trainingCycleWeeks, setTrainingCycleWeeks] = useState(4);

  // State for modal/detail view
  const [expandedMetric, setExpandedMetric] = useState(null);

  // Job types configuration - Shingles and Metal only
  const [jobTypes, setJobTypes] = useState({
    shingles: {
      name: 'Shingles',
      sqsPerCrewWeekly: 120,
      crews: 2,
      productionRate: 240,
      leadTimeWeeks: 2,
      revenuePerSqs: 28,
      crewLeads: 1,
      sqsPerCrewLead: 240,
      requiresCrewLead: true
    },
    metal: {
      name: 'Metal',
      sqsPerCrewWeekly: 180,
      crews: 1,
      productionRate: 180,
      leadTimeWeeks: 3,
      revenuePerSqs: 42,
      crewLeads: 1,
      sqsPerCrewLead: 180,
      requiresCrewLead: true
    }
  });

  const [siteSupervisors, setSiteSupervisors] = useState(3);
  const [newCrews, setNewCrews] = useState([]);
  const [newSupers, setNewSupers] = useState([]);
  const [showOverrideWarning, setShowOverrideWarning] = useState({});
  const [overrideEnabled, setOverrideEnabled] = useState({});

  // NEW: Forecast features
  const [plannedHires, setPlannedHires] = useState([]);
  const [forecastSnapshots, setForecastSnapshots] = useState(() => {
    try {
      const saved = localStorage.getItem('skyright_forecasts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showTimelineModal, setShowTimelineModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [newHireName, setNewHireName] = useState('');
  const [newHireDate, setNewHireDate] = useState('');
  const [newHireType, setNewHireType] = useState('crew');
  const [newHireJobType, setNewHireJobType] = useState('shingles');
  const [newHireTrainingWeeks, setNewHireTrainingWeeks] = useState(4);
  const [newHireQuantity, setNewHireQuantity] = useState(1);
  const [saveForecastName, setSaveForecastName] = useState('');
  const [sixMonthForecast, setSixMonthForecast] = useState([]);

  // Helper functions (must be defined before calculateMetrics)
  const getReadyCrews = (type) => {
    return newCrews.filter(c => c.type === type && new Date() >= c.readyDate).length;
  };

  const getReadySupers = () => {
    return newSupers.filter(s => new Date() >= s.readyDate).length;
  };

  const canRunJobType = (jobTypeKey) => {
    const type = jobTypes[jobTypeKey];
    const totalCrewLeads = type.crewLeads + getReadySupers();

    if (type.requiresCrewLead && totalCrewLeads === 0) {
      return { canRun: false, warning: true };
    }
    return { canRun: true, warning: false };
  };

  // NEW: Generate 6-month forecast with planned hires
  const generateSixMonthForecast = () => {
    const forecast = [];
    let currentPipeline = sqsWaiting;
    let currentDate = new Date();
    let activeCrews = { ...jobTypes };

    // Track which crews become ready each week
    const forecastStart = new Date(currentDate);
    forecastStart.setHours(0, 0, 0, 0);
    let lastWeekDate = new Date(forecastStart);
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);

    for (let week = 0; week < 26; week++) {
      const weekDate = new Date(forecastStart.getTime() + week * 7 * 24 * 60 * 60 * 1000);

      // 1. Check which planned hires become ready this week
      const newCrewsReady = { shingles: 0, metal: 0 };
      plannedHires.forEach(hire => {
        const readyDate = new Date(hire.readyDate);
        if (readyDate <= weekDate && readyDate > lastWeekDate) {
          if (hire.type === 'crew') {
            newCrewsReady[hire.jobType] += hire.quantity;
          }
        }
      });

      // 2. Update active crews (permanent increases)
      Object.keys(newCrewsReady).forEach(type => {
        if (activeCrews[type]) {
          activeCrews[type] = { ...activeCrews[type], crews: (activeCrews[type].crews || 0) + newCrewsReady[type] };
        }
      });

      // 3. Calculate production this week
      let weeklyOutflow = 0;
      Object.values(activeCrews).forEach(type => {
        if (type.crews) {
          weeklyOutflow += type.crews * (type.sqsPerCrewWeekly || 0);
        }
      });

      const weeklyIncome = weeklySalesForecast;

      // 4. Update pipeline
      currentPipeline = Math.max(0, currentPipeline + weeklyIncome - weeklyOutflow);

      // 5. Calculate revenue
      let totalRevenue = 0;
      Object.entries(activeCrews).forEach(([key, type]) => {
        if (type.crews) {
          const typeProduction = type.crews * (type.sqsPerCrewWeekly || 0);
          totalRevenue += typeProduction * (type.revenuePerSqs || 0);
        }
      });

      // 6. Generate notes
      let notes = '';
      if (Object.values(newCrewsReady).some(v => v > 0)) {
        const readyTypes = Object.entries(newCrewsReady)
          .filter(([_, qty]) => qty > 0)
          .map(([type, qty]) => `${qty} ${type} crew(s)`)
          .join(', ');
        notes = `${readyTypes} ready`;
      }

      forecast.push({
        weekNumber: week,
        weekDate: weekDate.toLocaleDateString(),
        pipeline: Math.round(currentPipeline),
        weeklyIncome,
        weeklyOutflow: Math.round(weeklyOutflow),
        netChange: weeklyIncome - Math.round(weeklyOutflow),
        activeCrew: {
          shingles: activeCrews.shingles?.crews || 0,
          metal: activeCrews.metal?.crews || 0
        },
        newCrewsReady,
        totalRevenue: Math.round(totalRevenue),
        notes
      });

      lastWeekDate = weekDate;
    }

    return forecast;
  };

  // NEW: Save forecast snapshot
  const saveForecast = (name) => {
    if (!name.trim()) {
      alert('Please enter a forecast name');
      return;
    }

    const snapshot = {
      id: Date.now().toString(),
      name,
      timestamp: new Date().toLocaleString(),
      data: {
        sqsWaiting,
        weeklySalesForecast,
        trainingCycleWeeks,
        siteSupervisors,
        jobTypes,
        newCrews: newCrews.map(c => ({ ...c, readyDate: c.readyDate.toISOString() })),
        newSupers: newSupers.map(s => ({ ...s, readyDate: s.readyDate.toISOString() })),
        plannedHires: plannedHires.map(h => ({ ...h, hireDate: h.hireDate.toISOString(), readyDate: h.readyDate.toISOString() })),
        overrideEnabled
      }
    };

    const existing = JSON.parse(localStorage.getItem('skyright_forecasts') || '[]');
    existing.push(snapshot);
    localStorage.setItem('skyright_forecasts', JSON.stringify(existing));
    setForecastSnapshots(existing);
    setSaveForecastName('');
    setShowSaveModal(false);
    alert(`Forecast "${name}" saved!`);
  };

  // NEW: Load forecast snapshot
  const loadForecast = (id) => {
    const snapshot = forecastSnapshots.find(s => s.id === id);
    if (!snapshot) return;

    // Rehydrate all state
    setSqsWaiting(snapshot.data.sqsWaiting);
    setWeeklySalesForecast(snapshot.data.weeklySalesForecast);
    setTrainingCycleWeeks(snapshot.data.trainingCycleWeeks);
    setSiteSupervisors(snapshot.data.siteSupervisors);
    setJobTypes(snapshot.data.jobTypes);
    setNewCrews(snapshot.data.newCrews.map(c => ({ ...c, readyDate: new Date(c.readyDate) })));
    setNewSupers(snapshot.data.newSupers.map(s => ({ ...s, readyDate: new Date(s.readyDate) })));
    setPlannedHires(snapshot.data.plannedHires.map(h => ({
      ...h,
      hireDate: new Date(h.hireDate),
      readyDate: new Date(h.readyDate)
    })));
    setOverrideEnabled(snapshot.data.overrideEnabled);
    setShowLoadModal(false);
    alert(`Forecast "${snapshot.name}" loaded!`);
  };

  // NEW: Export to PDF
  const exportToPDF = async () => {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      let yPosition = 10;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Title
      pdf.setFontSize(16);
      pdf.text('Skyright Roofing - Production Forecast', 10, yPosition);
      yPosition += 8;

      // Date
      pdf.setFontSize(10);
      pdf.text(`Generated: ${new Date().toLocaleString()}`, 10, yPosition);
      yPosition += 8;

      // Current Metrics
      pdf.setFontSize(12);
      pdf.text('Current Metrics', 10, yPosition);
      yPosition += 6;

      pdf.setFontSize(9);
      const metrics = calculateMetrics();
      const metricsData = [
        [`Pipeline SQS: ${metrics.pipelineTotal.toLocaleString()}`],
        [`Weekly Sales: ${metrics.weeklyIncome.toLocaleString()} SQS`],
        [`Weekly Production: ${metrics.weeklyOutflow.toLocaleString()} SQS`],
        [`Net Weekly Change: ${metrics.netChange.toLocaleString()}`],
        [`Weekly Revenue: $${metrics.totalRevenue.toLocaleString()}`],
      ];

      metricsData.forEach(data => {
        pdf.text(data[0], 15, yPosition);
        yPosition += 5;
      });

      // Input Assumptions
      yPosition += 5;
      pdf.setFontSize(12);
      pdf.text('Input Assumptions', 10, yPosition);
      yPosition += 6;

      pdf.setFontSize(9);
      const assumptions = [
        [`SQS Waiting: ${sqsWaiting.toLocaleString()}`],
        [`Weekly Sales Forecast: ${weeklySalesForecast} SQS`],
        [`Training Cycle: ${trainingCycleWeeks} weeks`],
        [`Site Supervisors: ${siteSupervisors}`],
        [`Shingles Crews: ${jobTypes.shingles.crews}`],
        [`Metal Crews: ${jobTypes.metal.crews}`],
        [`Planned Hires: ${plannedHires.length}`],
      ];

      assumptions.forEach(data => {
        pdf.text(data[0], 15, yPosition);
        yPosition += 5;
        if (yPosition > pageHeight - 20) {
          pdf.addPage();
          yPosition = 10;
        }
      });

      // 6-Month Forecast Table
      if (sixMonthForecast.length > 0) {
        yPosition += 5;
        pdf.setFontSize(12);
        pdf.text('6-Month Forecast', 10, yPosition);
        yPosition += 6;

        pdf.setFontSize(8);
        const tableData = sixMonthForecast
          .filter((_, i) => i % 4 === 0) // Show every 4th week to fit on page
          .map(week => [
            `Week ${week.weekNumber}`,
            week.pipeline.toString(),
            week.weeklyOutflow.toString(),
            week.netChange.toString(),
            `$${(week.totalRevenue / 1000).toFixed(1)}K`
          ]);

        pdf.autoTable({
          head: [['Week', 'Pipeline SQS', 'Prod/Week', 'Net Change', 'Revenue']],
          body: tableData,
          startY: yPosition,
          margin: 10,
          fontSize: 8,
          didDrawPage: (data) => {
            yPosition = data.cursor.y + 5;
          }
        });
      }

      // Crew Timeline
      if (plannedHires.length > 0) {
        pdf.addPage();
        yPosition = 10;
        pdf.setFontSize(12);
        pdf.text('Crew Training Timeline', 10, yPosition);
        yPosition += 6;

        pdf.setFontSize(9);
        plannedHires.forEach(hire => {
          const hireDate = new Date(hire.hireDate).toLocaleDateString();
          const readyDate = new Date(hire.readyDate).toLocaleDateString();
          const hireInfo = `${hire.quantity}x ${hire.jobType || 'Supervisor'} - Hired: ${hireDate}, Ready: ${readyDate}`;
          pdf.text(hireInfo, 15, yPosition);
          yPosition += 5;
        });
      }

      // Save PDF
      const filename = `Forecast_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
      alert('PDF exported successfully!');
    } catch (error) {
      console.error('PDF export error:', error);
      alert('Error exporting PDF');
    }
  };

  // NEW: Add planned hire
  const addPlannedHire = () => {
    if (!newHireDate) {
      alert('Please select a hire date');
      return;
    }

    const hireDate = new Date(newHireDate);
    const readyDate = new Date(hireDate.getTime() + newHireTrainingWeeks * 7 * 24 * 60 * 60 * 1000);

    const newHire = {
      id: Date.now().toString(),
      type: newHireType,
      jobType: newHireType === 'crew' ? newHireJobType : null,
      hireDate,
      readyDate,
      trainingWeeks: newHireTrainingWeeks,
      quantity: newHireQuantity
    };

    setPlannedHires([...plannedHires, newHire]);
    setNewHireDate('');
    setNewHireQuantity(1);
    setNewHireTrainingWeeks(4);

    // Auto-generate new forecast
    setTimeout(() => {
      setSixMonthForecast(generateSixMonthForecast());
    }, 100);
  };

  // NEW: Remove planned hire
  const removePlannedHire = (id) => {
    setPlannedHires(plannedHires.filter(h => h.id !== id));
    setTimeout(() => {
      setSixMonthForecast(generateSixMonthForecast());
    }, 100);
  };

  // Calculate metrics
  const calculateMetrics = () => {
    let totalProduction = 0;
    let totalRevenue = 0;
    let totalPipelineByType = {};
    let weeksOfProductionByType = {};
    const metricsByType = {};

    Object.entries(jobTypes).forEach(([key, type]) => {
      const activeCrews = type.crews;
      const production = activeCrews * type.sqsPerCrewWeekly;
      const revenue = production * type.revenuePerSqs;

      totalProduction += production;
      totalRevenue += revenue;

      // Estimate pipeline SQS by type (proportional to production rate)
      const estimatedPipelineForType = sqsWaiting * (production / (totalProduction || 1));
      totalPipelineByType[key] = estimatedPipelineForType;

      // Weeks of production for this type
      weeksOfProductionByType[key] = production > 0 ? estimatedPipelineForType / production : 0;

      const totalCrewLeads = type.crewLeads + getReadySupers();
      const { canRun, warning } = canRunJobType(key);

      metricsByType[key] = {
        ...type,
        activeCrews,
        production,
        weeklyRevenue: revenue,
        pipelineForType: estimatedPipelineForType,
        weeksForType: weeksOfProductionByType[key],
        totalCrewLeads,
        canRun,
        warning
      };
    });

    // Recalculate total production now that we have all production values
    totalProduction = 0;
    Object.values(jobTypes).forEach(type => {
      totalProduction += type.crews * type.sqsPerCrewWeekly;
    });

    // Pipeline calculation
    const pipelineTotal = sqsWaiting;
    const weeklyIncome = weeklySalesForecast;
    const weeklyOutflow = totalProduction;
    const netChange = weeklyIncome - weeklyOutflow;
    const weeksOfProduction = weeklyOutflow > 0 ? pipelineTotal / weeklyOutflow : 0;

    return {
      metricsByType,
      totalProduction,
      totalRevenue,
      pipelineTotal,
      weeklyIncome,
      weeklyOutflow,
      netChange,
      weeksOfProduction,
      pipelineByType: totalPipelineByType,
      weeksOfProductionByType
    };
  };

  const metrics = calculateMetrics();

  // Handle adding new crew
  const addNewCrew = (type) => {
    const rampUpWeeks = prompt(`Anticipated ramp-up period for new ${type} crew (weeks)?`, '4');
    if (rampUpWeeks) {
      const startDate = new Date();
      const readyDate = new Date(startDate.getTime() + parseInt(rampUpWeeks) * 7 * 24 * 60 * 60 * 1000);

      setNewCrews([...newCrews, {
        id: Date.now(),
        type,
        startDate,
        readyDate,
        rampUpWeeks: parseInt(rampUpWeeks),
        status: 'training'
      }]);
    }
  };

  const addNewSuper = () => {
    const rampUpWeeks = prompt('Anticipated ramp-up period for new Site Super (weeks)?', '4');
    if (rampUpWeeks) {
      const startDate = new Date();
      const readyDate = new Date(startDate.getTime() + parseInt(rampUpWeeks) * 7 * 24 * 60 * 60 * 1000);

      setNewSupers([...newSupers, {
        id: Date.now(),
        startDate,
        readyDate,
        rampUpWeeks: parseInt(rampUpWeeks),
        status: 'training'
      }]);
    }
  };

  // Handle override for running without crew lead
  const handleCrewLeadOverride = (jobTypeKey) => {
    setOverrideEnabled({ ...overrideEnabled, [jobTypeKey]: true });
    setShowOverrideWarning({ ...showOverrideWarning, [jobTypeKey]: false });
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo-section">
            <img src="/assets/skyright-logo.png" alt="Skyright Roofing" className="skyright-logo" />
            <div className="header-text">
              <p className="tagline">Production Forecaster</p>
            </div>
          </div>
          <p className="subtitle">Real-time Pipeline Management & Production Planning</p>
        </div>
        <div className="header-actions">
          <button className="btn-header" onClick={() => setShowTimelineModal(true)} title="Timeline Builder">
            📅 Timeline
          </button>
          <button className="btn-header" onClick={() => setShowSaveModal(true)} title="Save Forecast">
            💾 Save
          </button>
          <button className="btn-header" onClick={() => setShowLoadModal(true)} title="Load Forecast">
            📂 Load
          </button>
          <button className="btn-header" onClick={exportToPDF} title="Export to PDF">
            📄 Export
          </button>
        </div>
      </header>

      <div className="container">
        {/* METRICS DASHBOARD */}
        <section className="metrics-section">
          <h2>Current Metrics</h2>

          <div className="metrics-grid">
            {/* Pipeline - CLICKABLE */}
            <div
              className={`metric-card clickable ${expandedMetric === 'pipeline' ? 'expanded' : ''}`}
              onClick={() => setExpandedMetric(expandedMetric === 'pipeline' ? null : 'pipeline')}
            >
              <div className="metric-label">Pipeline SQS</div>
              <div className="metric-value">{metrics.pipelineTotal.toLocaleString()}</div>
              <div className="metric-detail">Click for breakdown</div>

              {expandedMetric === 'pipeline' && (
                <div className="metric-detail-expanded">
                  <div className="detail-item">
                    <span className="detail-label">Shingles:</span>
                    <span className="detail-value">{Math.round(metrics.pipelineByType.shingles).toLocaleString()} SQS</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Metal:</span>
                    <span className="detail-value">{Math.round(metrics.pipelineByType.metal).toLocaleString()} SQS</span>
                  </div>
                </div>
              )}
            </div>

            {/* Weekly Sales - CLICKABLE */}
            <div
              className={`metric-card clickable ${expandedMetric === 'sales' ? 'expanded' : ''}`}
              onClick={() => setExpandedMetric(expandedMetric === 'sales' ? null : 'sales')}
            >
              <div className="metric-label">Weekly Sales Forecast</div>
              <div className="metric-value">{metrics.weeklyIncome.toLocaleString()}</div>
              <div className="metric-detail">Click for breakdown</div>

              {expandedMetric === 'sales' && (
                <div className="metric-detail-expanded">
                  <div className="detail-item">
                    <span className="detail-label">Shingles:</span>
                    <span className="detail-value">{Math.round(metrics.weeklyIncome * 0.4).toLocaleString()} SQS</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Metal:</span>
                    <span className="detail-value">{Math.round(metrics.weeklyIncome * 0.6).toLocaleString()} SQS</span>
                  </div>
                </div>
              )}
            </div>

            {/* Weekly Production - CLICKABLE */}
            <div
              className={`metric-card clickable ${expandedMetric === 'production' ? 'expanded' : ''}`}
              onClick={() => setExpandedMetric(expandedMetric === 'production' ? null : 'production')}
            >
              <div className="metric-label">Weekly Production</div>
              <div className="metric-value">{metrics.weeklyOutflow.toLocaleString()}</div>
              <div className="metric-detail">Click for breakdown</div>

              {expandedMetric === 'production' && (
                <div className="metric-detail-expanded">
                  <div className="detail-item">
                    <span className="detail-label">Shingles:</span>
                    <span className="detail-value">{Math.round(metrics.metricsByType.shingles.production).toLocaleString()} SQS</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Metal:</span>
                    <span className="detail-value">{Math.round(metrics.metricsByType.metal.production).toLocaleString()} SQS</span>
                  </div>
                </div>
              )}
            </div>

            {/* Weeks of Production - OWN CARD, CLICKABLE */}
            <div
              className={`metric-card clickable ${expandedMetric === 'weeks' ? 'expanded' : ''}`}
              onClick={() => setExpandedMetric(expandedMetric === 'weeks' ? null : 'weeks')}
            >
              <div className="metric-label">Weeks of Production</div>
              <div className="metric-value">{metrics.weeksOfProduction.toFixed(1)}</div>
              <div className="metric-detail">Click for breakdown</div>

              {expandedMetric === 'weeks' && (
                <div className="metric-detail-expanded">
                  <div className="detail-item">
                    <span className="detail-label">Shingles:</span>
                    <span className="detail-value">{metrics.weeksOfProductionByType.shingles.toFixed(1)} weeks</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Metal:</span>
                    <span className="detail-value">{metrics.weeksOfProductionByType.metal.toFixed(1)} weeks</span>
                  </div>
                </div>
              )}
            </div>

            {/* Net Change */}
            <div className={`metric-card ${metrics.netChange >= 0 ? 'positive' : 'negative'}`}>
              <div className="metric-label">Net Weekly Change</div>
              <div className="metric-value">{metrics.netChange.toLocaleString()}</div>
              <div className="metric-detail">{metrics.netChange > 0 ? '📈 Growing' : '📉 Declining'}</div>
            </div>

            {/* Revenue - CLICKABLE */}
            <div
              className={`metric-card clickable ${expandedMetric === 'revenue' ? 'expanded' : ''}`}
              onClick={() => setExpandedMetric(expandedMetric === 'revenue' ? null : 'revenue')}
            >
              <div className="metric-label">Weekly Revenue</div>
              <div className="metric-value">${(metrics.totalRevenue / 1000).toFixed(0)}K</div>
              <div className="metric-detail">Click for breakdown</div>

              {expandedMetric === 'revenue' && (
                <div className="metric-detail-expanded">
                  <div className="detail-item">
                    <span className="detail-label">Shingles:</span>
                    <span className="detail-value">${(metrics.metricsByType.shingles.weeklyRevenue / 1000).toFixed(1)}K</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Metal:</span>
                    <span className="detail-value">${(metrics.metricsByType.metal.weeklyRevenue / 1000).toFixed(1)}K</span>
                  </div>
                </div>
              )}
            </div>

            {/* Crews - CLICKABLE */}
            <div
              className={`metric-card clickable ${expandedMetric === 'crews' ? 'expanded' : ''}`}
              onClick={() => setExpandedMetric(expandedMetric === 'crews' ? null : 'crews')}
            >
              <div className="metric-label">Active Crews</div>
              <div className="metric-value">
                {Object.values(metrics.metricsByType).reduce((sum, t) => sum + t.crews, 0)}
              </div>
              <div className="metric-detail">Click for breakdown</div>

              {expandedMetric === 'crews' && (
                <div className="metric-detail-expanded">
                  <div className="detail-item">
                    <span className="detail-label">Shingles:</span>
                    <span className="detail-value">{metrics.metricsByType.shingles.crews} crews</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Metal:</span>
                    <span className="detail-value">{metrics.metricsByType.metal.crews} crews</span>
                  </div>
                  <div className="detail-item training">
                    <span className="detail-label">In Training:</span>
                    <span className="detail-value">{newCrews.filter(c => c.status === 'training').length}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Site Supers/Crew Leads - CLICKABLE */}
            <div
              className={`metric-card clickable ${expandedMetric === 'supers' ? 'expanded' : ''}`}
              onClick={() => setExpandedMetric(expandedMetric === 'supers' ? null : 'supers')}
            >
              <div className="metric-label">Site Supers/Crew Leads</div>
              <div className="metric-value">{siteSupervisors + getReadySupers()}</div>
              <div className="metric-detail">Click for breakdown</div>

              {expandedMetric === 'supers' && (
                <div className="metric-detail-expanded">
                  <div className="detail-item">
                    <span className="detail-label">Active:</span>
                    <span className="detail-value">{siteSupervisors}</span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Ready from Training:</span>
                    <span className="detail-value">{getReadySupers()}</span>
                  </div>
                  <div className="detail-item training">
                    <span className="detail-label">In Training:</span>
                    <span className="detail-value">{newSupers.filter(s => s.status === 'training').length}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* JOB TYPE METRICS */}
        <section className="job-types-section">
          <h2>Metrics By Job Type</h2>

          <div className="job-types-grid">
            {Object.entries(metrics.metricsByType).map(([key, type]) => (
              <div key={key} className={`job-type-card ${!type.canRun && !overrideEnabled[key] ? 'needs-crew-lead' : ''}`}>
                <h3>{type.name}</h3>

                {!type.canRun && !overrideEnabled[key] && (
                  <div className="crew-lead-badge">⚠️ Needs Crew Lead</div>
                )}

                <div className="job-metric">
                  <span>Lead Time</span>
                  <strong>{type.leadTimeWeeks} weeks</strong>
                </div>

                <div className="job-metric">
                  <span>Production Rate</span>
                  <strong>{type.production} SQS/week</strong>
                </div>

                <div className="job-metric">
                  <span>Active Crews</span>
                  <strong>{type.crews}</strong>
                </div>

                <div className="job-metric">
                  <span>SQS Per Crew/Week</span>
                  <strong>{type.sqsPerCrewWeekly}</strong>
                </div>

                <div className="job-metric">
                  <span>Crew Leads Assigned</span>
                  <strong>{type.totalCrewLeads}</strong>
                </div>

                <div className="job-metric">
                  <span>SQS Per Crew Lead/Week</span>
                  <strong>{type.sqsPerCrewLead}</strong>
                </div>

                <div className="job-metric">
                  <span>Weekly Revenue</span>
                  <strong>${type.weeklyRevenue.toLocaleString()}</strong>
                </div>

                <div className="job-metric">
                  <span>Weeks in Pipeline</span>
                  <strong>{type.weeksForType.toFixed(1)} weeks</strong>
                </div>

                <button
                  className="btn-small"
                  onClick={() => addNewCrew(key)}
                >
                  + Add Crew
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* DATA INPUT SECTION */}
        <section className="data-input-section">
          <h2>Input Data</h2>

          <div className="input-grid">
            <div className="input-group">
              <label>SQS Waiting To Be Installed</label>
              <input
                type="number"
                value={sqsWaiting}
                onChange={(e) => setSqsWaiting(Number(e.target.value))}
              />
            </div>

            <div className="input-group">
              <label>Weekly Sales Forecast (SQS)</label>
              <input
                type="number"
                value={weeklySalesForecast}
                onChange={(e) => setWeeklySalesForecast(Number(e.target.value))}
              />
            </div>

            <div className="input-group">
              <label>Training Cycle (Weeks)</label>
              <input
                type="number"
                value={trainingCycleWeeks}
                onChange={(e) => setTrainingCycleWeeks(Number(e.target.value))}
              />
            </div>

            <div className="input-group">
              <label>Current Site Supers/Crew Leads</label>
              <input
                type="number"
                value={siteSupervisors}
                onChange={(e) => setSiteSupervisors(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Job Type Configuration */}
          <h3>Job Type Configuration</h3>
          <div className="config-grid">
            {Object.entries(jobTypes).map(([key, type]) => {
              const { canRun, warning } = canRunJobType(key);
              return (
              <div key={key} className={`config-card ${warning ? 'warning-card' : ''}`}>
                <h4>{type.name}</h4>

                {warning && !overrideEnabled[key] && (
                  <div className="crew-lead-warning">
                    <p>⚠️ No crew leads assigned!</p>
                    <p>This job type cannot run without at least one crew lead/site super.</p>
                    <button
                      className="btn-override"
                      onClick={() => handleCrewLeadOverride(key)}
                    >
                      Override & Continue
                    </button>
                  </div>
                )}

                {overrideEnabled[key] && (
                  <div className="crew-lead-override">
                    <p>🔓 Running with override (no crew lead)</p>
                  </div>
                )}

                <div className="config-input">
                  <label>SQS Per Crew (Weekly)</label>
                  <input
                    type="number"
                    value={type.sqsPerCrewWeekly}
                    onChange={(e) => setJobTypes({
                      ...jobTypes,
                      [key]: {...type, sqsPerCrewWeekly: Number(e.target.value)}
                    })}
                  />
                </div>

                <div className="config-input">
                  <label>Current Crews</label>
                  <input
                    type="number"
                    value={type.crews}
                    onChange={(e) => setJobTypes({
                      ...jobTypes,
                      [key]: {...type, crews: Number(e.target.value)}
                    })}
                  />
                </div>

                <div className="config-input">
                  <label>Crew Leads For This Type</label>
                  <input
                    type="number"
                    value={type.crewLeads}
                    onChange={(e) => setJobTypes({
                      ...jobTypes,
                      [key]: {...type, crewLeads: Number(e.target.value)}
                    })}
                  />
                </div>

                <div className="config-input">
                  <label>SQS Per Crew Lead (Weekly Capacity)</label>
                  <input
                    type="number"
                    value={type.sqsPerCrewLead}
                    onChange={(e) => setJobTypes({
                      ...jobTypes,
                      [key]: {...type, sqsPerCrewLead: Number(e.target.value)}
                    })}
                  />
                </div>

                <div className="config-input">
                  <label>Lead Time (Weeks)</label>
                  <input
                    type="number"
                    value={type.leadTimeWeeks}
                    onChange={(e) => setJobTypes({
                      ...jobTypes,
                      [key]: {...type, leadTimeWeeks: Number(e.target.value)}
                    })}
                  />
                </div>

                <div className="config-input">
                  <label>Revenue Per SQS</label>
                  <input
                    type="number"
                    value={type.revenuePerSqs}
                    onChange={(e) => setJobTypes({
                      ...jobTypes,
                      [key]: {...type, revenuePerSqs: Number(e.target.value)}
                    })}
                  />
                </div>
              </div>
            );
            })}
          </div>

          <button className="btn-primary" onClick={addNewSuper}>
            + Add New Site Supervisor
          </button>
        </section>

        {/* TRAINING TRACKING */}
        {(newCrews.length > 0 || newSupers.length > 0) && (
          <section className="training-section">
            <h2>Training & Ramp-Up Schedule</h2>

            {newCrews.length > 0 && (
              <div>
                <h3>New Crews in Training</h3>
                <div className="training-list">
                  {newCrews.map(crew => {
                    const daysLeft = Math.ceil((crew.readyDate - new Date()) / (24 * 60 * 60 * 1000));
                    const isReady = daysLeft <= 0;
                    return (
                      <div key={crew.id} className={`training-item ${isReady ? 'ready' : ''}`}>
                        <span className="crew-type">{jobTypes[crew.type]?.name} Crew</span>
                        <span className="status">{isReady ? '✅ Ready' : `${Math.max(0, daysLeft)} days`}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {newSupers.length > 0 && (
              <div>
                <h3>New Site Supervisors in Training</h3>
                <div className="training-list">
                  {newSupers.map(sup => {
                    const daysLeft = Math.ceil((sup.readyDate - new Date()) / (24 * 60 * 60 * 1000));
                    const isReady = daysLeft <= 0;
                    return (
                      <div key={sup.id} className={`training-item ${isReady ? 'ready' : ''}`}>
                        <span className="crew-type">Site Supervisor</span>
                        <span className="status">{isReady ? '✅ Ready' : `${Math.max(0, daysLeft)} days`}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}

        {/* NEW: 6-MONTH FORECAST SECTION */}
        <section className="forecast-section">
          <h2>6-Month Production Forecast</h2>
          {plannedHires.length === 0 ? (
            <p style={{ color: '#666', fontStyle: 'italic' }}>Click "Timeline" in the header to add crew hires and generate forecast</p>
          ) : (
            <div>
              <div style={{ marginBottom: '20px' }}>
                <h3>Planned Hires</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '10px' }}>
                  {plannedHires.map(hire => (
                    <div key={hire.id} style={{ padding: '10px', border: '1px solid #ddd', borderRadius: '5px', backgroundColor: '#f9f9f9' }}>
                      <strong>{hire.quantity}x {hire.jobType || 'Supervisor'}</strong>
                      <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                        Hire: {new Date(hire.hireDate).toLocaleDateString()}<br/>
                        Ready: {new Date(hire.readyDate).toLocaleDateString()}
                      </div>
                      <button
                        style={{ marginTop: '8px', padding: '5px 10px', fontSize: '12px', cursor: 'pointer', backgroundColor: '#ff6b6b', color: 'white', border: 'none', borderRadius: '3px' }}
                        onClick={() => removePlannedHire(hire.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {sixMonthForecast.length > 0 && (
                <div>
                  <h3>Weekly Forecast</h3>
                  <div style={{ overflowX: 'auto', marginTop: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#0F3D2F', color: 'white' }}>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ccc' }}>Week</th>
                          <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #ccc' }}>Pipeline</th>
                          <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #ccc' }}>Prod/Week</th>
                          <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #ccc' }}>Net Change</th>
                          <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #ccc' }}>Crews (S/M)</th>
                          <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #ccc' }}>Revenue</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #ccc' }}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sixMonthForecast.map((week, idx) => (
                          <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#f9f9f9' : 'white', borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '8px' }}>W{week.weekNumber}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{week.pipeline.toLocaleString()}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{week.weeklyOutflow.toLocaleString()}</td>
                            <td style={{ padding: '8px', textAlign: 'right', color: week.netChange >= 0 ? '#2d6a52' : '#d32f2f' }}>
                              {week.netChange > 0 ? '+' : ''}{week.netChange.toLocaleString()}
                            </td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>{week.activeCrew.shingles}/{week.activeCrew.metal}</td>
                            <td style={{ padding: '8px', textAlign: 'right' }}>${(week.totalRevenue / 1000).toFixed(0)}K</td>
                            <td style={{ padding: '8px', fontSize: '11px', color: '#666' }}>{week.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* NEW: FORECAST SNAPSHOTS SECTION */}
        {forecastSnapshots.length > 0 && (
          <section className="snapshots-section">
            <h2>Saved Forecasts</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
              {forecastSnapshots.map(snapshot => (
                <div key={snapshot.id} style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#fafafa' }}>
                  <strong style={{ display: 'block', marginBottom: '5px' }}>{snapshot.name}</strong>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                    {snapshot.timestamp}
                  </div>
                  <button
                    style={{ width: '100%', padding: '8px', marginBottom: '5px', backgroundColor: '#2d6a52', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    onClick={() => loadForecast(snapshot.id)}
                  >
                    Load
                  </button>
                  <button
                    style={{ width: '100%', padding: '8px', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                    onClick={() => {
                      setForecastSnapshots(forecastSnapshots.filter(s => s.id !== snapshot.id));
                      localStorage.setItem('skyright_forecasts', JSON.stringify(forecastSnapshots.filter(s => s.id !== snapshot.id)));
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* MODALS */}

      {/* Timeline Builder Modal */}
      {showTimelineModal && (
        <div className="modal-overlay" onClick={() => setShowTimelineModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Crew Timeline Builder</h3>
              <button className="modal-close" onClick={() => setShowTimelineModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '15px' }}>
                <label>Hire Type</label>
                <select value={newHireType} onChange={(e) => setNewHireType(e.target.value)} style={{ width: '100%', padding: '8px' }}>
                  <option value="crew">Crew</option>
                  <option value="supervisor">Supervisor</option>
                </select>
              </div>

              {newHireType === 'crew' && (
                <div style={{ marginBottom: '15px' }}>
                  <label>Job Type</label>
                  <select value={newHireJobType} onChange={(e) => setNewHireJobType(e.target.value)} style={{ width: '100%', padding: '8px' }}>
                    <option value="shingles">Shingles</option>
                    <option value="metal">Metal</option>
                  </select>
                </div>
              )}

              <div style={{ marginBottom: '15px' }}>
                <label>Hire Date</label>
                <input type="date" value={newHireDate} onChange={(e) => setNewHireDate(e.target.value)} style={{ width: '100%', padding: '8px' }} />
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label>Training Period (Weeks)</label>
                <input type="number" value={newHireTrainingWeeks} onChange={(e) => setNewHireTrainingWeeks(Number(e.target.value))} style={{ width: '100%', padding: '8px' }} />
              </div>

              <div style={{ marginBottom: '15px' }}>
                <label>Quantity</label>
                <input type="number" value={newHireQuantity} onChange={(e) => setNewHireQuantity(Number(e.target.value))} min="1" style={{ width: '100%', padding: '8px' }} />
              </div>

              <h4>Planned Hires</h4>
              {plannedHires.length === 0 ? (
                <p style={{ color: '#999' }}>No hires planned yet</p>
              ) : (
                <div style={{ marginBottom: '15px' }}>
                  {plannedHires.map(hire => (
                    <div key={hire.id} style={{ padding: '8px', backgroundColor: '#f0f0f0', marginBottom: '5px', borderRadius: '3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{hire.quantity}x {hire.jobType || 'Supervisor'} - {new Date(hire.hireDate).toLocaleDateString()} → {new Date(hire.readyDate).toLocaleDateString()}</span>
                      <button onClick={() => removePlannedHire(hire.id)} style={{ padding: '3px 8px', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '2px', cursor: 'pointer' }}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowTimelineModal(false)}>Close</button>
              <button className="btn-primary" onClick={addPlannedHire}>Add Hire</button>
            </div>
          </div>
        </div>
      )}

      {/* Save Forecast Modal */}
      {showSaveModal && (
        <div className="modal-overlay" onClick={() => setShowSaveModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Save Forecast</h3>
              <button className="modal-close" onClick={() => setShowSaveModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                placeholder="Forecast name (e.g., 'Q1 Plan', 'Aggressive Hire')"
                value={saveForecastName}
                onChange={(e) => setSaveForecastName(e.target.value)}
                style={{ width: '100%', padding: '10px', marginBottom: '15px' }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSaveModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => saveForecast(saveForecastName)}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Load Forecast Modal */}
      {showLoadModal && (
        <div className="modal-overlay" onClick={() => setShowLoadModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Load Forecast</h3>
              <button className="modal-close" onClick={() => setShowLoadModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              {forecastSnapshots.length === 0 ? (
                <p style={{ color: '#999' }}>No saved forecasts yet</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                  {forecastSnapshots.map(snapshot => (
                    <button
                      key={snapshot.id}
                      onClick={() => loadForecast(snapshot.id)}
                      style={{ padding: '10px', textAlign: 'left', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: '#f9f9f9', cursor: 'pointer', hover: { backgroundColor: '#f0f0f0' } }}
                    >
                      <strong>{snapshot.name}</strong><br/>
                      <small style={{ color: '#666' }}>{snapshot.timestamp}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowLoadModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
