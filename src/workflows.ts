// Workflow definitions registered with the worker.
//
// Iteration 0 walking skeleton (B3): a durable workflow that runs a single
// HTTP-request step and returns its output as the run's result, in the
// standard item format.

import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import type { HttpRequestInput } from './activities';
import type { Items } from './itemFormat';
import {
  GraphDefinition,
  Condition,
  topologicalOrder,
  evaluateCondition,
} from './graph';

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
export async function runGraph(def: GraphDefinition): Promise<Items> {
  const order = topologicalOrder(def);
  const outputs: Record<string, Items> = {};

  // A node executes only if it is "active": a root (no incoming edges) or
  // reached by a taken edge from an active node.
  const hasIncoming = new Set(def.connections.map((c) => c.to));
  const active = new Set<string>(def.nodes.map((n) => n.id).filter((id) => !hasIncoming.has(id)));
  const takenEdges = new Set<number>();

  for (const nodeId of order) {
    if (!active.has(nodeId)) continue; // untaken branch — no execution, no output
    const node = def.nodes.find((n) => n.id === nodeId)!;

    // Input = items from taken incoming edges only.
    const input: Items = [];
    def.connections.forEach((c, i) => {
      if (c.to === nodeId && takenEdges.has(i)) input.push(...(outputs[c.from] ?? []));
    });

    let out: Items;
    let decision: boolean | null = null;
    switch (node.type) {
      case 'httpRequest':
        out = await httpRequest(node.params as unknown as HttpRequestInput);
        break;
      case 'code':
        out = await runCode({ code: String(node.params.code ?? ''), input });
        break;
      case 'transform':
        out = await runTransform({ config: node.params as any, input });
        break;
      case 'if': {
        // Pure decision over the incoming items; passes items through so the
        // chosen branch receives the same data.
        decision = evaluateCondition(node.params.condition as Condition, input[0]);
        out = input;
        break;
      }
      default:
        throw new Error(`unknown node type '${(node as any).type}'`);
    }
    outputs[nodeId] = out;

    // Mark which outgoing edges are taken, activating their targets.
    def.connections.forEach((c, i) => {
      if (c.from !== nodeId) return;
      const port = c.port ?? 'main';
      const take = node.type === 'if' ? port === (decision ? 'true' : 'false') : true;
      if (take) {
        takenEdges.add(i);
        active.add(c.to);
      }
    });
  }

  // Overall result = the last executed node in dependency order (terminal of
  // the taken path).
  for (let i = order.length - 1; i >= 0; i--) {
    if (active.has(order[i]) && outputs[order[i]]) return outputs[order[i]];
  }
  return [];
}
