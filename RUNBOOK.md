# Operator Runbook — Iteration 0 Walking Skeleton

A durable workflow engine on Temporal: trigger a manual run of a single
HTTP-request step, then query the run to completion. Run every command from the
repository root.

Components:

- **Temporal dev server** — the durable workflow service (local).
- **Engine worker** (`src/worker.ts`) — connects to Temporal, polls the
  `engine` task queue, executes workflows/activities.
- **API** (`src/api.ts`) — `POST /workflows/run` to trigger, `GET /runs/:id` to query.
- **Test endpoint** (`scripts/test-endpoint.mjs`) — a local HTTP server so the
  demo needs no public internet (optional; you can target any URL).

## Prerequisites (one-time)

- **Node.js** ≥ 18 (developed on v22). Check: `node --version`
- **Temporal CLI** (bundles a local dev server). macOS: `brew install temporal`.
  Check: `temporal --version`

## Step 1 — Install dependencies

```
npm install
```

## Step 2 — Start the Temporal dev server (Terminal A)

```
temporal server start-dev
```

Server on `localhost:7233`, Web UI on <http://localhost:8233>. Leave running.

## Step 3 — Start the engine worker (Terminal B)

```
npm run worker
```

Expect: `CONNECTED OK …`, then `READY — listening for work on task queue 'engine' …`,
then `engine is RUNNING`. The worker stays up and polls until `Ctrl+C`.

## Step 4 — Start the API (Terminal C)

```
npm run api
```

Expect: `[api] listening on http://127.0.0.1:3000 …`.

## Step 5 (optional) — Start the local test endpoint (Terminal D)

```
npm run test-endpoint
```

Listens on `http://127.0.0.1:4555` with routes: `/json`, `/html`,
`/echo`, `/status/:code`, `/delay/:ms`.

## Step 6 — Trigger a run and query it to completion (Terminal E)

Trigger (returns immediately with a run id — does NOT wait for completion):

```
curl -s -X POST http://127.0.0.1:3000/workflows/run \
  -H 'content-type: application/json' \
  -d '{"method":"GET","url":"http://127.0.0.1:4555/json"}'
# -> {"runId":"run-…","temporalRunId":"…","status":"in-progress"}
```

Query the run by its id:

```
curl -s http://127.0.0.1:3000/runs/<runId>
```

- While executing: `{"runId":"…","status":"in-progress"}`
- On success: `{"runId":"…","status":"completed","result":[ … ]}` where `result`
  is the run's output in the **standard item format** (array of
  `{ json, binary }`), carrying `statusCode`, `ok`, `headers`, and `body`.
- On failure: `{"runId":"…","status":"failed","error":{ "message": "…", "chain":[…] }}`.

To observe **progression** (in-progress → completed), trigger a slow run and
query twice:

```
RID=$(curl -s -X POST http://127.0.0.1:3000/workflows/run -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:4555/delay/4000"}' | sed -E 's/.*"runId":"([^"]+)".*/\1/')
curl -s http://127.0.0.1:3000/runs/$RID    # in-progress
sleep 5
curl -s http://127.0.0.1:3000/runs/$RID    # completed + result
```

## Inspecting runs (durability)

Runs are durable and inspectable in the engine:

```
temporal workflow list --query "WorkflowType='runHttpRequest'"
temporal workflow describe -w <runId>
```

…or in the Web UI at <http://localhost:8233>.

## Visual canvas (Iteration 2)

With the API running (Step 4), open the workflow builder in a browser:

```
open http://127.0.0.1:3000/
```

The left palette lists the available step types (Call a web service, Reshape
data, Branch on a condition, Run a code snippet); clicking one places a step of
the matching engine type on the canvas.

Driven-browser check (loads the page in Chrome, adds one of each type, asserts
the placed nodes match):

```
SHOT_DIR=/tmp npm run e2e:canvas
```

It writes `canvas-empty.png` and `canvas-four-nodes.png` to `SHOT_DIR` and exits
non-zero on any failed assertion. Requires Google Chrome installed.

## Configuration

- `TEMPORAL_ADDRESS` (default `localhost:7233`)
- `TEMPORAL_NAMESPACE` (default `default`)
- `PORT` for the API (default `3000`)

## Failure mode

If the Temporal dev server is **not** running, the worker and API fail loudly
and exit non-zero within ~5s (clear `FATAL` message) — they never report a
hollow "connected/ready".
