// Workflow definitions registered with the worker.
//
// Iteration 0 walking skeleton (B3): a durable workflow that runs a single
// HTTP-request step and returns its output as the run's result, in the
// standard item format.

import { proxyActivities, defineQuery, setHandler, sleep, ApplicationFailure } from '@temporalio/workflow';
import type * as activities from './activities';
import type { HttpRequestInput } from './activities';
import type { Items } from './itemFormat';
import {
  GraphDefinition,
  GraphNode,
  Condition,
  topologicalOrder,
  evaluateCondition,
  reachableFrom,
  getPath,
} from './graph';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepState {
  status: StepStatus;
  /** Items the step received from upstream, in the standard item format. */
  input?: Items;
  /** Output items the step produced, in the standard item format. */
  output?: Items;
  /** Real underlying error cause when the step failed. */
  error?: string;
  /** Step-type-specific extra info (e.g. a Loop's iteration count). */
  meta?: Record<string, unknown>;
}

/** Deepest (most specific) message in an error's cause chain. */
function deepestCause(err: any): string {
  let cur = err;
  let msg = String(err?.message ?? err);
  const seen = new Set<unknown>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (cur.message) msg = String(cur.message);
    cur = cur.cause;
  }
  return msg;
}

/** Per-step status/output of a run, keyed by node id (B17). Queryable live. */
export const getStepsQuery = defineQuery<Record<string, StepState>>('getSteps');

const { httpRequest, runCode, runTransform } = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    // Fail reasonably fast on a genuine error (e.g. unreachable host) so a
    // failed run becomes observable promptly. Non-2xx responses do NOT throw
    // (see activities.httpRequest), so they don't trigger retries.
    maximumAttempts: 2,
    initialInterval: '1 second',
  },
});

/**
 * Manual start -> single HTTP-request step -> result.
 * The workflow's return value IS the HTTP step's output (standard item format),
 * making the run's result faithfully equal to what the step produced.
 */
export async function runHttpRequest(input: HttpRequestInput): Promise<Items> {
  const items = await httpRequest(input);
  return items;
}

/**
 * Generic graph interpreter (B6, extended for B7/B8). Runs a workflow described
 * as a graph of connected steps:
 *   - executes nodes in dependency order (topological),
 *   - feeds each node the items produced by its upstream node(s) via TAKEN
 *     edges — so data flows ALONG the connections,
 *   - supports conditional routing: an 'if' node takes only its 'true' or
 *     'false' outgoing edges, so nodes reachable only through the untaken
 *     branch never execute (leave no effect),
 *   - returns the terminal executed node's output as the overall result.
 * The HTTP-request step (B2) is reused unchanged as one node type.
 */
// Route each incoming item to the output of the FIRST rule it matches (Switch,
// B31). Items matching no rule go to the 'fallback' output if enabled, else are
// dropped. Returns a per-output-port map of items.
function routeSwitch(params: any, items: Items): Record<string, Items> {
  const rules: Condition[] = Array.isArray(params.rules) ? params.rules : [];
  const emit: Record<string, Items> = {};
  for (let i = 0; i < rules.length; i++) emit[String(i)] = [];
  if (params.fallback) emit['fallback'] = [];
  for (const item of items) {
    let matched = -1;
    for (let i = 0; i < rules.length; i++) {
      if (evaluateCondition(rules[i], item)) { matched = i; break; }
    }
    if (matched >= 0) emit[String(matched)].push(item);
    else if (params.fallback) emit['fallback'].push(item);
    // no match + no fallback -> item is dropped (defined, consistent)
  }
  return emit;
}

// Execute a single (non-loop) node, returning its per-output-port items.
async function execOne(node: GraphNode, input: Items): Promise<Record<string, Items>> {
  switch (node.type) {
    case 'httpRequest':
      return { main: await httpRequest(node.params as unknown as HttpRequestInput) };
    case 'code':
      return { main: await runCode({ code: String(node.params.code ?? ''), input }) };
    case 'transform':
      return { main: await runTransform({ config: node.params as any, input }) };
    case 'if': {
      const decision = evaluateCondition(node.params.condition as Condition, input[0]);
      return { [decision ? 'true' : 'false']: input };
    }
    case 'switch':
      return routeSwitch(node.params, input);
    case 'filter':
      return { main: input.filter((item) => evaluateCondition(node.params.condition as Condition, item)) };
    case 'merge':
      return { main: input };
    case 'aggregate': {
      // Collapse MANY items into ONE, collecting the chosen field's values.
      const field = String((node.params as any).field ?? 'json.value');
      const outName = String((node.params as any).outputName ?? 'values');
      const values = input.map((it) => getPath(it, field));
      return { main: [{ json: { [outName]: values }, binary: {} }] };
    }
    case 'splitOut': {
      // Inverse of aggregate: expand each item's list field into one item per element.
      const field = String((node.params as any).field ?? 'json.values');
      const outName = String((node.params as any).outputName ?? 'value');
      const out: Items = [];
      for (const it of input) {
        const v = getPath(it, field);
        const arr = Array.isArray(v) ? v : v === undefined ? [] : [v];
        for (const el of arr) out.push({ json: { [outName]: el as any }, binary: {} });
      }
      return { main: out };
    }
    case 'sort': {
      // Reorder items by the chosen field/direction, preserving the item set.
      const field = String((node.params as any).field ?? 'json.value');
      const dir = (node.params as any).direction === 'desc' ? -1 : 1;
      const sorted = [...input].sort((x, y) => {
        const a = getPath(x, field), b = getPath(y, field);
        let cmp: number;
        if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
        else cmp = String(a).localeCompare(String(b));
        return cmp * dir;
      });
      return { main: sorted };
    }
    case 'limit': {
      // Cap the item count at N, keeping the first (or last) N in original order.
      const max = Math.max(0, Math.floor(Number((node.params as any).max) || 0));
      const keepLast = (node.params as any).keep === 'last';
      if (input.length <= max) return { main: input };
      return { main: keepLast ? input.slice(input.length - max) : input.slice(0, max) };
    }
    case 'removeDuplicates': {
      // Keep only distinct items (first occurrence, original order). Identity is
      // a chosen key field, or the whole item.
      const byWhole = (node.params as any).by === 'whole';
      const field = String((node.params as any).field ?? 'json.id');
      const seen = new Set<string>();
      const out: Items = [];
      for (const it of input) {
        const key = byWhole ? JSON.stringify(it.json) : JSON.stringify(getPath(it, field));
        if (!seen.has(key)) { seen.add(key); out.push(it); }
      }
      return { main: out };
    }
    case 'noop':
      // True no-op: pass items straight through, unchanged.
      return { main: input };
    case 'stopError':
      // Deliberately FAIL the run execution with the user's message (a
      // non-retryable ApplicationFailure, so it ends the run rather than
      // retrying a workflow task), aborting downstream.
      throw ApplicationFailure.create({ message: String((node.params as any).message ?? 'Stopped with error'), nonRetryable: true });
    case 'wait': {
      // Pause the run for the configured time (durable timer), then pass the
      // items through UNCHANGED.
      const ms = Math.max(0, Number((node.params as any).ms) || 0);
      if (ms > 0) await sleep(ms);
      return { main: input };
    }
    default:
      throw new Error(`unknown node type '${(node as any).type}'`);
  }
}

// Run a sub-DAG (the loop body) once over a seeded batch, returning its terminal
// output. Records per-node step state (status/input/output) for the body nodes.
async function runScopedSlice(
  def: GraphDefinition,
  bodyNodes: Set<string>,
  entryNodes: string[],
  seed: Items,
  steps: Record<string, StepState>,
): Promise<Items> {
  const order = topologicalOrder(def).filter((id) => bodyNodes.has(id));
  const portOut: Record<string, Record<string, Items>> = {};
  const active = new Set<string>(entryNodes);
  const taken = new Set<number>();
  for (const nodeId of order) {
    if (!active.has(nodeId)) continue;
    const node = def.nodes.find((n) => n.id === nodeId)!;
    const input: Items = entryNodes.includes(nodeId) ? [...seed] : [];
    def.connections.forEach((c, i) => {
      if (c.to === nodeId && taken.has(i)) input.push(...(portOut[c.from]?.[c.port ?? 'main'] ?? []));
    });
    let emit: Record<string, Items>;
    try {
      emit = await execOne(node, input);
    } catch (err: any) {
      steps[nodeId] = { status: 'failed', input, error: deepestCause(err) };
      throw err;
    }
    portOut[nodeId] = emit;
    steps[nodeId] = { status: 'completed', input, output: Object.values(emit).flat() };
    const gated = node.type === 'if' || node.type === 'switch';
    def.connections.forEach((c, i) => {
      if (c.from !== nodeId || !bodyNodes.has(c.to)) return;
      const port = c.port ?? 'main';
      if (gated ? emit[port] && emit[port].length > 0 : true) { taken.add(i); active.add(c.to); }
    });
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const po = portOut[order[i]];
    if (active.has(order[i]) && po) return Object.values(po).flat();
  }
  return [];
}

export async function runGraph(def: GraphDefinition): Promise<Items> {
  const order = topologicalOrder(def);
  // Per-node, PER-OUTPUT-PORT outputs (a Switch emits different items per port).
  const portOutputs: Record<string, Record<string, Items>> = {};

  // Per-step state, exposed via query so callers can watch progress live (B17).
  const steps: Record<string, StepState> = {};
  for (const n of def.nodes) steps[n.id] = { status: 'pending' };
  setHandler(getStepsQuery, () => steps);

  // A node executes only if it is "active": a root (no incoming edges) or
  // reached by a taken edge from an active node.
  const hasIncoming = new Set(def.connections.map((c) => c.to));
  const active = new Set<string>(def.nodes.map((n) => n.id).filter((id) => !hasIncoming.has(id)));
  const takenEdges = new Set<number>();

  for (const nodeId of order) {
    if (!active.has(nodeId)) continue; // untaken branch — no execution, no output
    const node = def.nodes.find((n) => n.id === nodeId)!;

    // Input = items from the TAKEN incoming edges' source ports only.
    const input: Items = [];
    def.connections.forEach((c, i) => {
      if (c.to === nodeId && takenEdges.has(i)) input.push(...(portOutputs[c.from]?.[c.port ?? 'main'] ?? []));
    });

    steps[nodeId] = { status: 'running', input }; // observable as 'running'; record the input it received

    let emit: Record<string, Items>; // output port -> items
    let meta: Record<string, unknown> | undefined;
    try {
      if (node.type === 'loop') {
        // Iterate the input in batches; run the loop-BODY subgraph once per
        // batch; then continue on the 'done' output with the accumulated results.
        const batchSize = Math.max(1, Number((node.params as any).batchSize) || 1);
        const bodyEntry = def.connections.filter((c) => c.from === nodeId && (c.port ?? 'main') === 'loop').map((c) => c.to);
        const bodyNodes = reachableFrom(def, bodyEntry);
        const batches: Items[] = [];
        for (let k = 0; k * batchSize < input.length; k++) {
          // Tag each item with its iteration index so per-iteration routing is observable.
          batches.push(input.slice(k * batchSize, (k + 1) * batchSize).map((it) => ({ json: { ...it.json, _iteration: k }, binary: it.binary })));
        }
        const accumulated: Items = [];
        for (let k = 0; k < batches.length; k++) {
          const out = await runScopedSlice(def, bodyNodes, bodyEntry, batches[k], steps);
          accumulated.push(...out);
        }
        for (const b of bodyNodes) active.add(b); // body nodes ran (not 'skipped')
        emit = { done: accumulated };
        meta = { iterations: batches.length, batchSize, batchItemCounts: batches.map((b) => b.length) };
      } else if (node.type === 'executeSubworkflow') {
        // Run a SEPARATE saved automation (its graph is resolved & embedded at
        // trigger time) with the parent's items as input; return its results.
        const sub = (node.params as any).subGraph as GraphDefinition | undefined;
        if (!sub || !Array.isArray(sub.nodes) || !sub.nodes.length) {
          throw ApplicationFailure.create({ message: 'Execute Sub-workflow: no saved automation selected/resolved', nonRetryable: true });
        }
        const subRoots = sub.nodes.filter((sn) => !sub.connections.some((c) => c.to === sn.id)).map((sn) => sn.id);
        const subOut = await runScopedSlice(sub, new Set(sub.nodes.map((sn) => sn.id)), subRoots, input, {});
        emit = { main: subOut };
      } else {
        emit = await execOne(node, input);
      }
    } catch (err: any) {
      steps[nodeId] = { status: 'failed', input, error: deepestCause(err) };
      throw err;
    }
    portOutputs[nodeId] = emit;
    steps[nodeId] = { status: 'completed', input, output: Object.values(emit).flat(), ...(meta ? { meta } : {}) };

    // Mark which outgoing edges are taken, activating their targets. For gated
    // nodes (if/switch/loop) an edge is taken only if its port actually has items.
    const gated = node.type === 'if' || node.type === 'switch' || node.type === 'loop';
    def.connections.forEach((c, i) => {
      if (c.from !== nodeId) return;
      const port = c.port ?? 'main';
      const take = gated ? (emit[port] && emit[port].length > 0) : true;
      if (take) {
        takenEdges.add(i);
        active.add(c.to);
      }
    });
  }

  // Steps on a not-taken branch/output report 'skipped' (distinct from failed/completed).
  for (const nodeId of order) {
    if (active.has(nodeId)) continue;
    const ups = def.connections.filter((c) => c.to === nodeId).map((c) => c.from);
    if (ups.some((u) => steps[u].status === 'completed' || steps[u].status === 'skipped')) {
      steps[nodeId].status = 'skipped';
    }
  }

  // Overall result = the last executed node in dependency order (terminal of
  // the taken path), combining its output ports.
  for (let i = order.length - 1; i >= 0; i--) {
    const po = portOutputs[order[i]];
    if (active.has(order[i]) && po) return Object.values(po).flat();
  }
  return [];
}
