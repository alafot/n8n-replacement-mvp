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
  recordRunStart,
  updateRunOutcome,
  listRuns,
  getRun,
  RunOutcome,
} from './store';
import { importN8nWorkflow, N8nExport } from './importN8n';
import { exportToN8n } from './exportN8n';
import type { GraphDefinition as GraphDef } from './graph';
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
  // Resolve Execute Sub-workflow references to the referenced saved definition's
  // graph, embedding it so the engine can run it inline (B39). Recurses so a
  // sub-workflow may itself reference others; depth-guarded against cycles.
  const resolveSubworkflows = (graph: GraphDef, depth = 0): GraphDef => {
    const clone: GraphDef = JSON.parse(JSON.stringify(graph));
    if (depth > 10) return clone;
    for (const node of clone.nodes as any[]) {
      if (node.type === 'executeSubworkflow' && node.params && node.params.definitionId) {
        const def = getDefinition(node.params.definitionId);
        if (def && def.graph) node.params.subGraph = resolveSubworkflows(def.graph as GraphDef, depth + 1);
      }
    }
    return clone;
  };

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
    const body = (request.body ?? {}) as any;
    // Body may be the graph itself ({nodes,connections}) optionally carrying a
    // `name`, or a { name, graph } wrapper.
    const def = (Array.isArray(body.nodes) ? body : body.graph ?? {}) as GraphDefinition;
    const name = (body.name as string) ?? 'Untitled automation';
    if (!Array.isArray(def.nodes) || !def.nodes.length) {
      return reply.code(400).send({ error: 'graph definition must include a non-empty nodes array' });
    }

    const runId = `run-${randomId()}`;
    const handle = await client.workflow.start(runGraph, {
      taskQueue: TASK_QUEUE,
      workflowId: runId,
      args: [resolveSubworkflows(def)],
    });
    recordRunStart({ runId, automationName: name, startedAt: new Date().toISOString(), graph: def });

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
      args: [resolveSubworkflows(def.graph as GraphDef)],
    });
    recordRunStart({ runId, automationName: def.name, automationId: def.id, startedAt: new Date().toISOString(), graph: def.graph });
    attachFailureWatch(runId, def.id);

    return reply.code(202).send({
      runId: handle.workflowId,
      definitionId: def.id,
      status: 'in-progress',
    });
  });

  // --- B19: import a genuine n8n workflow export -> engine graph. ---
  app.post('/import/n8n', async (request, reply) => {
    try {
      const imported = importN8nWorkflow(request.body as N8nExport);
      return reply.code(200).send(imported);
    } catch (err: any) {
      return reply.code(400).send({ error: String(err?.message ?? err) });
    }
  });

  // Start a real durable run of a graph and record it in history.
  const startGraphRun = async (graph: GraphDef, name: string, definitionId: string | null) => {
    const runId = `run-${randomId()}`;
    await client.workflow.start(runGraph, { taskQueue: TASK_QUEUE, workflowId: runId, args: [resolveSubworkflows(graph)] });
    recordRunStart({ runId, automationName: name, automationId: definitionId, startedAt: new Date().toISOString(), graph });
    attachFailureWatch(runId, definitionId);
    return runId;
  };

  // --- B53: Error Trigger — when a run of a target automation fails, auto-fire
  // any error-handler automation whose Error Trigger is linked to that target. ---
  const attachFailureWatch = (runId: string, automationId: string | null) => {
    client.workflow
      .getHandle(runId)
      .result()
      .then(
        () => {},
        async (err: any) => {
          await refreshRun(runId).catch(() => {});
          if (!automationId) return;
          const message = describeFailure(err);
          for (const { id } of listDefinitions()) {
            const handler = getDefinition(id);
            const et = handler && (handler.graph.nodes as any[]).find((n) => n.type === 'errorTrigger' && n.params?.targetDefinitionId === automationId);
            if (!handler || !et) continue;
            const graph = JSON.parse(JSON.stringify(handler.graph));
            const e = (graph.nodes as any[]).find((n) => n.type === 'errorTrigger' && n.params?.targetDefinitionId === automationId);
            e.params._payload = { failedAutomationId: automationId, failedRunId: runId, error: message };
            await startGraphRun(graph as GraphDef, handler.name, handler.id).catch(() => {});
          }
        },
      );
  };

  // --- B49: Schedule trigger — fire real runs on the configured interval. ---
  const schedules = new Map<string, { handle: ReturnType<typeof setInterval>; ms: number }>();
  app.post<{ Params: { id: string } }>('/definitions/:id/schedule/start', async (request, reply) => {
    const def = getDefinition(request.params.id);
    if (!def) return reply.code(404).send({ error: `no such definition: ${request.params.id}` });
    const trig = (def.graph.nodes as any[]).find((n) => n.type === 'scheduleTrigger');
    if (!trig) return reply.code(409).send({ error: 'automation has no schedule trigger' });
    const ms = Math.max(200, (Number(trig.params?.intervalSeconds) || 1) * 1000);
    const existing = schedules.get(request.params.id);
    if (existing) clearInterval(existing.handle);
    let fires = 0;
    const fire = () => {
      if (fires >= 60) { const s = schedules.get(request.params.id); if (s) clearInterval(s.handle); schedules.delete(request.params.id); return; }
      fires++;
      startGraphRun(def.graph as GraphDef, def.name, def.id).catch(() => {});
    };
    fire(); // fire immediately, then on the interval
    const handle = setInterval(fire, ms);
    schedules.set(request.params.id, { handle, ms });
    return reply.send({ started: true, intervalMs: ms });
  });
  app.post<{ Params: { id: string } }>('/definitions/:id/schedule/stop', async (request, reply) => {
    const s = schedules.get(request.params.id);
    if (s) { clearInterval(s.handle); schedules.delete(request.params.id); }
    return reply.send({ stopped: true });
  });

  // --- B50: Webhook trigger — an inbound request to the configured path starts
  // a real run carrying the request's payload. ---
  app.route({
    method: ['GET', 'POST', 'PUT'],
    url: '/webhook/*',
    handler: async (request, reply) => {
      const wpath = (request.params as any)['*'];
      for (const { id } of listDefinitions()) {
        const def = getDefinition(id);
        if (!def) continue;
        const trig = (def.graph.nodes as any[]).find((n) => n.type === 'webhookTrigger' && String(n.params?.path ?? '') === wpath);
        if (!trig) continue;
        // Inject the request payload into the webhook trigger node, then fire.
        const graph = JSON.parse(JSON.stringify(def.graph));
        const wt = (graph.nodes as any[]).find((n) => n.type === 'webhookTrigger' && String(n.params?.path ?? '') === wpath);
        wt.params._payload = request.body && typeof request.body === 'object' ? request.body : {};
        wt.params._query = request.query ?? {};
        const runId = await startGraphRun(graph as GraphDef, def.name, def.id);
        // If the automation has a Respond to Webhook step, wait for the run and
        // return the custom status + body it built (B51); else a default ack (B50).
        const respondNode = (graph.nodes as any[]).find((n) => n.type === 'respondToWebhook');
        if (respondNode) {
          const handle = client.workflow.getHandle(runId);
          try { await handle.result(); } catch { /* run failed — fall through */ }
          await refreshRun(runId);
          let resp: any;
          try { resp = (await handle.query(getStepsQuery))[respondNode.id]?.output?.[0]?.json; } catch { /* ignore */ }
          if (resp && typeof resp.status === 'number') return reply.code(resp.status).send(resp.body);
          return reply.code(502).send({ error: 'webhook automation produced no response' });
        }
        return reply.code(202).send({ fired: true, runId, definitionId: def.id });
      }
      return reply.code(404).send({ fired: false, error: `no webhook registered for path '${wpath}'` });
    },
  });

  // --- B52: Form trigger — serve a web form at /form/:path; submitting it
  // starts a real run carrying the entered values. ---
  const findFormDef = (formPath: string) => {
    for (const { id } of listDefinitions()) {
      const def = getDefinition(id);
      const trig = def && (def.graph.nodes as any[]).find((n) => n.type === 'formTrigger' && String(n.params?.path ?? '') === formPath);
      if (def && trig) return { def, trig };
    }
    return null;
  };
  app.get<{ Params: { path: string } }>('/form/:path', async (request, reply) => {
    const found = findFormDef(request.params.path);
    if (!found) return reply.code(404).type('text/html').send('<p>No form registered at this path.</p>');
    const fields: string[] = Array.isArray(found.trig.params?.fields) ? found.trig.params.fields : [];
    const inputs = fields
      .map((f) => `<label style="display:block;margin:8px 0 2px;">${f}</label><input data-testid="form-field-${f}" data-field="${f}" />`)
      .join('');
    const html = `<!doctype html><meta charset="utf-8"><title>${found.def.name}</title>
<body style="font-family:sans-serif;max-width:420px;margin:40px auto;">
<h2 data-testid="form-title">${found.def.name}</h2>
<form id="f">${inputs}<button type="submit" data-testid="form-submit" style="margin-top:12px;">Submit</button></form>
<div data-testid="form-result"></div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {};
  for (const inp of document.querySelectorAll('input[data-field]')) data[inp.dataset.field] = inp.value;
  const r = await fetch(location.pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then((x) => x.json());
  const res = document.querySelector('[data-testid=form-result]');
  if (r.runId) { res.dataset.runId = r.runId; res.textContent = 'Submitted — run ' + r.runId; }
  else { res.textContent = 'error: ' + (r.error || 'failed'); }
});
</script></body>`;
    return reply.type('text/html').send(html);
  });
  app.post<{ Params: { path: string } }>('/form/:path', async (request, reply) => {
    const found = findFormDef(request.params.path);
    if (!found) return reply.code(404).send({ error: `no form at '${request.params.path}'` });
    const graph = JSON.parse(JSON.stringify(found.def.graph));
    const ft = (graph.nodes as any[]).find((n) => n.type === 'formTrigger' && String(n.params?.path ?? '') === request.params.path);
    ft.params._payload = request.body && typeof request.body === 'object' ? request.body : {};
    const runId = await startGraphRun(graph as GraphDef, found.def.name, found.def.id);
    return reply.code(202).send({ submitted: true, runId, definitionId: found.def.id });
  });

  // --- B22: export an automation to n8n-compatible workflow JSON. ---
  app.post('/export/n8n', async (request, reply) => {
    const { name, graph } = (request.body ?? {}) as { name?: string; graph?: GraphDef };
    if (!graph || !Array.isArray(graph.nodes)) {
      return reply.code(400).send({ error: 'graph{nodes,connections} is required' });
    }
    return reply.code(200).send(exportToN8n(name ?? 'Exported automation', graph));
  });

  // --- B17/B24: per-step status & output for a run. Live while running; from
  // the persisted record once finished (so it survives engine restarts). ---
  app.get<{ Params: { id: string } }>('/runs/:id/steps', async (request, reply) => {
    const { id } = request.params;
    // Prefer the durably persisted per-step record for finished runs.
    const stored = getRun(id);
    if (stored && stored.steps) {
      return reply.send({ runId: id, status: stored.status, steps: stored.steps, persisted: true });
    }
    // Otherwise query the live run, and persist its detail if it has finished.
    try {
      const handle = client.workflow.getHandle(id);
      const description = await handle.describe();
      const steps = await handle.query(getStepsQuery);
      const outcome = toOutcome(description.status.name);
      if (outcome !== 'running') {
        const finishedAt = description.closeTime ? description.closeTime.toISOString() : new Date().toISOString();
        updateRunOutcome(id, outcome, finishedAt, steps);
      }
      return reply.send({ runId: id, status: toRunStatus(description.status.name), steps, persisted: false });
    } catch (err: any) {
      return reply.code(404).send({ runId: id, error: `no such run: ${err?.message ?? err}` });
    }
  });

  // Map Temporal's status to the run-history outcome vocabulary.
  const toOutcome = (name: string): RunOutcome => {
    switch (name) {
      case 'RUNNING':
      case 'CONTINUED_AS_NEW':
        return 'running';
      case 'COMPLETED':
        return 'completed';
      case 'CANCELED':
      case 'TERMINATED':
        return 'cancelled';
      default:
        return 'failed'; // FAILED, TIMED_OUT
    }
  };
  // Persist a run's terminal outcome AND its per-step detail to durable history
  // once it settles, so finished runs stay inspectable (even after restarts).
  const refreshRun = async (runId: string): Promise<void> => {
    try {
      const handle = client.workflow.getHandle(runId);
      const desc = await handle.describe();
      const outcome = toOutcome(desc.status.name);
      if (outcome !== 'running') {
        const finishedAt = desc.closeTime ? desc.closeTime.toISOString() : new Date().toISOString();
        let steps: unknown = undefined;
        try {
          steps = await handle.query(getStepsQuery); // capture per-step detail while still queryable
        } catch {
          /* query unavailable (e.g. terminated) — keep whatever was already persisted */
        }
        updateRunOutcome(runId, outcome, finishedAt, steps);
      }
    } catch {
      /* run not found in the workflow service (e.g. after its own restart) — keep stored record */
    }
  };

  // --- B23: persistent history of past runs. ---
  app.get('/history', async () => {
    // Settle any still-'running' entries so the history shows correct outcomes.
    for (const r of listRuns()) {
      if (r.status === 'running') await refreshRun(r.runId);
    }
    return listRuns();
  });

  // Cancel a run (a user stopping it) -> recorded as 'cancelled' in history.
  // Captures the per-step state at cancel time (so not-yet-run steps are shown
  // as such, not falsely completed), then stops the run promptly.
  app.post<{ Params: { id: string } }>('/runs/:id/cancel', async (request, reply) => {
    const id = request.params.id;
    try {
      const handle = client.workflow.getHandle(id);
      // Snapshot per-step state while still in-flight.
      let steps: Record<string, any> = {};
      try {
        steps = (await handle.query(getStepsQuery)) as Record<string, any>;
      } catch {
        /* best effort */
      }
      await handle.terminate('cancelled by user');
      // A step that was mid-flight becomes 'cancelled'; not-yet-run steps stay
      // 'pending' (never 'completed').
      for (const k of Object.keys(steps)) {
        if (steps[k].status === 'running') steps[k] = { ...steps[k], status: 'cancelled' };
      }
      updateRunOutcome(id, 'cancelled', new Date().toISOString(), steps);
      return reply.send({ runId: id, cancelled: true });
    } catch (err: any) {
      return reply.code(404).send({ error: String(err?.message ?? err) });
    }
  });

  // --- B25: re-run a past run as a fresh, distinct run (same automation as it was). ---
  app.post<{ Params: { id: string } }>('/runs/:id/rerun', async (request, reply) => {
    const original = getRun(request.params.id);
    if (!original) return reply.code(404).send({ error: `no such run: ${request.params.id}` });
    if (!original.graph) return reply.code(409).send({ error: 'original run has no recorded definition to re-run' });

    const runId = `run-${randomId()}`;
    const handle = await client.workflow.start(runGraph, {
      taskQueue: TASK_QUEUE,
      workflowId: runId,
      args: [resolveSubworkflows(original.graph as GraphDef)],
    });
    // A NEW, distinct history entry for the SAME automation (original kept).
    recordRunStart({
      runId,
      automationName: original.automationName,
      automationId: original.automationId,
      startedAt: new Date().toISOString(),
      graph: original.graph,
    });
    return reply.code(202).send({ runId: handle.workflowId, rerunOf: request.params.id, status: 'in-progress' });
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
