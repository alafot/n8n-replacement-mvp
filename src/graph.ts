// Graph definition format for a workflow described as connected steps, plus a
// deterministic dependency ordering. n8n-inspired: a list of nodes and the
// directed connections between them. Data flows from a node to the nodes it
// connects to.

export type NodeType = 'httpRequest' | 'code' | 'transform' | 'if' | 'switch' | 'filter' | 'merge' | 'loop' | 'wait' | 'noop' | 'stopError' | 'executeSubworkflow' | 'aggregate' | 'splitOut' | 'sort' | 'limit' | 'removeDuplicates' | 'renameKeys';

/** Node ids reachable forward from any of `starts` (following connections). */
export function reachableFrom(def: GraphDefinition, starts: string[]): Set<string> {
  const out = new Set<string>(starts);
  const stack = [...starts];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of def.connections) {
      if (c.from === cur && !out.has(c.to)) { out.add(c.to); stack.push(c.to); }
    }
  }
  return out;
}

export interface GraphNode {
  /** Unique node id within the graph. */
  id: string;
  type: NodeType;
  /** Node-type-specific parameters (e.g. HTTP method/url, or code body). */
  params: Record<string, unknown>;
}

export interface GraphConnection {
  /** id of the upstream node producing data. */
  from: string;
  /** id of the downstream node receiving that data. */
  to: string;
  /**
   * Output port of the upstream node this edge leaves from. 'main' for ordinary
   * nodes; 'true' / 'false' for an 'if' branch; a rule index ('0','1',...) or
   * 'fallback' for a 'switch'. An edge is only "taken" when its port carries items.
   */
  port?: string;
}

/** A structured, pure boolean condition for the IF node (no code execution). */
export interface Condition {
  /** Dot-path into the first input item, e.g. "json.body.value". */
  left: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'truthy' | 'contains';
  /** Comparison value (ignored for 'truthy'). */
  right?: unknown;
}

/** Read a dot-path out of an object (returns undefined if any segment missing). */
export function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Evaluate a condition against the first input item. Pure and deterministic. */
export function evaluateCondition(cond: Condition, firstItem: unknown): boolean {
  const left = getPath(firstItem, cond.left);
  switch (cond.op) {
    case 'eq':
      return left === cond.right;
    case 'ne':
      return left !== cond.right;
    case 'gt':
      return Number(left) > Number(cond.right);
    case 'gte':
      return Number(left) >= Number(cond.right);
    case 'lt':
      return Number(left) < Number(cond.right);
    case 'lte':
      return Number(left) <= Number(cond.right);
    case 'truthy':
      return Boolean(left);
    case 'contains':
      return typeof left === 'string' && left.includes(String(cond.right));
    default:
      return false;
  }
}

export interface GraphDefinition {
  nodes: GraphNode[];
  connections: GraphConnection[];
}

/**
 * Deterministic topological sort (Kahn's algorithm). Node ids are processed in
 * lexical order when otherwise unconstrained, so the same graph always yields
 * the same execution order (required for Temporal workflow determinism).
 * Throws if the graph has a cycle or references unknown nodes.
 */
export function topologicalOrder(def: GraphDefinition): string[] {
  const ids = def.nodes.map((n) => n.id);
  const idSet = new Set(ids);

  for (const c of def.connections) {
    if (!idSet.has(c.from)) throw new Error(`connection references unknown node '${c.from}'`);
    if (!idSet.has(c.to)) throw new Error(`connection references unknown node '${c.to}'`);
  }

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const c of def.connections) {
    adjacency.get(c.from)!.push(c.to);
    indegree.set(c.to, (indegree.get(c.to) ?? 0) + 1);
  }

  // Ready set = nodes with no remaining upstream dependency; pick lexically.
  const ready = ids.filter((id) => indegree.get(id) === 0).sort();
  const order: string[] = [];

  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const next of adjacency.get(id)!.slice().sort()) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) {
        ready.push(next);
        ready.sort();
      }
    }
  }

  if (order.length !== ids.length) {
    throw new Error('graph has a cycle — cannot order steps');
  }
  return order;
}

/** ids of nodes feeding `nodeId` (its direct upstream dependencies). */
export function upstreamOf(def: GraphDefinition, nodeId: string): string[] {
  return def.connections.filter((c) => c.to === nodeId).map((c) => c.from);
}

/** Leaf nodes = nodes with no outgoing connections (the graph's terminal outputs). */
export function leafNodes(def: GraphDefinition): string[] {
  const hasOutgoing = new Set(def.connections.map((c) => c.from));
  return def.nodes.map((n) => n.id).filter((id) => !hasOutgoing.has(id));
}
