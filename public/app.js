// Visual workflow builder (B13-B16, B18). Talks to the engine's HTTP API:
//   POST /workflows/run-graph  - run the canvas (B16)
//   GET  /runs/:id/steps       - per-step live status/output (B17/B18)
//   POST/PUT/GET /definitions  - save/load durable definitions (B15, reusing B10)

const STEP_TYPES = [
  { type: 'httpRequest', label: 'Call a web service', hint: 'HTTP request', category: 'Actions', icon: '🌐', desc: 'Call a web service with an HTTP request.' },
  { type: 'transform', label: 'Reshape data', hint: 'Transform / Set', category: 'Transform', icon: '✏️', desc: 'Reshape items — set, copy, rename and remove fields.' },
  { type: 'if', label: 'Branch on a condition', hint: 'Conditional (IF)', category: 'Flow', icon: '❓', desc: 'Branch the run true/false on a condition.' },
  { type: 'switch', label: 'Route by rules', hint: 'Switch (multi-way)', category: 'Flow', icon: '🔀', desc: 'Route each item to an output by rules (multi-way).' },
  { type: 'filter', label: 'Keep matching items', hint: 'Filter', category: 'Flow', icon: '🔎', desc: 'Keep only items matching a condition; drop the rest.' },
  { type: 'merge', label: 'Merge inputs', hint: 'Merge', category: 'Flow', icon: '🔗', desc: 'Combine items from multiple incoming branches into one output.' },
  { type: 'loop', label: 'Loop over items', hint: 'Loop (batches)', category: 'Flow', icon: '🔁', desc: 'Iterate items in batches: run the loop body once per batch, then continue on the done output.' },
  { type: 'wait', label: 'Wait', hint: 'Pause', category: 'Flow', icon: '⏱️', desc: 'Pause the run for a configured time, then pass items through unchanged.' },
  { type: 'noop', label: 'No operation', hint: 'No-Op', category: 'Flow', icon: '➡️', desc: 'A no-op: passes items straight through unchanged.' },
  { type: 'stopError', label: 'Stop and error', hint: 'Stop And Error', category: 'Flow', icon: '🛑', desc: 'Deliberately fail the run with a custom error message, aborting downstream.' },
  { type: 'executeSubworkflow', label: 'Execute sub-workflow', hint: 'Execute Workflow', category: 'Actions', icon: '📦', desc: 'Run another saved automation as a step, feeding it these items and returning its results.' },
  { type: 'code', label: 'Run a code snippet', hint: 'Code / Function', category: 'Code', icon: '💻', desc: 'Run a JavaScript snippet over the items.' },
];
const LABELS = Object.fromEntries(STEP_TYPES.map((s) => [s.type, s.label]));
const CATEGORY_ORDER = ['Actions', 'Transform', 'Flow', 'Code'];

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
  if (type === 'switch') return { rules: [{ left: 'json.value', op: 'gt', right: 0 }], fallback: true };
  if (type === 'filter') return { condition: { left: 'json.value', op: 'gte', right: 0 } };
  if (type === 'merge') return { mode: 'append' };
  if (type === 'loop') return { batchSize: 1 };
  if (type === 'wait') return { ms: 1500 };
  if (type === 'stopError') return { message: 'Stopped with error' };
  if (type === 'executeSubworkflow') return { definitionId: '' };
  if (type === 'code') return { code: 'return $input;' };
  return {};
}

// Output ports a node exposes (drives rendering + connection 'port' values).
function portsOf(node) {
  if (node.type === 'if') return ['true', 'false'];
  if (node.type === 'loop') return ['loop', 'done'];
  if (node.type === 'switch') {
    const rules = (node.params && Array.isArray(node.params.rules)) ? node.params.rules : [];
    const ports = rules.map((_, i) => String(i));
    if (node.params && node.params.fallback) ports.push('fallback');
    return ports;
  }
  return ['main'];
}
function portLabel(port) {
  if (port === 'true') return 'T';
  if (port === 'false') return 'F';
  if (port === 'fallback') return '*';
  if (port === 'loop') return '↻';
  if (port === 'done') return '✓';
  if (port === 'main') return '→';
  return String(Number(port) + 1); // rule outputs shown 1-based
}

function addNode(type, pos) {
  const count = state.nodes.length;
  const node = {
    id: nid(),
    type,
    label: LABELS[type],
    x: pos ? Math.max(0, Math.round(pos.x)) : 60 + (count % 3) * 230,
    y: pos ? Math.max(0, Math.round(pos.y)) : 60 + Math.floor(count / 3) * 110,
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
  const ports = portsOf(node);
  if (ports.length <= 1) return { x, y: node.y + 22 };
  const idx = Math.max(0, ports.indexOf(port));
  return { x, y: node.y + 16 + idx * 18 }; // stack multiple outputs down the right edge
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

// Delete a step WITH confirmation (B29). Nothing is removed until confirmed.
function promptDeleteStep(nodeId) {
  state.pendingDelete = nodeId;
  const n = nodeById(nodeId);
  const incident = state.connections.filter((c) => c.from === nodeId || c.to === nodeId).length;
  document.querySelector('#confirm-delete-msg').textContent =
    `Delete "${n ? n.label : nodeId}" and its ${incident} connection(s)? This cannot be undone.`;
  document.querySelector('#confirm-delete').style.display = 'flex';
}
function confirmDeleteStep() {
  const nodeId = state.pendingDelete;
  state.pendingDelete = null;
  document.querySelector('#confirm-delete').style.display = 'none';
  if (!nodeId) return;
  // Remove the step AND every connection to or from it (no orphaned links).
  state.nodes = state.nodes.filter((n) => n.id !== nodeId);
  state.connections = state.connections.filter((c) => c.from !== nodeId && c.to !== nodeId);
  if (state.selectedId === nodeId) state.selectedId = null;
  render();
}
function cancelDeleteStep() {
  state.pendingDelete = null;
  document.querySelector('#confirm-delete').style.display = 'none';
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
    const portList = portsOf(n);
    for (const p of portList) {
      const pe = document.createElement('div');
      pe.className = 'port' + (state.arm && state.arm.from === n.id && state.arm.port === p ? ' armed' : '');
      pe.dataset.testid = 'port';
      pe.dataset.nodeId = n.id;
      pe.dataset.port = p;
      pe.title = 'drag from output ' + p + ' to a target step';
      pe.textContent = portLabel(p);
      pe.addEventListener('mousedown', (ev) => { ev.stopPropagation(); ev.preventDefault(); startConnectDrag(n.id, p, ev); });
      ports.appendChild(pe);
    }
    el.appendChild(ports);
    // Delete affordance on the node (asks for confirmation first — B29).
    const delBtn = document.createElement('button');
    delBtn.className = 'node-delete';
    delBtn.dataset.testid = 'node-delete';
    delBtn.dataset.nodeId = n.id;
    delBtn.textContent = '×';
    delBtn.title = 'delete step';
    delBtn.style.cssText = 'position:absolute; top:-8px; left:-8px; width:18px; height:18px; line-height:15px; border-radius:50%; border:1px solid #c1182c; background:#fff; color:#c1182c; cursor:pointer; padding:0;';
    delBtn.addEventListener('mousedown', (ev) => ev.stopPropagation());
    delBtn.addEventListener('click', (ev) => { ev.stopPropagation(); promptDeleteStep(n.id); });
    el.appendChild(delBtn);
    // Drag the node body to MOVE it (B28); a click (no drag) selects/completes.
    el.addEventListener('mousedown', (ev) => {
      if (ev.target.closest('.port') || ev.target.closest('.conn-del') || ev.target.closest('.node-delete')) return;
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
  } else if (n.type === 'switch') {
    n.params.rules = Array.isArray(n.params.rules) ? n.params.rules : [];
    const ops = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'truthy', 'contains'];
    const lab = document.createElement('label'); lab.textContent = 'Routing rules (each routes matching items to its own output)';
    c.appendChild(lab);
    n.params.rules.forEach((rule, i) => {
      const row = document.createElement('div');
      row.dataset.testid = 'switch-rule';
      row.dataset.ruleIndex = String(i);
      row.style.cssText = 'display:flex; gap:4px; align-items:center; margin-bottom:6px;';
      row.innerHTML = `<span style="font-size:11px; color:#6b7280; width:54px;">out ${i + 1}:</span>`;
      const left = input(rule.left, (v) => (rule.left = v)); left.dataset.testid = `switch-rule-${i}-left`; left.style.flex = '1';
      const sel = document.createElement('select'); sel.dataset.testid = `switch-rule-${i}-op`;
      for (const op of ops) { const o = document.createElement('option'); o.value = op; o.textContent = op; if (rule.op === op) o.selected = true; sel.appendChild(o); }
      sel.addEventListener('change', () => { rule.op = sel.value; });
      const right = input(String(rule.right ?? ''), (v) => { const num = Number(v); rule.right = v !== '' && !Number.isNaN(num) ? num : v; }); right.dataset.testid = `switch-rule-${i}-right`; right.style.width = '70px';
      const rm = document.createElement('button'); rm.textContent = '×'; rm.dataset.testid = `switch-rule-${i}-remove`;
      rm.addEventListener('click', () => { n.params.rules.splice(i, 1); render(); });
      row.append(left, sel, right, rm);
      c.appendChild(row);
    });
    const addBtn = document.createElement('button'); addBtn.textContent = '+ Add rule'; addBtn.dataset.testid = 'switch-add-rule';
    addBtn.addEventListener('click', () => { n.params.rules.push({ left: 'json.value', op: 'eq', right: '' }); render(); });
    c.appendChild(addBtn);
    const fbWrap = document.createElement('div'); fbWrap.style.marginTop = '8px';
    const fb = document.createElement('input'); fb.type = 'checkbox'; fb.checked = !!n.params.fallback; fb.dataset.testid = 'switch-fallback';
    fb.addEventListener('change', () => { n.params.fallback = fb.checked; render(); });
    const fbLab = document.createElement('label'); fbLab.style.cssText = 'display:inline; font-weight:400;'; fbLab.textContent = ' Fallback output for items matching no rule';
    fbWrap.append(fb, fbLab);
    c.appendChild(fbWrap);
  } else if (n.type === 'filter') {
    n.params.condition = n.params.condition || { left: '', op: 'gte', right: 0 };
    const k = document.createElement('div'); k.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; k.textContent = 'Keep items matching (others are dropped):';
    c.appendChild(k);
    c.appendChild(field('Field (path)', 'cfg-left', input(n.params.condition.left, (v) => (n.params.condition.left = v))));
    const sel = document.createElement('select');
    for (const op of ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'truthy', 'contains']) { const o = document.createElement('option'); o.value = op; o.textContent = op; if (n.params.condition.op === op) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.condition.op = sel.value; });
    c.appendChild(field('Operator', 'cfg-op', sel));
    c.appendChild(field('Compare value', 'cfg-right', input(String(n.params.condition.right ?? ''), (v) => { const num = Number(v); n.params.condition.right = v !== '' && !Number.isNaN(num) ? num : v; })));
  } else if (n.type === 'merge') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Combines items from all incoming branches into one output.';
    c.appendChild(note);
    n.params.mode = n.params.mode || 'append';
    const sel = document.createElement('select');
    for (const m of ['append']) { const o = document.createElement('option'); o.value = m; o.textContent = m; if (n.params.mode === m) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.mode = sel.value; });
    c.appendChild(field('Combine mode', 'cfg-merge-mode', sel));
  } else if (n.type === 'loop') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Runs the loop body once per batch; the done output runs after the final batch.';
    c.appendChild(note);
    n.params.batchSize = n.params.batchSize || 1;
    const inp = input(String(n.params.batchSize), (v) => { const num = Math.max(1, Math.floor(Number(v) || 1)); n.params.batchSize = num; });
    inp.type = 'number'; inp.min = '1';
    c.appendChild(field('Batch size', 'cfg-batch-size', inp));
  } else if (n.type === 'wait') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Pauses the run for the duration, then passes items through unchanged.';
    c.appendChild(note);
    n.params.ms = n.params.ms ?? 1500;
    const inp = input(String(n.params.ms), (v) => { const num = Math.max(0, Math.floor(Number(v) || 0)); n.params.ms = num; });
    inp.type = 'number'; inp.min = '0';
    c.appendChild(field('Duration (ms)', 'cfg-wait-ms', inp));
  } else if (n.type === 'noop') {
    const note = document.createElement('div'); note.dataset.testid = 'cfg-noop-note'; note.style.cssText = 'font-size:12px;color:#6b7280;'; note.textContent = 'No configuration — passes items through unchanged.';
    c.appendChild(note);
  } else if (n.type === 'stopError') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Fails the run with this message when reached; downstream does not run.';
    c.appendChild(note);
    n.params.message = n.params.message ?? 'Stopped with error';
    c.appendChild(field('Error message', 'cfg-error-message', input(n.params.message, (v) => (n.params.message = v))));
  } else if (n.type === 'executeSubworkflow') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Runs the selected saved automation with these items as its input.';
    c.appendChild(note);
    const sel = document.createElement('select');
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— select a saved automation —'; sel.appendChild(ph);
    sel.addEventListener('change', () => { n.params.definitionId = sel.value; });
    c.appendChild(field('Sub-workflow', 'cfg-subworkflow', sel));
    // Populate from the saved definitions list (async).
    fetch('/definitions').then((r) => r.json()).then((list) => {
      for (const d of list) { const o = document.createElement('option'); o.value = d.id; o.textContent = d.name + ' (' + d.id.slice(0, 12) + '…)'; if (n.params.definitionId === d.id) o.selected = true; sel.appendChild(o); }
    }).catch(() => {});
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
      let text = res.runId + ' → ' + s.status;
      if (s.status === 'failed') {
        // Surface the failure message to the user (e.g. a Stop and Error message).
        const failed = Object.values(s.steps).find((st) => st.status === 'failed' && st.error);
        const msg = failed ? failed.error : '';
        if (msg) { text += ': ' + msg; $('#run-status').dataset.errorMessage = msg; }
      }
      $('#run-status').textContent = text;
      $('#run-status').dataset.runState = s.status;
    }
  }, 250);
}

// ---- wire up ----
// Custom hover tooltip (shows the node's name + description on hover) — B33.
const paletteTooltip = document.createElement('div');
paletteTooltip.id = 'palette-tooltip';
paletteTooltip.dataset.testid = 'palette-tooltip';
paletteTooltip.style.display = 'none';
document.body.appendChild(paletteTooltip);

// Palette organised into categories with headings and compact icon buttons (B33).
const palette = $('#palette');
for (const cat of CATEGORY_ORDER) {
  const inCat = STEP_TYPES.filter((s) => s.category === cat);
  if (!inCat.length) continue;
  const heading = document.createElement('div');
  heading.className = 'palette-category';
  heading.dataset.testid = 'palette-category';
  heading.dataset.category = cat;
  heading.textContent = cat;
  palette.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'palette-grid';
  for (const st of inCat) {
    const btn = document.createElement('button');
    btn.className = 'palette-item';
    btn.dataset.testid = 'palette-item';
    btn.dataset.stepType = st.type;
    btn.setAttribute('aria-label', st.label);
    btn.innerHTML = '<span class="pi-icon" data-testid="palette-icon">' + st.icon + '</span><span class="pi-name">' + st.label + '</span>';
    // Click adds at an auto position (kept for no-regression, B30 E6).
    btn.addEventListener('click', () => addNode(st.type));
    // Drag a palette entry onto the canvas to drop it at a chosen location (B30).
    btn.addEventListener('mousedown', (ev) => { state.paletteDrag = { type: st.type, startX: ev.clientX, startY: ev.clientY, moved: false }; });
    // Hover tooltip with name + description (B33 E3).
    btn.addEventListener('mouseenter', () => {
      paletteTooltip.innerHTML = '<strong data-testid="tooltip-name">' + st.label + '</strong><div data-testid="tooltip-desc">' + st.desc + '</div>';
      const r = btn.getBoundingClientRect();
      paletteTooltip.style.left = r.right + 8 + 'px';
      paletteTooltip.style.top = r.top + 'px';
      paletteTooltip.style.display = 'block';
    });
    btn.addEventListener('mouseleave', () => { paletteTooltip.style.display = 'none'; });
    grid.appendChild(btn);
  }
  palette.appendChild(grid);
}

// Palette drag-and-drop: create a step at the DROP position on the canvas.
document.addEventListener('mousemove', (ev) => {
  const pd = state.paletteDrag;
  if (!pd) return;
  if (Math.abs(ev.clientX - pd.startX) > DRAG_THRESHOLD || Math.abs(ev.clientY - pd.startY) > DRAG_THRESHOLD) {
    pd.moved = true;
    let ghost = document.getElementById('palette-ghost');
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.id = 'palette-ghost';
      ghost.style.cssText = 'position:fixed; pointer-events:none; z-index:50; padding:6px 10px; border-radius:8px; background:#eef2ff; border:1px solid #4c6ef5; font-size:12px;';
      ghost.textContent = LABELS[pd.type];
      document.body.appendChild(ghost);
    }
    ghost.style.left = ev.clientX + 8 + 'px';
    ghost.style.top = ev.clientY + 8 + 'px';
  }
});
document.addEventListener('mouseup', (ev) => {
  const pd = state.paletteDrag;
  if (!pd) return;
  state.paletteDrag = null;
  const ghost = document.getElementById('palette-ghost');
  if (ghost) ghost.remove();
  if (!pd.moved) return; // a plain click is handled by the click listener
  const overCanvas = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('#canvas');
  if (overCanvas) {
    const r = canvas.getBoundingClientRect();
    addNode(pd.type, { x: ev.clientX - r.left, y: ev.clientY - r.top }); // create AT the drop position
  }
});
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
$('#confirm-delete-yes').addEventListener('click', confirmDeleteStep);
$('#confirm-delete-no').addEventListener('click', cancelDeleteStep);
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
