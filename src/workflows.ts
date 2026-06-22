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
  topologicalOrder,
  upstreamOf,
  leafNodes,
} from './graph';

const { httpRequest, runCode } = proxyActivities<typeof activities>({
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
 * Generic graph interpreter (B6). Runs a workflow described as a graph of
 * connected steps:
 *   - executes nodes in dependency order (topological),
 *   - feeds each node the items produced by its upstream node(s) — so data
 *     flows ALONG the connections,
 *   - returns the leaf node's output as the overall result.
 * The single HTTP-request step (B2) is reused unchanged as one node type.
 */
export async function runGraph(def: GraphDefinition): Promise<Items> {
  const order = topologicalOrder(def);
  const outputs: Record<string, Items> = {};

  for (const nodeId of order) {
    const node = def.nodes.find((n) => n.id === nodeId)!;

    // Gather this node's input = concatenation of its upstream nodes' outputs.
    const input: Items = upstreamOf(def, nodeId).flatMap((upId) => outputs[upId] ?? []);

    let out: Items;
    switch (node.type) {
      case 'httpRequest':
        out = await httpRequest(node.params as unknown as HttpRequestInput);
        break;
      case 'code':
        out = await runCode({ code: String(node.params.code ?? ''), input });
        break;
      default:
        throw new Error(`unknown node type '${(node as any).type}'`);
    }
    outputs[nodeId] = out;
  }

  // Overall result = the leaf node's output (terminal step of the graph).
  const leaves = leafNodes(def);
  const terminal = leaves.length ? leaves[leaves.length - 1] : order[order.length - 1];
  return outputs[terminal];
}
