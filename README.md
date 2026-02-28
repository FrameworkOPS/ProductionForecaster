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

## Deployment Options

### Option 1: Docker (Recommended)
```bash
docker-compose up -d
```
Access at: **http://localhost:3000**

### Option 2: Netlify (Automatic CI/CD)
GitHub Actions automatically deploys to Netlify on push to main.
Check deployment status at: https://github.com/FrameworkOPS/ProductionForecaster/actions

### Option 3: Vercel
```bash
npm install -g vercel
vercel
```

## Troubleshooting

### Blank Screen on Deployment
**Issue**: App shows blank screen after deployment
**Solution**: The build process automatically includes all assets (logo, CSS, JavaScript)
- Verify logo file exists in `public/assets/skyright-logo.png`
- Clear browser cache (Ctrl+Shift+Delete or Cmd+Shift+Delete)
- Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)

### Browser Console Errors
Check browser Developer Tools (F12) → Console tab for JavaScript errors
- Clear site data: Settings → Privacy → Clear browsing data
- Check that the base URL matches your deployment (e.g., localhost:3000 or production URL)
