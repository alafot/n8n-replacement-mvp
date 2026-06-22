// Engine worker — Iteration 0 (B1).
//
// Connects to the local durable workflow service (Temporal) and stands ready to
// pick up workflow work on the 'engine' task queue.
//   E1 — establishes and CONFIRMS a working connection, naming the target.
//   E2 — reports readiness and begins listening for work on the 'engine' queue.
//   E3 — stays up and keeps polling until told to stop (SIGINT/SIGTERM).
//   E4 — if the service is unreachable, fails LOUDLY (clear error + non-zero exit).

import { NativeConnection, Worker } from '@temporalio/worker';
import { Connection } from '@temporalio/client';
import * as path from 'path';
import * as activities from './activities';
import { ADDRESS, NAMESPACE, TASK_QUEUE } from './temporal';

const CONNECT_TIMEOUT_MS = 5000;

function log(msg: string): void {
  console.log(`[engine] ${new Date().toISOString()} ${msg}`);
}

async function main(): Promise<void> {
  // --- Actively verify connectivity (drives E1 and E4). ---
  log(`connecting to durable workflow service at ${ADDRESS} (namespace='${NAMESPACE}', timeout=${CONNECT_TIMEOUT_MS}ms)...`);

  const probe = await Connection.connect({
    address: ADDRESS,
    connectTimeout: CONNECT_TIMEOUT_MS,
  });
  await probe.ensureConnected();
  const info = await probe.workflowService.getSystemInfo({});
  log(
    `CONNECTED OK to durable workflow service at ${ADDRESS} ` +
      `(namespace='${NAMESPACE}', serverVersion='${info.serverVersion}')`,
  );
  await probe.close();

  // --- Build the worker and begin listening for work. ---
  const connection = await NativeConnection.connect({ address: ADDRESS });

  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.join(__dirname, 'workflows.ts'),
    activities,
  });

  log(`READY — listening for work on task queue '${TASK_QUEUE}' (namespace='${NAMESPACE}', address=${ADDRESS})`);
  log('engine is RUNNING — press Ctrl+C to stop');

  // Blocks until shutdown; keeps the process alive and polling (E3).
  await worker.run();

  log('engine shut down cleanly');
  await connection.close();
}

main().catch((err) => {
  // E4: any connection/startup failure is surfaced loudly and exits non-zero.
  console.error(
    `[engine] FATAL: failed to start against ${ADDRESS} (namespace='${NAMESPACE}'): ${
      err?.message ?? err
    }`,
  );
  process.exitCode = 1;
});
