# JobNimbus Integration Setup

The app reads Jobs from JobNimbus to populate the weighted sales pipeline and to
sync jobs into the local `jobs` table. It replaces the previous HubSpot
integration.

## 1. Generate an API key

In JobNimbus go to **Settings → API** and create a new API key with read access
to **Jobs**.

## 2. Configure the backend

Set these environment variables on the backend (Railway, `.env`, etc.):

| Variable | Required | Description |
| --- | --- | --- |
| `JOBNIMBUS_API_KEY` | Yes | API key from JobNimbus settings. |
| `JOBNIMBUS_API_BASE` | No | API base URL. Defaults to `https://app.jobnimbus.com/api1`. |
| `JOBNIMBUS_PIPELINE_STATUSES` | No | Comma-separated list of JobNimbus status names that count as the active sales pipeline (e.g. `Contract Signed,Estimating`). When unset, all jobs are included. |
| `JOBNIMBUS_ROOF_SQUARES_FIELDS` | No | Comma-separated field names to read roof squares from, tried in order. Defaults to `roof_squares,Roof Squares,squares,Squares,sqs,SQs`. Set this to your account's exact custom-field name. |
| `JOBNIMBUS_TYPE_FIELDS` | No | Comma-separated job fields inspected when classifying metal vs. shingle. Defaults to `record_type_name,status_name,name,display_name`. |
| `JOBNIMBUS_METAL_KEYWORDS` | No | Comma-separated substrings that mark a metal job. Defaults to `metal`. |
| `JOBNIMBUS_SHINGLE_KEYWORDS` | No | Comma-separated substrings that mark a shingle job. Defaults to `shingle`. |

> **Tuning to your account:** field and status names differ per JobNimbus account. Once you know your exact roof-squares custom-field name, job-type field, and pipeline status names, set the variables above — **no code change is needed**. The mapping logic is covered by unit tests (`src/__tests__/jobNimbus.test.ts`).

## 3. Use it

- **JobNimbus Setup** tab — check connection status and trigger a manual job sync.
- **Sales Forecast** tab — shows the live weighted JobNimbus pipeline and a
  "Push to Sales Forecast" button.
- **Pipeline** tab — shows live roofing SQs by type from JobNimbus.

## How jobs are interpreted

- **Job type** (metal vs. shingle) is inferred from the job's record type /
  status / name text (looks for "metal" or "shingle"). Jobs that match neither
  are excluded from the weighted pipeline.
- **Roof squares** are read from common custom-field names (`roof_squares`,
  `Roof Squares`, `squares`, `sqs`). When none are present, a 30 SQ default is
  used and flagged with an *est.* label.
- **Weighted value / SQs** apply the configured closing rate (40%) and per-SQ
  pricing from `businessConstants`.

API endpoints (all require auth):

- `GET /api/jobnimbus/status`
- `GET /api/jobnimbus/pipeline-summary`
- `POST /api/jobnimbus/sync`
