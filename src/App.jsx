import React, { useState, useEffect } from 'react';
import './App.css';

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

  // Check if training is complete
  const getReadyCrews = (type) => {
    return newCrews.filter(c => c.type === type && new Date() >= c.readyDate).length;
  };

  const getReadySupers = () => {
    return newSupers.filter(s => new Date() >= s.readyDate).length;
  };

  // Check if a job type can run (has crew leads)
  const canRunJobType = (jobTypeKey) => {
    const type = jobTypes[jobTypeKey];
    const totalCrewLeads = type.crewLeads + getReadySupers();

    if (type.requiresCrewLead && totalCrewLeads === 0) {
      return { canRun: false, warning: true };
    }
    return { canRun: true, warning: false };
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
      </div>
    </div>
  );
}
