// Export an automation built here to n8n-compatible workflow JSON (B22).
// Inverse of importN8n: produces nodes/connections/parameters as n8n models
// them, so the result conforms to n8n's workflow schema and round-trips back
// through importN8nWorkflow to the same automation.

import { GraphDefinition, GraphNode } from './graph';
import { N8nExport, N8nNode } from './importN8n';

const N8N_TYPE: Record<string, { type: string; typeVersion: number }> = {
  httpRequest: { type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2 },
  transform: { type: 'n8n-nodes-base.set', typeVersion: 3.4 },
  if: { type: 'n8n-nodes-base.if', typeVersion: 2 },
  code: { type: 'n8n-nodes-base.code', typeVersion: 2 },
};

const OP_TO_N8N: Record<string, string> = {
  eq: 'equals',
  ne: 'notEquals',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  contains: 'contains',
};

/** Turn our path "json.body.value" into an n8n expression "={{ $json.body.value }}". */
function pathToExpr(path: string): string {
  const ref = path.replace(/^json(\.|$)/, '$json$1');
  return `={{ ${ref} }}`;
}

function httpParams(p: any) {
  const out: any = { method: p.method ?? 'GET', url: p.url ?? '', options: {} };
  if (p.headers && Object.keys(p.headers).length) {
    out.sendHeaders = true;
    out.headerParameters = { parameters: Object.entries(p.headers).map(([name, value]) => ({ name, value })) };
  }
  if (p.body) {
    out.sendBody = true;
    out.jsonBody = p.body;
  }
  return out;
}
function ifParams(p: any) {
  const cond = p.condition ?? { left: 'json', op: 'truthy' };
  const rightIsNum = typeof cond.right === 'number';
  return {
    conditions: {
      options: { caseSensitive: true, typeValidation: 'strict' },
      combinator: 'and',
      conditions: [
        {
          id: 'cond-' + Math.abs(hash(cond.left + cond.op)).toString(16),
          leftValue: pathToExpr(cond.left),
          rightValue: cond.right,
          operator: { type: rightIsNum ? 'number' : 'string', operation: OP_TO_N8N[cond.op] ?? cond.op },
        },
      ],
    },
    options: {},
  };
}
function setParams(p: any) {
  const set = p.set ?? {};
  return {
    assignments: {
      assignments: Object.entries(set).map(([name, value], i) => ({
        id: 'a' + i,
        name,
        value,
        type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
      })),
    },
    options: {},
  };
}
function codeParams(p: any) {
  return { mode: 'runOnceForAllItems', jsCode: p.code ?? 'return $input;' };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function paramsFor(node: GraphNode): Record<string, any> {
  switch (node.type) {
    case 'httpRequest':
      return httpParams(node.params);
    case 'if':
      return ifParams(node.params);
    case 'transform':
      return setParams(node.params);
    case 'code':
      return codeParams(node.params);
    default:
      return {};
  }
}

export function exportToN8n(name: string, graph: GraphDefinition): N8nExport {
  // Unique display name per node (n8n connections are keyed by name).
  const nameById: Record<string, string> = {};
  const used = new Set<string>();
  for (const n of graph.nodes) {
    let label = (n as any).label || n.id;
    if (used.has(label)) label = `${label} (${n.id})`;
    used.add(label);
    nameById[n.id] = label;
  }

  const nodes: N8nNode[] = graph.nodes.map((n) => {
    const meta = N8N_TYPE[n.type];
    const pos = (n as any).position ?? { x: 0, y: 0 };
    return {
      parameters: paramsFor(n),
      id: n.id,
      name: nameById[n.id],
      type: meta.type,
      typeVersion: meta.typeVersion,
      position: [pos.x, pos.y],
    };
  });

  // Build connections keyed by source NAME, with main output ports. For an IF
  // node, the 'true' edges go to output index 0 and 'false' to index 1.
  const typeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const connections: Record<string, { main: Array<Array<{ node: string; type: string; index: number }>> }> = {};
  for (const c of graph.connections) {
    const fromName = nameById[c.from];
    const toName = nameById[c.to];
    if (!fromName || !toName) continue;
    const isIf = typeById.get(c.from) === 'if';
    const outIdx = isIf ? (c.port === 'false' ? 1 : 0) : 0;
    if (!connections[fromName]) connections[fromName] = { main: [] };
    while (connections[fromName].main.length <= outIdx) connections[fromName].main.push([]);
    connections[fromName].main[outIdx].push({ node: toName, type: 'main', index: 0 });
  }

  return {
    name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: 'v1' },
    pinData: {},
  } as N8nExport & Record<string, unknown>;
}
