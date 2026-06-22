// HTTP API for triggering and querying runs (B4, B5).
//
//   POST /workflows/run   — trigger a manual run; returns a run identifier
//                           PROMPTLY without waiting for completion (B4).
//   GET  /runs/:id        — query a run by id; reports in-progress | completed
//                           | failed, with the result (standard item format) on
//                           success or error info on failure (B5).

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import { Client, Connection } from '@temporalio/client';
import { runHttpRequest, runGraph, getStepsQuery } from './workflows';
import type { HttpRequestInput } from './activities';
import type { GraphDefinition } from './graph';
import {
  createDefinition,
  getDefinition,
  listDefinitions,
  updateDefinition,
  deleteDefinition,
} from './store';
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

  // Tolerate an empty body on application/json POSTs (e.g. triggering a stored
  // run takes no payload) — treat empty as {} instead of erroring.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string).trim();
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(err as Error);
    }
  });

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

  // --- B10: CRUD for stored workflow definitions (persisted in SQLite). ---
  app.post('/definitions', async (request, reply) => {
    const { name, graph } = (request.body ?? {}) as { name?: string; graph?: GraphDefinition };
    if (!name || !graph || !Array.isArray(graph.nodes)) {
      return reply.code(400).send({ error: 'name and graph{nodes,connections} are required' });
    }
    const id = `def-${randomId()}`;
    const created = createDefinition(id, name, graph);
    return reply.code(201).send(created);
  });

  app.get('/definitions', async () => listDefinitions());

  app.get<{ Params: { id: string } }>('/definitions/:id', async (request, reply) => {
    const def = getDefinition(request.params.id);
    if (!def) return reply.code(404).send({ error: `no such definition: ${request.params.id}` });
    return def;
  });

  app.put<{ Params: { id: string } }>('/definitions/:id', async (request, reply) => {
    const { name, graph } = (request.body ?? {}) as { name?: string; graph?: GraphDefinition };
    if (!name || !graph) return reply.code(400).send({ error: 'name and graph are required' });
    const updated = updateDefinition(request.params.id, name, graph);
    if (!updated) return reply.code(404).send({ error: `no such definition: ${request.params.id}` });
    return updated;
  });

  app.delete<{ Params: { id: string } }>('/definitions/:id', async (request, reply) => {
    const ok = deleteDefinition(request.params.id);
    if (!ok) return reply.code(404).send({ error: `no such definition: ${request.params.id}` });
    return reply.code(200).send({ deleted: request.params.id });
  });

  // --- B11: trigger a run of a STORED definition by reference. ---
  app.post<{ Params: { id: string } }>('/definitions/:id/run', async (request, reply) => {
    const def = getDefinition(request.params.id);
    if (!def) return reply.code(404).send({ error: `no such definition: ${request.params.id}` });

    const runId = `run-${randomId()}`;
    const handle = await client.workflow.start(runGraph, {
      taskQueue: TASK_QUEUE,
      workflowId: runId,
      args: [def.graph],
    });

    return reply.code(202).send({
      runId: handle.workflowId,
      definitionId: def.id,
      status: 'in-progress',
    });
  });

  // --- B17: per-step status & output for a run, observable during and after. ---
  app.get<{ Params: { id: string } }>('/runs/:id/steps', async (request, reply) => {
    const { id } = request.params;
    const handle = client.workflow.getHandle(id);
    let description;
    try {
      description = await handle.describe();
    } catch (err: any) {
      return reply.code(404).send({ runId: id, error: `no such run: ${err?.message ?? err}` });
    }
    // Query the (running or closed) run for its per-step state.
    const steps = await handle.query(getStepsQuery);
    return reply.send({ runId: id, status: toRunStatus(description.status.name), steps });
  });

  app.get('/health', async () => ({ ok: true, taskQueue: TASK_QUEUE, namespace: NAMESPACE }));

  // --- B12: serve the visual canvas (static frontend) at '/'. ---
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'public'),
    prefix: '/',
  });

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
