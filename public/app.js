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
function connect(fromId, port, toId) {
  if (!fromId || !toId || fromId === toId) return;
  state.connections.push({ id: 'c' + (state.counter += 1), from: fromId, to: toId, port });
  render();
}
function completeConnection(toId) {
  if (!state.arm || state.arm.from === toId) { state.arm = null; render(); return; }
  connect(state.arm.from, state.arm.port, toId);
  state.arm = null;
}

// ---- pointer drag: connect (B27) and move (B28) ----
const DRAG_THRESHOLD = 4;
function canvasXY(ev) {
  const r = canvas.getBoundingClientRect();
  return { x: ev.clientX - r.left, y: ev.clientY - r.top };
}
// Recompute link + delete-button positions without rebuilding nodes (so an
// in-progress drag isn't interrupted).
function updateLinks() {
  for (const c of state.connections) {
    const from = nodeById(c.from), to = nodeById(c.to);
    if (!from || !to) continue;
    const a = portPoint(from, c.port), b = nodeInPoint(to);
    const line = svg.querySelector(`line[data-conn-id="${c.id}"]`);
    if (line) { line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y); }
    const del = canvas.querySelector(`.conn-del[data-conn-id="${c.id}"]`);
    if (del) { del.style.left = (a.x + b.x) / 2 + 'px'; del.style.top = (a.y + b.y) / 2 + 'px'; }
  }
}

function startConnectDrag(fromId, port, ev) {
  const start = canvasXY(ev);
  const a = portPoint(nodeById(fromId), port);
  const temp = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  temp.setAttribute('id', 'temp-line'); temp.setAttribute('x1', a.x); temp.setAttribute('y1', a.y);
  temp.setAttribute('x2', a.x); temp.setAttribute('y2', a.y);
  temp.setAttribute('stroke', '#4c6ef5'); temp.setAttribute('stroke-width', '2'); temp.setAttribute('stroke-dasharray', '5,4');
  svg.appendChild(temp);
  state.drag = { mode: 'connect', from: fromId, port, start, moved: false };
}
function startNodeDrag(nodeId, ev) {
  const n = nodeById(nodeId);
  state.drag = { mode: 'move', nodeId, start: canvasXY(ev), origX: n.x, origY: n.y, moved: false };
}

document.addEventListener('mousemove', (ev) => {
  const d = state.drag;
  if (!d) return;
  const p = canvasXY(ev);
  if (d.mode === 'connect') {
    if (Math.abs(p.x - d.start.x) > DRAG_THRESHOLD || Math.abs(p.y - d.start.y) > DRAG_THRESHOLD) d.moved = true;
    const temp = svg.querySelector('#temp-line');
    if (temp) { temp.setAttribute('x2', p.x); temp.setAttribute('y2', p.y); }
  } else if (d.mode === 'move') {
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) d.moved = true;
    const n = nodeById(d.nodeId);
    n.x = Math.max(0, d.origX + dx); n.y = Math.max(0, d.origY + dy);
    const el = canvas.querySelector(`.node[data-node-id="${d.nodeId}"]`);
    if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
    updateLinks();
  }
});

document.addEventListener('mouseup', (ev) => {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  if (d.mode === 'connect') {
    const temp = svg.querySelector('#temp-line');
    if (temp) temp.remove();
    // Forgiving target: drop anywhere on the target node's body.
    const overNode = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.node');
    if (d.moved && overNode) {
      connect(d.from, d.port, overNode.dataset.nodeId); // drag-connect
    } else if (!d.moved) {
      armConnection(d.from, d.port); // click (no drag) falls back to arm-then-click
    }
  } else if (d.mode === 'move') {
    if (d.moved) render(); // finalize layout (positions already in state.nodes)
    else { if (state.arm) completeConnection(d.nodeId); else selectNode(d.nodeId); } // click = select/complete
  }
});
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
      pe.title = 'drag from ' + p + ' to a target step';
      pe.textContent = p === 'true' ? 'T' : p === 'false' ? 'F' : '→';
      pe.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); startConnectDrag(n.id, p, ev); });
      ports.appendChild(pe);
    }
    el.appendChild(ports);
    // Drag the node body to MOVE it (B28); a click (no drag) selects/completes.
    el.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.port') || ev.target.closest('.conn-del')) return;
      ev.preventDefault();
      startNodeDrag(n.id, ev);
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
    line.dataset.connId = c.id;
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
  const res = await fetch('/workflows/run-graph', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...graph, name: $('#automation-name').value || 'Untitled automation' }) }).then((r) => r.json());
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

// Run history (B23): list past runs with automation, time, and outcome.
const STATUS_COLOR = { completed: '#2f9e44', failed: '#e03131', cancelled: '#868e96', running: '#f08c00' };
async function showHistory() {
  const rows = await fetch('/history').then((r) => r.json());
  const tbody = $('#history-rows');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.dataset.testid = 'history-row';
    tr.dataset.runId = r.runId;
    tr.dataset.automation = r.automationName;
    tr.dataset.status = r.status;
    tr.style.borderTop = '1px solid #eee';
    const when = new Date(r.startedAt).toLocaleString();
    tr.style.cursor = 'pointer';
    tr.innerHTML =
      '<td style="padding:6px;" data-testid="history-automation">' + r.automationName + '</td>' +
      '<td style="padding:6px;" data-testid="history-when">' + when + '</td>' +
      '<td style="padding:6px; font-weight:600; color:' + (STATUS_COLOR[r.status] || '#333') + '" data-testid="history-status">' + r.status + '</td>';
    tr.addEventListener('click', () => inspectRun(r.runId));
    tbody.appendChild(tr);
  }
  $('#run-detail').innerHTML = '';
  $('#history-panel').style.display = 'block';
}

// B24: open a past run and inspect per-step input/output/error.
async function inspectRun(runId) {
  const data = await fetch('/runs/' + runId + '/steps').then((r) => r.json());
  const el = $('#run-detail');
  el.dataset.runId = runId;
  el.dataset.persisted = String(data.persisted ?? false);
  let html = '<h3 style="font-size:13px; margin:6px 0;">Run ' + runId + ' — ' + data.status + (data.persisted ? ' (from saved record)' : '') + '</h3>';
  for (const [stepId, s] of Object.entries(data.steps || {})) {
    html += '<div class="step-detail" data-testid="step-detail" data-step-id="' + stepId + '" data-step-status="' + s.status + '" style="border:1px solid #e6e8ee; border-radius:8px; padding:8px; margin-bottom:8px;">' +
      '<div style="font-weight:600;">' + stepId + ' — <span style="color:' + (STATUS_COLOR[s.status] || '#333') + '">' + s.status + '</span></div>' +
      (s.input !== undefined ? '<div style="font-size:11px;color:#6b7280;margin-top:4px;">input</div><pre data-testid="step-input" style="font-size:11px;background:#f6f7f9;padding:6px;border-radius:6px;overflow-x:auto;">' + JSON.stringify(s.input) + '</pre>' : '') +
      (s.output !== undefined ? '<div style="font-size:11px;color:#6b7280;">output</div><pre data-testid="step-output-detail" style="font-size:11px;background:#f6f7f9;padding:6px;border-radius:6px;overflow-x:auto;">' + JSON.stringify(s.output) + '</pre>' : '') +
      (s.error !== undefined ? '<div style="font-size:11px;color:#e03131;">error cause</div><pre data-testid="step-error" style="font-size:11px;background:#fff0f0;padding:6px;border-radius:6px;">' + s.error + '</pre>' : '') +
      '</div>';
  }
  el.innerHTML = html;
}
$('#btn-history').addEventListener('click', showHistory);
$('#btn-history-close').addEventListener('click', () => { $('#history-panel').style.display = 'none'; });

// Import a genuine n8n export: send it to the engine's importer, then load the
// returned graph onto the canvas (B19).
$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  const res = await fetch('/import/n8n', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text }).then((r) => r.json());
  if (res.error) { $('#run-status').textContent = 'import failed: ' + res.error; return; }
  state.defId = null;
  $('#automation-name').value = res.name || 'Imported workflow';
  loadGraph(res.graph);
  history.replaceState(null, '', location.pathname);
  $('#run-status').textContent = 'imported ' + (res.name || '') + ' (' + res.graph.nodes.length + ' steps)';
  $('#run-status').dataset.imported = 'true';
  // Surface any unsupported nodes (B21) — never drop them silently.
  const warn = $('#import-warning');
  if (res.unsupported && res.unsupported.length) {
    warn.dataset.unsupportedCount = String(res.unsupported.length);
    warn.dataset.unsupported = JSON.stringify(res.unsupported);
    warn.textContent = '⚠ ' + res.unsupported.length + ' unsupported step(s) not imported: ' +
      res.unsupported.map((u) => `${u.name} [${u.type}]`).join(', ');
  } else {
    warn.dataset.unsupportedCount = '0';
    warn.textContent = '';
  }
});

// Export the current automation to n8n-compatible JSON and download it (B22).
$('#btn-export').addEventListener('click', async () => {
  const body = JSON.stringify({ name: $('#automation-name').value || 'Exported automation', graph: toGraph() });
  const n8n = await fetch('/export/n8n', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then((r) => r.json());
  const blob = new Blob([JSON.stringify(n8n, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = ($('#automation-name').value || 'workflow') + '.n8n.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  $('#run-status').textContent = 'exported n8n JSON (' + n8n.nodes.length + ' nodes)';
});

// On load: if ?def=ID present, restore from durable storage (B15 fresh session).
const params = new URLSearchParams(location.search);
if (params.get('def')) loadById(params.get('def'));
else render();
