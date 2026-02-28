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

  // NEW: Forecast features (Phase 3: Forecaster Redesign)
  const [forecastPeriod, setForecastPeriod] = useState('6-month'); // '3-month', '6-month', '12-month'

  // Sales forecast by job type and week
  const [salesForecast, setSalesForecast] = useState(() => {
    // Initialize with 26 weeks (6 months) of default sales
    const weeks = Array(26).fill(0).map((_, i) => ({
      shingles: 200,
      metal: 120
    }));
    return weeks;
  });

  // Crew hiring plan - enhanced structure
  const [hiringPlan, setHiringPlan] = useState([]);

  // Form states for adding new hires
  const [newHireDate, setNewHireDate] = useState('');
  const [newHireType, setNewHireType] = useState('crew');
  const [newHireJobType, setNewHireJobType] = useState('shingles');
  const [newHireCount, setNewHireCount] = useState(1);
  const [newHireOutputPerWeek, setNewHireOutputPerWeek] = useState(120);
  const [newHireTrainingWeeks, setNewHireTrainingWeeks] = useState(4);

  // Forecast persistence
  const [plannedHires, setPlannedHires] = useState([]); // Keep for backward compatibility
  const [forecastSnapshots, setForecastSnapshots] = useState(() => {
    try {
      const saved = localStorage.getItem('skyright_forecasts');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Modal states
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showHiringModal, setShowHiringModal] = useState(false);
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

  // NEW: Helper function for weighted training ramp-up percentage
  const getTrainingRampPercentage = (trainingWeekNumber, totalTrainingWeeks) => {
    // Standard ramp-up: 10%, 30%, 60%, 90%, 100%
    const standardRamp = [0.10, 0.30, 0.60, 0.90, 1.0];

    if (totalTrainingWeeks <= 0) return 1.0; // Immediate if no training
    if (trainingWeekNumber > totalTrainingWeeks) return 1.0; // Full after training

    if (totalTrainingWeeks >= 5) {
      // Use standard ramp if training is 5+ weeks
      return standardRamp[Math.min(trainingWeekNumber - 1, 4)];
    } else if (totalTrainingWeeks === 4) {
      // 4 week training: use weeks 1-4, then 100%
      return standardRamp[trainingWeekNumber - 1];
    } else if (totalTrainingWeeks === 2) {
      // 2 week training: 50%, 100%
      return trainingWeekNumber === 1 ? 0.5 : 1.0;
    } else if (totalTrainingWeeks === 3) {
      // 3 week training: interpolate
      return [0.25, 0.65, 1.0][trainingWeekNumber - 1] || 1.0;
    }
    // Default: spread the standard ramp across the training period
    const interpolated = (trainingWeekNumber / totalTrainingWeeks) * 0.9 + 0.1;
    return Math.min(interpolated, 1.0);
  };

  // NEW: Add crew hire to hiring plan
  const addHire = () => {
    if (!newHireDate) {
      alert('Please select a hire date');
      return;
    }

    const hireDate = new Date(newHireDate);
    const readyDate = new Date(hireDate);
    readyDate.setDate(readyDate.getDate() + newHireTrainingWeeks * 7);

    const hire = {
      id: Date.now().toString(),
      hireDate,
      type: newHireType,
      jobType: newHireType === 'crew' ? newHireJobType : null,
      count: newHireCount,
      outputPerWeek: newHireType === 'crew' ? newHireOutputPerWeek : null,
      trainingWeeks: newHireTrainingWeeks,
      readyDate
    };

    setHiringPlan([...hiringPlan, hire]);

    // Reset form
    setNewHireDate('');
    setNewHireType('crew');
    setNewHireJobType('shingles');
    setNewHireCount(1);
    setNewHireOutputPerWeek(120);
    setNewHireTrainingWeeks(4);
  };

  // NEW: Remove hire from hiring plan
  const removeHire = (hireId) => {
    setHiringPlan(hiringPlan.filter(h => h.id !== hireId));
  };

  // NEW: Generate 6-month forecast with weighted training ramp-up
  const generateSixMonthForecast = () => {
    const forecast = [];
    let currentPipeline = sqsWaiting;
    const forecastStart = new Date();
    forecastStart.setHours(0, 0, 0, 0);

    for (let week = 0; week < 26; week++) {
      const weekDate = new Date(forecastStart.getTime() + week * 7 * 24 * 60 * 60 * 1000);

      // 1. Get planned sales for this week (from sales forecast table)
      const weekSales = salesForecast[week] || { shingles: 0, metal: 0 };
      const plannedSalesShingles = weekSales.shingles || 0;
      const plannedSalesMetal = weekSales.metal || 0;
      const plannedSalesTotal = plannedSalesShingles + plannedSalesMetal;

      // 2. Calculate existing crew production (static)
      let existingProduction = 0;
      existingProduction += jobTypes.shingles.crews * jobTypes.shingles.sqsPerCrewWeekly;
      existingProduction += jobTypes.metal.crews * jobTypes.metal.sqsPerCrewWeekly;

      // 3. Calculate new crew production with weighted training ramp-up
      let newCrewProduction = 0;
      let trainingNotes = [];

      hiringPlan.forEach(hire => {
        if (hire.type === 'crew') {
          const hireDate = new Date(hire.hireDate);
          if (hireDate <= weekDate) {
            // Calculate days since hire and which training week
            const daysSinceHire = (weekDate - hireDate) / (24 * 60 * 60 * 1000);
            const trainingWeekNumber = Math.ceil(daysSinceHire / 7);

            // Get ramp-up percentage
            const rampPercentage = getTrainingRampPercentage(trainingWeekNumber, hire.trainingWeeks);
            const crewProduction = (hire.outputPerWeek || jobTypes[hire.jobType].sqsPerCrewWeekly) * hire.count * rampPercentage;
            newCrewProduction += crewProduction;

            // Add training note if this is during training
            if (rampPercentage < 1.0) {
              trainingNotes.push(`${hire.jobType}: ${Math.round(rampPercentage * 100)}% productivity`);
            }
          }
        }
      });

      // 4. Calculate total production
      const totalProduction = existingProduction + newCrewProduction;

      // 5. Update pipeline (sales in - production out)
      currentPipeline += plannedSalesTotal - totalProduction;
      currentPipeline = Math.max(0, currentPipeline);

      // 6. Calculate revenue
      let totalRevenue = 0;
      totalRevenue += plannedSalesShingles * (jobTypes.shingles.revenuePerSqs || 0);
      totalRevenue += plannedSalesMetal * (jobTypes.metal.revenuePerSqs || 0);

      // 7. Create notes
      const notes = trainingNotes.length > 0 ? trainingNotes.join(', ') : '';

      forecast.push({
        weekNumber: week,
        weekDate: weekDate.toLocaleDateString(),
        plannedSalesShingles,
        plannedSalesMetal,
        plannedSalesTotal,
        existingProduction: Math.round(existingProduction),
        newCrewProduction: Math.round(newCrewProduction),
        totalProduction: Math.round(totalProduction),
        pipeline: Math.round(currentPipeline),
        netChange: Math.round(plannedSalesTotal - totalProduction),
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
              <div
                className="metric-label"
                title="Weekly pipeline velocity: (Weekly Sales - Weekly Production). Positive = pipeline growing, Negative = pipeline shrinking"
                style={{ cursor: 'help' }}
              >
                Net Weekly Change
              </div>
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
              <label>Current Site Supers/Crew Leads</label>
              <input
                type="number"
                value={siteSupervisors}
                onChange={(e) => setSiteSupervisors(Number(e.target.value))}
              />
              <small style={{ color: '#666', marginTop: '4px' }}>All sales planning and crew hiring happens in the Forecaster section</small>
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

          <p style={{ color: '#666', fontStyle: 'italic', marginTop: '20px' }}>💡 Tip: Add new supervisors in the Forecaster section using the Crew Hiring Plan</p>
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

        {/* FORECASTER SECTION - Complete redesign */}
        <section className="forecast-section">
          <h2>Forecaster - Sales & Crew Planning</h2>

          {/* 1. SALES PLANNING */}
          <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
            <h3>📊 Sales Planning</h3>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ marginRight: '15px', fontWeight: 'bold' }}>Forecast Period:</label>
              <button
                onClick={() => setForecastPeriod('3-month')}
                style={{
                  marginRight: '10px',
                  padding: '8px 15px',
                  backgroundColor: forecastPeriod === '3-month' ? '#0F3D2F' : '#ddd',
                  color: forecastPeriod === '3-month' ? 'white' : 'black',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                3 Months
              </button>
              <button
                onClick={() => setForecastPeriod('6-month')}
                style={{
                  marginRight: '10px',
                  padding: '8px 15px',
                  backgroundColor: forecastPeriod === '6-month' ? '#0F3D2F' : '#ddd',
                  color: forecastPeriod === '6-month' ? 'white' : 'black',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                6 Months
              </button>
              <button
                onClick={() => setForecastPeriod('12-month')}
                style={{
                  padding: '8px 15px',
                  backgroundColor: forecastPeriod === '12-month' ? '#0F3D2F' : '#ddd',
                  color: forecastPeriod === '12-month' ? 'white' : 'black',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                12 Months
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', backgroundColor: 'white' }}>
                <thead>
                  <tr style={{ backgroundColor: '#FF8C00', color: 'white' }}>
                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid #ccc' }}>Week</th>
                    <th style={{ padding: '10px', textAlign: 'center', borderBottom: '2px solid #ccc' }}>Shingles Sales (SQS)</th>
                    <th style={{ padding: '10px', textAlign: 'center', borderBottom: '2px solid #ccc' }}>Metal Sales (SQS)</th>
                  </tr>
                </thead>
                <tbody>
                  {salesForecast.slice(0, forecastPeriod === '3-month' ? 13 : forecastPeriod === '6-month' ? 26 : 52).map((week, idx) => (
                    <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#f9f9f9' : 'white', borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '10px' }}>W{idx}</td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <input
                          type="number"
                          value={week.shingles}
                          onChange={(e) => {
                            const newForecast = [...salesForecast];
                            newForecast[idx] = { ...newForecast[idx], shingles: Number(e.target.value) };
                            setSalesForecast(newForecast);
                          }}
                          style={{ width: '80px', padding: '4px', textAlign: 'center' }}
                        />
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        <input
                          type="number"
                          value={week.metal}
                          onChange={(e) => {
                            const newForecast = [...salesForecast];
                            newForecast[idx] = { ...newForecast[idx], metal: Number(e.target.value) };
                            setSalesForecast(newForecast);
                          }}
                          style={{ width: '80px', padding: '4px', textAlign: 'center' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2. CREW HIRING PLAN */}
          <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
            <h3>👥 Crew Hiring Plan</h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '15px' }}>
              <div>
                <label style={{ fontSize: '12px' }}>Hire Date:</label>
                <input
                  type="date"
                  value={newHireDate}
                  onChange={(e) => setNewHireDate(e.target.value)}
                  style={{ width: '100%', padding: '8px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px' }}>Type:</label>
                <select
                  value={newHireType}
                  onChange={(e) => setNewHireType(e.target.value)}
                  style={{ width: '100%', padding: '8px' }}
                >
                  <option value="crew">Crew</option>
                  <option value="supervisor">Supervisor</option>
                </select>
              </div>
              {newHireType === 'crew' && (
                <div>
                  <label style={{ fontSize: '12px' }}>Job Type:</label>
                  <select
                    value={newHireJobType}
                    onChange={(e) => setNewHireJobType(e.target.value)}
                    style={{ width: '100%', padding: '8px' }}
                  >
                    <option value="shingles">Shingles</option>
                    <option value="metal">Metal</option>
                  </select>
                </div>
              )}
              <div>
                <label style={{ fontSize: '12px' }}>Count:</label>
                <input
                  type="number"
                  value={newHireCount}
                  onChange={(e) => setNewHireCount(Number(e.target.value))}
                  min="1"
                  style={{ width: '100%', padding: '8px' }}
                />
              </div>
              {newHireType === 'crew' && (
                <>
                  <div>
                    <label style={{ fontSize: '12px' }}>Output/Week (SQS):</label>
                    <input
                      type="number"
                      value={newHireOutputPerWeek}
                      onChange={(e) => setNewHireOutputPerWeek(Number(e.target.value))}
                      style={{ width: '100%', padding: '8px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px' }}>Training Weeks:</label>
                    <select
                      value={newHireTrainingWeeks}
                      onChange={(e) => setNewHireTrainingWeeks(Number(e.target.value))}
                      style={{ width: '100%', padding: '8px' }}
                    >
                      <option value="2">2 Weeks</option>
                      <option value="3">3 Weeks</option>
                      <option value="4">4 Weeks</option>
                      <option value="6">6 Weeks</option>
                      <option value="8">8 Weeks</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={addHire}
              style={{
                padding: '10px 20px',
                backgroundColor: '#FF8C00',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold',
                marginBottom: '15px'
              }}
            >
              + Add Hire
            </button>

            {hiringPlan.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', backgroundColor: 'white' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#0F3D2F', color: 'white' }}>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Hire Date</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Type</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Job Type</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Count</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Output/Wk</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Training Wks</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Ready Date</th>
                      <th style={{ padding: '8px', textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hiringPlan.map((hire, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#f9f9f9' : 'white', borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px' }}>{new Date(hire.hireDate).toLocaleDateString()}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{hire.type}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{hire.jobType || '—'}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{hire.count}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{hire.outputPerWeek || '—'}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{hire.trainingWeeks}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>{new Date(hire.readyDate).toLocaleDateString()}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <button
                            onClick={() => removeHire(hire.id)}
                            style={{ padding: '4px 8px', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '11px' }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 3. PRODUCTION FORECAST */}
          <div style={{ padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px' }}>
            <h3>📈 Production Forecast</h3>
            {hiringPlan.length === 0 && salesForecast.every(w => w.shingles === 0 && w.metal === 0) ? (
              <p style={{ color: '#666', fontStyle: 'italic' }}>Add sales plans and crew hires above to generate forecast</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', backgroundColor: 'white' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#0F3D2F', color: 'white' }}>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Week</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Shingles Sale</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Metal Sale</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Existing Prod</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>New Crew Prod</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Total Prod</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Pipeline</th>
                      <th style={{ padding: '8px', textAlign: 'right' }}>Revenue</th>
                      <th style={{ padding: '8px', textAlign: 'left' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generateSixMonthForecast().map((week, idx) => (
                      <tr key={idx} style={{ backgroundColor: idx % 2 === 0 ? '#f9f9f9' : 'white', borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px' }}>W{week.weekNumber}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{week.plannedSalesShingles}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{week.plannedSalesMetal}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{week.existingProduction}</td>
                        <td style={{ padding: '8px', textAlign: 'right', color: '#FF8C00' }}>{week.newCrewProduction}</td>
                        <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold' }}>{week.totalProduction}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>{week.pipeline.toLocaleString()}</td>
                        <td style={{ padding: '8px', textAlign: 'right' }}>${(week.totalRevenue / 1000).toFixed(1)}K</td>
                        <td style={{ padding: '8px', fontSize: '10px', color: '#666' }}>{week.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
