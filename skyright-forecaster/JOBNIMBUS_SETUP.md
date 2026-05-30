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
| `JOBNIMBUS_PIPELINE_STATUSES` | No | Comma-separated JobNimbus status names that count as firm (sold) pipeline (e.g. `Sold,In Production`). When unset, all jobs are included. |
| `JOBNIMBUS_ROOF_SQUARES_FIELDS` | No | Comma-separated field names to read roof squares from, tried in order. Defaults to `# Of SQS,roof_squares,Roof Squares,squares,Squares,sqs,SQs`. The Summit account stores this on the **Work Order** field `# Of SQS`. |
| `JOBNIMBUS_TYPE_FIELDS` | No | Comma-separated job fields inspected when classifying metal vs. shingle. Defaults to `What Material?,record_type_name,status_name,name,display_name`. The Summit account uses the **Job** field `What Material?`. |
| `JOBNIMBUS_METAL_KEYWORDS` | No | Comma-separated substrings that mark a metal job. Defaults to `metal`. |
| `JOBNIMBUS_SHINGLE_KEYWORDS` | No | Comma-separated substrings that mark a shingle job. Defaults to `shingle`. |
| `JOBNIMBUS_ESTIMATING_STATUSES` | No | Comma-separated status names treated as estimating (pre-sold). Defaults to `estimating`. |
| `JOBNIMBUS_ESTIMATING_CLOSE_RATE` | No | Close-rate weighting applied to estimating-stage squares. Defaults to `0.35` (35%). |
| `JOBNIMBUS_ESTIMATING_DEFAULT_SQS` | No | Assumed roof size (squares) for estimating jobs with no measured squares yet. Defaults to `30`. |

### Summit Exteriors values

For the Summit account, the only required variable is the API key:

```
JOBNIMBUS_API_KEY=<your key>
```

The code defaults now match the Summit account:
- **Firm/sold pipeline** (full squares): `Signed Contract`, `Sent To Production`, `T/O to Production`, `Long Term Schedule`
- **Estimating** (weighted 35% × 30 SQS default): `Contract Sent`
- **Squares field**: `# Of SQS` (Work Order) · **Material field**: `What Material?` (Job)
- **Close rate** 0.35 · **default roof size** 30 SQS

Override any of them with the matching env var (e.g. `JOBNIMBUS_PIPELINE_STATUSES`, `JOBNIMBUS_ESTIMATING_STATUSES`). Set `JOBNIMBUS_PIPELINE_STATUSES=*` to include **all** jobs regardless of status. Adjust `JOBNIMBUS_METAL_KEYWORDS` / `JOBNIMBUS_SHINGLE_KEYWORDS` if your "What Material?" values use words other than "metal" / "shingle".

### Diagnosing

Use the **Run Diagnostic** button on the JobNimbus Setup tab (or `GET /api/jobnimbus/debug`) to see status-name counts, how many jobs classify as metal/shingle, how often `What Material?` is populated, and the record-type distribution.

> **Roof squares live on Work Orders.** The integration fetches `/workorders` in addition to `/jobs` and joins each work order's `# Of SQS` back to its parent job. If work orders can't be read, jobs still sync and fall back to the default roof size.

> **Tuning is config-only — no code change needed.** The mapping and weighting logic is covered by unit tests (`src/__tests__/jobNimbus.test.ts`).

## 3. Use it

- **JobNimbus Setup** tab — check connection status and trigger a manual job sync.
- **Sales Forecast** tab — shows the live weighted JobNimbus pipeline and a
  "Push to Sales Forecast" button.
- **Pipeline** tab — shows live roofing SQs by type from JobNimbus.

## How jobs are interpreted

- **Job type** (metal vs. shingle) comes from the `What Material?` job field
  (then record type / status / name as fallbacks). Jobs that match neither
  keyword are excluded from the weighted pipeline.
- **Roof squares** come from the `# Of SQS` Work Order field, joined to the job.
  When none are present, the default roof size is used and flagged *est.*
- **Estimating-stage jobs** (status in `JOBNIMBUS_ESTIMATING_STATUSES`) are
  speculative, so their squares are weighted: `default roof size × close rate`
  (e.g. 30 SQS × 35% = 10.5 expected SQS), or `measured squares × close rate`
  if a work order already has them. Their material is still read from
  `What Material?`, so they land in the correct shingle/metal bucket. They show
  in the forecast with an **Estimating** badge.
- **Sold / In Production jobs** count their full measured squares.
- **Weighted value / SQs** apply per-SQ pricing from `businessConstants`.

API endpoints (all require auth):

- `GET /api/jobnimbus/status`
- `GET /api/jobnimbus/pipeline-summary`
- `POST /api/jobnimbus/sync`
