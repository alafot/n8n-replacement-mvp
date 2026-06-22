// Engine worker — Iteration 0 (B1).
//
// Connects to a local Temporal dev server and polls the 'engine' task queue.
// Behaviour contract (the expectations this satisfies):
//   E1 — reports a SUCCESSFUL connection, naming the target (address + namespace).
//   E2 — reports that it is polling the task queue named exactly 'engine'.
//   E3 — stays up and keeps polling until told to stop (SIGINT/SIGTERM).
//   E4 — if the server is unreachable, fails LOUDLY (clear error + non-zero exit)
//        rather than printing a hollow "connected" message or hanging silently.

import { NativeConnection, Worker } from '@temporalio/worker';
import { Connection } from '@temporalio/client';
import * as path from 'path';

const TASK_QUEUE = 'engine';
const ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'default';
// How long we wait for the server before declaring it unreachable (E4).
const CONNECT_TIMEOUT_MS = 5000;

function log(msg: string): void {
  console.log(`[engine-worker] ${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  // --- Actively verify connectivity to the dev server (drives E1 and E4). ---
  // We use a client Connection with an explicit timeout and probe the server
  // with getSystemInfo so a SUCCESS log genuinely means we reached the server,
  // and an unreachable server produces a loud, immediate failure.
  log(`connecting to Temporal dev server at ${ADDRESS} (namespace='${NAMESPACE}', timeout=${CONNECT_TIMEOUT_MS}ms)...`);

  const probe = await Connection.connect({
    address: ADDRESS,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  // ensureConnected + a real RPC: proves the server actually answered.
  await probe.ensureConnected();
  const info = await probe.workflowService.getSystemInfo({});
  log(
    `CONNECTED OK to Temporal dev server at ${ADDRESS} ` +
      `(namespace='${NAMESPACE}', serverVersion='${info.serverVersion}')`,
  );
  await probe.close();

  // --- Build the worker's native connection on the same address. ---
  const connection = await NativeConnection.connect({ address: ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.join(__dirname, 'workflows.ts'),
  });

  log(`polling task queue '${TASK_QUEUE}' (namespace='${NAMESPACE}', address=${ADDRESS})`);
  log('worker is RUNNING — press Ctrl+C to stop');

  // worker.run() blocks until the worker is shut down; this keeps the
  // process alive and continuously polling (E3).
  await worker.run();

  log('worker shut down cleanly');
  await connection.close();
}

main().catch((err) => {
  // E4: any connection/startup failure is surfaced loudly and exits non-zero.
  console.error(
    `[engine-worker] FATAL: failed to start against ${ADDRESS} (namespace='${NAMESPACE}'): ${
      err?.message ?? err
    }`,
  );
  process.exitCode = 1;
});
