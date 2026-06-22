// Import a genuine n8n workflow export into the engine's graph model (B19).
//
// Consumes n8n's actual export shape:
//   - nodes carry `type` like 'n8n-nodes-base.httpRequest', a `typeVersion`,
//     a human `name`, a uuid `id`, a `position` [x,y], and `parameters`.
//   - `connections` is keyed by node NAME; each node's `main` output is an
//     array of output ports, each an array of { node, type, index } targets.
//     For an IF node, main[0] = the TRUE output, main[1] = the FALSE output.

import { GraphDefinition, GraphNode, GraphConnection, NodeType } from './graph';

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  parameters?: Record<string, any>;
}
export interface N8nExport {
  name?: string;
  nodes: N8nNode[];
  connections: Record<string, { main?: Array<Array<{ node: string }>> }>;
}

const TYPE_MAP: Record<string, NodeType> = {
  'n8n-nodes-base.httpRequest': 'httpRequest',
  'n8n-nodes-base.set': 'transform',
  'n8n-nodes-base.if': 'if',
  'n8n-nodes-base.code': 'code',
  'n8n-nodes-base.function': 'code',
};

// n8n IF (FilterV2) operations -> our condition ops. Also accepts older aliases.
const OP_MAP: Record<string, string> = {
  equals: 'eq',
  notEquals: 'ne',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  larger: 'gt',
  largerEqual: 'gte',
  smaller: 'lt',
  smallerEqual: 'lte',
  contains: 'contains',
};

/** Turn an n8n expression like "={{ $json.body.score }}" into a path "json.body.score". */
function exprToPath(expr: unknown): string {
  if (typeof expr !== 'string') return String(expr ?? '');
  const m = expr.match(/^=\{\{\s*(.*?)\s*\}\}$/);
  const inner = m ? m[1] : expr;
  return inner.replace(/^\$json\.?/, 'json.').replace(/^json\.json\./, 'json.').replace(/^json\.$/, 'json');
}

function mapHttp(p: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = { method: (p.method ?? 'GET').toUpperCase(), url: p.url };
  if (p.sendHeaders && p.headerParameters?.parameters) {
    const headers: Record<string, string> = {};
    for (const h of p.headerParameters.parameters) headers[h.name] = h.value;
    out.headers = headers;
  }
  if (p.sendBody && (p.jsonBody || p.body)) out.body = p.jsonBody ?? p.body;
  return out;
}

function mapIf(p: Record<string, any>): Record<string, unknown> {
  const conds = p.conditions;
  // FilterV2 (typeVersion 2): conditions.conditions[].{leftValue, operator:{operation}, rightValue}
  let raw = conds?.conditions?.[0];
  if (raw) {
    return {
      condition: {
        left: exprToPath(raw.leftValue),
        op: OP_MAP[raw.operator?.operation] ?? raw.operator?.operation ?? 'truthy',
        right: raw.rightValue,
      },
    };
  }
  // Legacy v1: conditions.number[]/string[]/boolean[] with {value1, operation, value2}
  raw = conds?.number?.[0] ?? conds?.string?.[0] ?? conds?.boolean?.[0];
  if (raw) {
    return {
      condition: {
        left: exprToPath(raw.value1),
        op: OP_MAP[raw.operation] ?? raw.operation ?? 'eq',
        right: raw.value2,
      },
    };
  }
  return { condition: { left: 'json', op: 'truthy' } };
}

function mapSet(p: Record<string, any>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  // Set v3.x ("Edit Fields"): assignments.assignments[].{name, value, type}
  if (p.assignments?.assignments) {
    for (const a of p.assignments.assignments) {
      set[a.name] = a.type === 'number' ? Number(a.value) : a.type === 'boolean' ? a.value === true || a.value === 'true' : a.value;
    }
  } else if (p.values) {
    // Legacy Set: values.{string,number,boolean}[].{name,value}
    for (const kind of ['string', 'number', 'boolean'] as const) {
      for (const v of p.values[kind] ?? []) set[v.name] = v.value;
    }
  }
  return { set, copy: {}, rename: {}, remove: [] };
}

function mapCode(p: Record<string, any>): Record<string, unknown> {
  return { code: p.jsCode ?? p.functionCode ?? 'return $input;' };
}

function mapParams(type: NodeType, p: Record<string, any>): Record<string, unknown> {
  switch (type) {
    case 'httpRequest':
      return mapHttp(p);
    case 'if':
      return mapIf(p);
    case 'transform':
      return mapSet(p);
    case 'code':
      return mapCode(p);
    default:
      return {};
  }
}

function slug(name: string): string {
  return 'n_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export interface UnsupportedNode {
  id: string;
  name: string;
  type: string;
}
export interface ImportResult {
  name: string;
  graph: GraphDefinition;
  /** n8n nodes whose type is not supported — surfaced, never silently dropped (B21). */
  unsupported: UnsupportedNode[];
}

export function importN8nWorkflow(wf: N8nExport): ImportResult {
  const nameToId: Record<string, string> = {};
  const supportedNames = new Set<string>();
  const unsupported: UnsupportedNode[] = [];
  const nodes: GraphNode[] = [];

  for (const n of wf.nodes) {
    const type = TYPE_MAP[n.type];
    if (!type) {
      // Surface the unsupported node by id/name/type rather than failing.
      unsupported.push({ id: n.id ?? slug(n.name), name: n.name, type: n.type });
      continue;
    }
    const id = n.id || slug(n.name);
    nameToId[n.name] = id;
    supportedNames.add(n.name);
    nodes.push({
      id,
      type,
      label: n.name,
      position: { x: n.position?.[0] ?? 0, y: n.position?.[1] ?? 0 },
      params: mapParams(type, n.parameters ?? {}),
    } as GraphNode);
  }

  const typeById = new Map(nodes.map((n) => [n.id, n.type]));
  const connections: GraphConnection[] = [];
  for (const [fromName, outs] of Object.entries(wf.connections ?? {})) {
    const from = nameToId[fromName];
    if (!from) continue; // skip connections leaving an unsupported node
    const main = outs.main ?? [];
    main.forEach((targets, outputIndex) => {
      // IF nodes: output 0 -> true branch, output 1 -> false branch.
      const port = typeById.get(from) === 'if' ? (outputIndex === 0 ? 'true' : 'false') : 'main';
      for (const t of targets ?? []) {
        const to = nameToId[t.node];
        if (to) connections.push({ from, to, port: port as GraphConnection['port'] }); // only wire among supported nodes
      }
    });
  }

  return { name: wf.name ?? 'Imported workflow', graph: { nodes, connections }, unsupported };
}
