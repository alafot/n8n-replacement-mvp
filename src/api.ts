// HTTP API for triggering and querying runs (B4, B5).
//
//   POST /workflows/run   — trigger a manual run; returns a run identifier
//                           PROMPTLY without waiting for completion (B4).
//   GET  /runs/:id        — query a run by id; reports in-progress | completed
//                           | failed, with the result (standard item format) on
//                           success or error info on failure (B5).

import Fastify from 'fastify';
import { Client, Connection } from '@temporalio/client';
import { runHttpRequest, runGraph } from './workflows';
import type { HttpRequestInput } from './activities';
import type { GraphDefinition } from './graph';
import type { Items } from './itemFormat';
import { ADDRESS, NAMESPACE, TASK_QUEUE } from './temporal';

const PORT = Number(process.env.PORT ?? 3000);

type RunStatus = 'in-progress' | 'completed' | 'failed';

// Map Temporal's workflow execution status to our run-status vocabulary.
// Exactly one of in-progress | completed | failed is ever returned (B5 E1).
function toRunStatus(temporalStatusName: string): RunStatus {
  switch (temporalStatusName) {
    case 'RUNNING':
    case 'CONTINUED_AS_NEW':
      return 'in-progress';
    case 'COMPLETED':
      return 'completed';
    default:
      // FAILED, TIMED_OUT, TERMINATED, CANCELED, ...
      return 'failed';
  }
}

async function buildClient(): Promise<Client> {
  const connection = await Connection.connect({
    address: ADDRESS,
    connectTimeout: 5000,
  });
  await connection.ensureConnected();
  return new Client({ connection, namespace: NAMESPACE });
}

async function main(): Promise<void> {
  const client = await buildClient();
  const app = Fastify({ logger: false });

  // --- B4: trigger a manual run, return a handle promptly. ---
  app.post('/workflows/run', async (request, reply) => {
    const input = (request.body ?? {}) as HttpRequestInput;
    if (!input.url) {
      return reply.code(400).send({ error: 'url is required' });
    }

    const runId = `run-${randomId()}`;
    // start() (not execute()) returns as soon as the run is created — it does
    // NOT wait for completion (B4 E4).
    const handle = await client.workflow.start(runHttpRequest, {
      taskQueue: TASK_QUEUE,
      workflowId: runId,
      args: [input],
    });

    return reply.code(202).send({
      runId: handle.workflowId,
      temporalRunId: handle.firstExecutionRunId,
      status: 'in-progress',
    });
  });

  // --- B6: trigger a multi-step GRAPH run, return a handle promptly. ---
  app.post('/workflows/run-graph', async (request, reply) => {
    const def = (request.body ?? {}) as GraphDefinition;
    if (!Array.isArray(def.nodes) || !def.nodes.length) {
      return reply.code(400).send({ error: 'graph definition must include a non-empty nodes array' });
    }

    const runId = `run-${randomId()}`;
    const handle = await client.workflow.start(runGraph, {
      taskQueue: TASK_QUEUE,
      workflowId: runId,
      args: [def],
    });

    return reply.code(202).send({
      runId: handle.workflowId,
      temporalRunId: handle.firstExecutionRunId,
      status: 'in-progress',
    });
  });

  // --- B5: query a run by id. ---
  app.get<{ Params: { id: string } }>('/runs/:id', async (request, reply) => {
    const { id } = request.params;
    const handle = client.workflow.getHandle(id);

    let description;
    try {
      description = await handle.describe();
    } catch (err: any) {
      return reply.code(404).send({ runId: id, error: `no such run: ${err?.message ?? err}` });
    }

    const status = toRunStatus(description.status.name);

    if (status === 'in-progress') {
      return reply.send({ runId: id, status });
    }

    if (status === 'completed') {
      // Fetch the workflow's return value — the run's result in standard item format.
      const result = (await handle.result()) as Items;
      return reply.send({ runId: id, status, result });
    }

    // failed: surface error information describing the failure (B5 E4).
    try {
      await handle.result();
    } catch (err) {
      return reply.send({
        runId: id,
        status,
        error: {
          type: description.status.name,
          // Walk the failure cause chain so the REAL underlying error
          // (e.g. the fetch/connection error) is surfaced, not just the
          // generic top-level "Activity task failed".
          message: describeFailure(err),
          chain: failureChain(err),
        },
      });
    }
    return reply.send({ runId: id, status, error: { type: description.status.name, message: 'unknown failure' } });
  });

  app.get('/health', async () => ({ ok: true, taskQueue: TASK_QUEUE, namespace: NAMESPACE }));

  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`[api] listening on http://127.0.0.1:${PORT} (temporal=${ADDRESS}, namespace='${NAMESPACE}', queue='${TASK_QUEUE}')`);
}

/** Collect every message in a Temporal failure's `.cause` chain. */
function failureChain(err: unknown): string[] {
  const messages: string[] = [];
  let cur: any = err;
  const seen = new Set<unknown>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur.message) messages.push(String(cur.message));
    cur = cur.cause;
  }
  return messages;
}

/** The deepest (most specific) message in the failure chain. */
function describeFailure(err: unknown): string {
  const chain = failureChain(err);
  return chain.length ? chain[chain.length - 1] : String(err);
}

function randomId(): string {
  // Node built-in; avoids an extra dependency.
  return require('crypto').randomUUID();
}

main().catch((err) => {
  console.error(`[api] FATAL: ${err?.message ?? err}`);
  process.exitCode = 1;
});
