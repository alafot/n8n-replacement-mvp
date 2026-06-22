# Operator Runbook — Engine Worker (Iteration 0 / B1)

Concrete, repeatable steps to bring up the local Temporal dev server and start
the engine worker from a clean checkout. Run every command from the repository
root.

## Prerequisites (one-time)

- **Node.js** ≥ 18 (developed on v22). Check: `node --version`
- **Temporal CLI** (bundles a local dev server). Install on macOS:
  ```
  brew install temporal
  ```
  Check: `temporal --version`

## Step 1 — Install project dependencies

```
npm install
```

## Step 2 — Start the local Temporal dev server (Terminal A)

```
temporal server start-dev
```

This starts the server on `localhost:7233` and the Web UI on
<http://localhost:8233>. Leave this terminal running. To use a different port:
`temporal server start-dev --port 7233`.

## Step 3 — Start the engine worker (Terminal B)

```
npm run worker
```

Expected output (in order):

```
[engine-worker] <ts> connecting to Temporal dev server at localhost:7233 (namespace='default', timeout=5000ms)...
[engine-worker] <ts> CONNECTED OK to Temporal dev server at localhost:7233 (namespace='default', serverVersion='...')
[engine-worker] <ts> polling task queue 'engine' (namespace='default', address=localhost:7233)
[engine-worker] <ts> worker is RUNNING — press Ctrl+C to stop
```

The worker now stays up and continuously polls the `engine` task queue. Stop it
with `Ctrl+C`.

## Configuration (optional)

Environment variables override the defaults:

- `TEMPORAL_ADDRESS` — server address (default `localhost:7233`)
- `TEMPORAL_NAMESPACE` — namespace (default `default`)

## Failure mode

If the dev server is **not** running, the worker fails loudly and exits
non-zero within ~5s:

```
[engine-worker] FATAL: failed to start against localhost:7233 (namespace='default'): <connection error>
```

It will never print "CONNECTED OK" unless it actually reached the server.
