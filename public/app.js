// Visual workflow builder (B13-B16, B18). Talks to the engine's HTTP API:
//   POST /workflows/run-graph  - run the canvas (B16)
//   GET  /runs/:id/steps       - per-step live status/output (B17/B18)
//   POST/PUT/GET /definitions  - save/load durable definitions (B15, reusing B10)

const STEP_TYPES = [
  { type: 'httpRequest', label: 'Call a web service', hint: 'HTTP request' },
  { type: 'transform', label: 'Reshape data', hint: 'Transform / Set' },
  { type: 'if', label: 'Branch on a condition', hint: 'Conditional (IF)' },
  { type: 'code', label: 'Run a code snippet', hint: 'Code / Function' },
];
const LABELS = Object.fromEntries(STEP_TYPES.map((s) => [s.type, s.label]));

const state = {
  nodes: [], // { id, type, label, x, y, params }
  connections: [], // { id, from, to, port }
  selectedId: null,
  arm: null, // { from, port } when drawing a connection
  defId: null,
  counter: 0,
  lastRunId: null,
  lastSteps: {}, // nodeId -> { status, output, error }
  poll: null,
};

const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const svg = $('#links');

function nid() {
  state.counter += 1;
  return 'n' + state.counter;
}
function defaultParams(type) {
  if (type === 'httpRequest') return { method: 'GET', url: '' };
  if (type === 'transform') return { set: {}, copy: {}, rename: {}, remove: [] };
  if (type === 'if') return { condition: { left: 'json.value', op: 'gt', right: 0 } };
  if (type === 'code') return { code: 'return $input;' };
  return {};
}

function addNode(type) {
  const count = state.nodes.length;
  const node = {
    id: nid(),
    type,
    label: LABELS[type],
    x: 60 + (count % 3) * 230,
    y: 60 + Math.floor(count / 3) * 110,
    params: defaultParams(type),
  };
  state.nodes.push(node);
  render();
  return node;
}

function nodeById(id) {
  return state.nodes.find((n) => n.id === id);
}

// ---- connections ----
function portPoint(node, port) {
  const x = node.x + 170;
  let y = node.y + 22;
  if (port === 'true') y = node.y + 16;
  else if (port === 'false') y = node.y + 40;
  return { x, y };
}
function nodeInPoint(node) {
  return { x: node.x, y: node.y + 22 };
}
function armConnection(from, port) {
  state.arm = { from, port };
  render();
}
function completeConnection(toId) {
  if (!state.arm || state.arm.from === toId) {
    state.arm = null;
    render();
    return;
  }
  state.connections.push({ id: 'c' + (state.counter += 1), from: state.arm.from, to: toId, port: state.arm.port });
  state.arm = null;
  render();
}
function deleteConnection(connId) {
  state.connections = state.connections.filter((c) => c.id !== connId);
  render();
}

// ---- serialization ----
function toGraph() {
  return {
    nodes: state.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, position: { x: n.x, y: n.y }, params: n.params })),
    connections: state.connections.map((c) => ({ id: c.id, from: c.from, to: c.to, port: c.port })),
  };
}
function loadGraph(graph) {
  state.nodes = (graph.nodes || []).map((n) => ({
    id: n.id, type: n.type, label: n.label || LABELS[n.type] || n.type,
    x: n.position ? n.position.x : 60, y: n.position ? n.position.y : 60, params: n.params || defaultParams(n.type),
  }));
  state.connections = (graph.connections || []).map((c, i) => ({ id: c.id || 'c' + i, from: c.from, to: c.to, port: c.port || 'main' }));
  state.counter = state.nodes.length + state.connections.length + 100;
  state.selectedId = null;
  state.lastSteps = {};
  render();
}

// ---- rendering ----
function render() {
  // nodes
  [...canvas.querySelectorAll('.node, .conn-del')].forEach((el) => el.remove());
  for (const n of state.nodes) {
    const el = document.createElement('div');
    el.className = 'node' + (state.selectedId === n.id ? ' selected' : '');
    el.dataset.testid = 'node';
    el.dataset.nodeType = n.type;
    el.dataset.nodeId = n.id;
    const st = state.lastSteps[n.id];
    if (st) el.dataset.stepStatus = st.status;
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    el.innerHTML =
      '<div class="node-title">' + n.label + '</div>' +
      '<div class="node-type">type: ' + n.type + ' · ' + n.id + '</div>' +
      (st ? '<span class="badge" data-testid="node-status">' + st.status + '</span>' : '');
    // output ports
    const ports = document.createElement('div');
    ports.className = 'ports';
    const portList = n.type === 'if' ? ['true', 'false'] : ['main'];
    for (const p of portList) {
      const pe = document.createElement('div');
      pe.className = 'port' + (state.arm && state.arm.from === n.id && state.arm.port === p ? ' armed' : '');
      pe.dataset.testid = 'port';
      pe.dataset.nodeId = n.id;
      pe.dataset.port = p;
      pe.title = 'connect from ' + p;
      pe.textContent = p === 'true' ? 'T' : p === 'false' ? 'F' : '→';
      pe.addEventListener('click', (ev) => { ev.stopPropagation(); armConnection(n.id, p); });
      ports.appendChild(pe);
    }
    el.appendChild(ports);
    el.addEventListener('click', () => {
      if (state.arm) completeConnection(n.id);
      else selectNode(n.id);
    });
    canvas.appendChild(el);
  }
  // links
  svg.innerHTML = '';
  for (const c of state.connections) {
    const from = nodeById(c.from), to = nodeById(c.to);
    if (!from || !to) continue;
    const a = portPoint(from, c.port), b = nodeInPoint(to);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.dataset.testid = 'conn-line';
    svg.appendChild(line);
    const del = document.createElement('button');
    del.className = 'conn-del';
    del.dataset.testid = 'conn-delete';
    del.dataset.connId = c.id;
    del.dataset.from = c.from; del.dataset.to = c.to; del.dataset.port = c.port;
    del.style.left = (a.x + b.x) / 2 + 'px';
    del.style.top = (a.y + b.y) / 2 + 'px';
    del.textContent = '×';
    del.title = 'delete connection';
    del.addEventListener('click', (ev) => { ev.stopPropagation(); deleteConnection(c.id); });
    canvas.appendChild(del);
  }
  // connecting hint
  $('#connect-hint').textContent = state.arm
    ? `Connecting from ${state.arm.from} (${state.arm.port}) — click a target step.`
    : 'Tip: click a step\'s port (→ / T / F) then click a target to connect.';
  renderConfig();
}

// ---- inspector / config (B14) ----
function selectNode(id) {
  state.selectedId = id;
  render();
}
function field(label, testid, el) {
  const wrap = document.createElement('div');
  const lab = document.createElement('label');
  lab.textContent = label;
  el.dataset.testid = testid;
  wrap.appendChild(lab);
  wrap.appendChild(el);
  return wrap;
}
function input(value, oninput) {
  const el = document.createElement('input');
  el.value = value ?? '';
  el.addEventListener('input', () => oninput(el.value));
  return el;
}
function textarea(value, oninput) {
  const el = document.createElement('textarea');
  el.value = value ?? '';
  el.addEventListener('input', () => oninput(el.value));
  return el;
}
function jsonStr(v) { try { return JSON.stringify(v ?? {}); } catch { return '{}'; } }
function parseJsonSafe(s, fallback) { try { return JSON.parse(s); } catch { return fallback; } }

function renderConfig() {
  const c = $('#config');
  c.innerHTML = '';
  const n = nodeById(state.selectedId);
  if (!n) { c.innerHTML = '<p class="hint">Select a step to configure it.</p>'; return; }
  const head = document.createElement('div');
  head.innerHTML = `<strong data-testid="cfg-title">${n.label}</strong><div class="node-type">type: ${n.type} · ${n.id}</div>`;
  c.appendChild(head);

  if (n.type === 'httpRequest') {
    const sel = document.createElement('select');
    for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
      const o = document.createElement('option'); o.value = m; o.textContent = m; if (n.params.method === m) o.selected = true; sel.appendChild(o);
    }
    sel.addEventListener('change', () => { n.params.method = sel.value; });
    c.appendChild(field('Method', 'cfg-method', sel));
    c.appendChild(field('Target URL', 'cfg-url', input(n.params.url, (v) => (n.params.url = v))));
    c.appendChild(field('Headers (JSON, optional)', 'cfg-headers', textarea(n.params.headers ? jsonStr(n.params.headers) : '', (v) => { if (v.trim()) n.params.headers = parseJsonSafe(v, n.params.headers); else delete n.params.headers; })));
    c.appendChild(field('Body (optional)', 'cfg-body', textarea(n.params.body || '', (v) => { if (v) n.params.body = v; else delete n.params.body; })));
  } else if (n.type === 'transform') {
    c.appendChild(field('Set fields (JSON)', 'cfg-set', textarea(jsonStr(n.params.set), (v) => (n.params.set = parseJsonSafe(v, n.params.set)))));
    c.appendChild(field('Copy (JSON: dest←source)', 'cfg-copy', textarea(jsonStr(n.params.copy), (v) => (n.params.copy = parseJsonSafe(v, n.params.copy)))));
    c.appendChild(field('Rename (JSON: old→new)', 'cfg-rename', textarea(jsonStr(n.params.rename), (v) => (n.params.rename = parseJsonSafe(v, n.params.rename)))));
    c.appendChild(field('Remove (comma-separated)', 'cfg-remove', input((n.params.remove || []).join(','), (v) => (n.params.remove = v.split(',').map((s) => s.trim()).filter(Boolean)))));
  } else if (n.type === 'if') {
    n.params.condition = n.params.condition || { left: '', op: 'gt', right: 0 };
    c.appendChild(field('Condition field (path)', 'cfg-left', input(n.params.condition.left, (v) => (n.params.condition.left = v))));
    const sel = document.createElement('select');
    for (const op of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'truthy', 'contains']) {
      const o = document.createElement('option'); o.value = op; o.textContent = op; if (n.params.condition.op === op) o.selected = true; sel.appendChild(o);
    }
    sel.addEventListener('change', () => { n.params.condition.op = sel.value; });
    c.appendChild(field('Operator', 'cfg-op', sel));
    c.appendChild(field('Compare value', 'cfg-right', input(String(n.params.condition.right ?? ''), (v) => { const num = Number(v); n.params.condition.right = v !== '' && !Number.isNaN(num) ? num : v; })));
  } else if (n.type === 'code') {
    c.appendChild(field('Code', 'cfg-code', textarea(n.params.code, (v) => (n.params.code = v))));
  }

  // Per-step output inspection (B18 E4) after a run.
  const st = state.lastSteps[n.id];
  if (st) {
    const lab = document.createElement('label'); lab.textContent = 'Run status: ' + st.status;
    c.appendChild(lab);
    const pre = document.createElement('pre'); pre.id = 'step-output'; pre.dataset.testid = 'step-output';
    pre.textContent = JSON.stringify(st.output ?? st.error ?? null, null, 2);
    c.appendChild(pre);
  }
}

// ---- save / load (B15) ----
async function save() {
  const name = $('#automation-name').value || 'Untitled';
  const graph = toGraph();
  let res;
  if (state.defId) {
    res = await fetch('/definitions/' + state.defId, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, graph }) }).then((r) => r.json());
  } else {
    res = await fetch('/definitions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, graph }) }).then((r) => r.json());
    state.defId = res.id;
    history.replaceState(null, '', '?def=' + res.id);
  }
  $('#run-status').textContent = 'saved as ' + state.defId;
  $('#run-status').dataset.defId = state.defId;
}
async function loadById(id) {
  const def = await fetch('/definitions/' + id).then((r) => r.json());
  if (def && def.graph) {
    state.defId = id;
    $('#automation-name').value = def.name || 'Untitled';
    loadGraph(def.graph);
    $('#run-status').textContent = 'loaded ' + id;
    $('#run-status').dataset.defId = id;
  }
}

// ---- run + live status (B16, B18) ----
async function run() {
  if (state.poll) { clearInterval(state.poll); state.poll = null; }
  state.lastSteps = {};
  const graph = toGraph();
  const res = await fetch('/workflows/run-graph', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(graph) }).then((r) => r.json());
  state.lastRunId = res.runId;
  $('#run-status').textContent = 'running ' + res.runId;
  $('#run-status').dataset.runId = res.runId;
  $('#run-status').dataset.runState = 'in-progress';
  // Poll per-step status live (no manual refresh).
  state.poll = setInterval(async () => {
    const s = await fetch('/runs/' + res.runId + '/steps').then((r) => r.json()).catch(() => null);
    if (!s || !s.steps) return;
    state.lastSteps = s.steps;
    render();
    if (s.status !== 'in-progress') {
      clearInterval(state.poll); state.poll = null;
      $('#run-status').textContent = res.runId + ' → ' + s.status;
      $('#run-status').dataset.runState = s.status;
    }
  }, 250);
}

// ---- wire up ----
const palette = $('#palette');
for (const st of STEP_TYPES) {
  const btn = document.createElement('button');
  btn.className = 'palette-item';
  btn.dataset.testid = 'palette-item';
  btn.dataset.stepType = st.type;
  btn.innerHTML = st.label + '<span class="ptype">' + st.hint + ' · ' + st.type + '</span>';
  btn.addEventListener('click', () => addNode(st.type));
  palette.appendChild(btn);
}
$('#btn-new').addEventListener('click', () => { state.nodes = []; state.connections = []; state.selectedId = null; state.defId = null; state.lastSteps = {}; history.replaceState(null, '', location.pathname); render(); });
$('#btn-save').addEventListener('click', save);
$('#btn-load').addEventListener('click', async () => {
  const list = await fetch('/definitions').then((r) => r.json());
  const id = prompt('Load which definition id?\n' + list.map((d) => d.id + '  (' + d.name + ')').join('\n'));
  if (id) loadById(id.trim());
});
$('#btn-run').addEventListener('click', run);

// On load: if ?def=ID present, restore from durable storage (B15 fresh session).
const params = new URLSearchParams(location.search);
if (params.get('def')) loadById(params.get('def'));
else render();
