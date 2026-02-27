# Skyright Roofing - Simple Production Forecaster

A focused, practical tool for roofing production forecasting with key metrics and pipeline management.

## Features

✅ **Dashboard Metrics:**
- Lead Time (Weeks) By Job Type
- Current Production Rate Per Week (SQS) By Type
- Weeks Until Production Ramp Up By Type
- Revenue In Pipeline (Total/Weekly) By Type
- Active Crews By Type
- Active Site Supers

✅ **Data Input Section:**
- SQS Waiting To Be Installed
- Weekly Sales Forecast (SQS)
- Current Crews By Type
- Current Site Supers
- Training Cycle In Weeks
- SQS Per Crew (Weekly) By Type

✅ **Smart Pipeline Calculation:**
- Rolling total: Pipeline + Sales - Production
- 30-day training baseline for new crews/supers
- Ramp-up tracking (new staff excluded until trained)
- Real-time metric updates

## Quick Start

```bash
cd /tmp/skyright-simple-forecaster
npm install
npm run dev
```

Access at: **http://localhost:5173**

## What You Get

A clean, simple interface that:
1. Shows current production metrics
2. Lets you input key business data
3. Tracks pipeline automatically
4. Manages crew training schedules
5. Updates metrics in real-time
