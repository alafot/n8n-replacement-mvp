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
data, Branch on a condition, Route by rules (Switch), Run a code snippet);
clicking one places a step of the matching engine type on the canvas. The Switch
step does multi-way per-item routing: configure a set of rules (each routes
matching items to its own output), with an optional fallback output for items
matching no rule. The Filter step keeps only the items matching a condition on a
single narrowed output (non-matching items are dropped). The Merge step combines
items from multiple incoming branches into one output (appended). The Loop Over
Items step iterates its input in batches (configurable batch size): the loop-body
output runs once per batch, and the done output runs once after the final batch
with the accumulated results. The Wait step pauses the run for a configured
duration (durable timer), then passes its items through unchanged. The No
Operation step is a true pass-through (items go straight through unchanged). The
Stop and Error step deliberately fails the run with a custom message when
reached, aborting downstream. The Execute Sub-workflow step runs another saved
automation as a single step, feeding it the parent's items and returning its
results into the parent. The Aggregate step collapses a chosen field's values
from many items into a single item carrying the collected array. The Split Out
step is the inverse: it expands an item's list field into one item per element.
The Sort step reorders items by a chosen field, ascending or descending. The
Limit step caps how many items pass through (keep first or last N). The Remove
Duplicates step keeps only distinct items (by a key field or whole item). The
Rename Keys step renames fields (old → new) while preserving values and other
fields. The Date & Time step performs a date operation (add/subtract a span, or
format) and writes the result onto each item. The Summarize step computes
summary statistics (sum/count/avg/min/max) over items, optionally grouped by a
field. The Compare Datasets step takes two inputs (A and B) and a key, splitting
items into matched / only-in-A / only-in-B on three distinct outputs. The
Schedule trigger is an entry-point step that fires real runs on a configured
interval (`POST /definitions/:id/schedule/start` | `/stop`, or the Start/Stop
buttons in its config). The Webhook trigger is an entry-point step that fires a
run carrying the request payload when an HTTP request hits its path — send a
request to `/webhook/<path>` (the automation must be saved). The Respond to
Webhook step (used downstream of a Webhook trigger) sends a custom HTTP status +
body back to the caller, so the webhook request returns the automation's result.
The Form trigger is an entry-point step that serves a web form at `/form/<path>`;
submitting it starts a run carrying the entered values (the automation must be
saved). The Error trigger is an entry-point step that links to a target
automation and runs automatically (with the failure details) when a run of that
target fails.

From the canvas you can: add steps from the palette (click to add, or **drag a
palette entry onto the canvas to drop it at a chosen location**), wire them together by
**dragging** from a step's output handle and releasing on a target step (drop
anywhere on its body — for a branch step, drag from its T / F handle to choose
the true/false route), **drag a step to reposition** it (its connections follow
and the position is saved), select a step to configure its parameters, **Save**
the automation (stored durably), reopen it later (`/?def=<id>`), and **Run** it
with a single click — watching each step's status update live and inspecting any
step's output. **Delete** a step via the × on the node — it asks for
confirmation first, and confirming removes the step and all its connections.

Driven-browser checks (require Google Chrome installed; each writes screenshots
to `SHOT_DIR` and exits non-zero on any failed assertion):

```
SHOT_DIR=/tmp npm run e2e:canvas    # canvas loads; palette places matching steps
SHOT_DIR=/tmp npm run e2e:builder   # connect/disconnect, branch ports, config, save & reload in a fresh session
SHOT_DIR=/tmp npm run e2e:run       # run from canvas; live status; skipped branch; inspect output
SHOT_DIR=/tmp npm run e2e:import    # import a genuine n8n export; mapped steps/connections/config; runnable
```

## Importing an n8n workflow (Iteration 3)

Click **Import n8n…** in the builder and choose a genuine n8n workflow export
(`examples/n8n-export.json` is a sample using supported node types). The steps,
connections (including branch true/false routes), and per-step settings are
mapped onto the canvas as equivalent supported steps, ready to edit and run.

The mapping is also available as an API: `POST /import/n8n` with the n8n export
as the body returns `{ name, graph, unsupported }`. An imported automation runs
on the engine like any other (per-step status incl. `skipped`). If the export
contains unsupported node types, they are listed (not silently dropped) and the
supported remainder is imported.

**Export** the current automation back to n8n-compatible JSON with the **Export
n8n** button (or `POST /export/n8n` with `{ name, graph }`). It round-trips:
re-importing an exported file reproduces the same steps, wiring, and config.

## Run history (Iteration 4)

Every run is recorded in durable storage (the automation's name, when it ran,
and its outcome). Click **History** in the builder to see past runs, or
`GET /history`. Outcomes are `completed` / `failed` / `cancelled` / `running`;
`POST /runs/:id/cancel` stops an in-flight run (recorded as `cancelled`). The
history survives engine restarts (it is held in the same on-disk store as
definitions, independent of the workflow service).

Click a history entry to **inspect** that run per step — each step's input,
output, and (for failures) the underlying error cause — served from the durably
persisted run record, so finished runs stay inspectable even after a restart.
**Re-run** a past run (`POST /runs/:id/rerun`) to start a fresh run of the same
automation as it was; it appears as a distinct new history entry beside the
original.

## Configuration

- `TEMPORAL_ADDRESS` (default `localhost:7233`)
- `TEMPORAL_NAMESPACE` (default `default`)
- `PORT` for the API (default `3000`)

## Failure mode

If the Temporal dev server is **not** running, the worker and API fail loudly
and exit non-zero within ~5s (clear `FATAL` message) — they never report a
hollow "connected/ready".
