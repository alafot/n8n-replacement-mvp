// Visual workflow builder (B13-B16, B18). Talks to the engine's HTTP API:
//   POST /workflows/run-graph  - run the canvas (B16)
//   GET  /runs/:id/steps       - per-step live status/output (B17/B18)
//   POST/PUT/GET /definitions  - save/load durable definitions (B15, reusing B10)

const STEP_TYPES = [
  { type: 'scheduleTrigger', label: 'Schedule trigger', hint: 'Schedule', category: 'Trigger', icon: '⏰', desc: 'Entry point: starts the automation on a configured schedule (interval).' },
  { type: 'webhookTrigger', label: 'Webhook trigger', hint: 'Webhook', category: 'Trigger', icon: '🪝', desc: 'Entry point: starts the automation when an HTTP request hits its path, carrying the payload.' },
  { type: 'formTrigger', label: 'Form trigger', hint: 'Form', category: 'Trigger', icon: '📝', desc: 'Entry point: serves a web form; submitting it starts a run carrying the entered values.' },
  { type: 'errorTrigger', label: 'Error trigger', hint: 'Error Trigger', category: 'Trigger', icon: '⚠️', desc: 'Entry point: runs this automation when a linked target automation fails, with the failure details.' },
  { type: 'httpRequest', label: 'Call a web service', hint: 'HTTP request', category: 'Actions', icon: '🌐', desc: 'Call a web service with an HTTP request.' },
  { type: 'transform', label: 'Reshape data', hint: 'Transform / Set', category: 'Transform', icon: '✏️', desc: 'Reshape items — set, copy, rename and remove fields.' },
  { type: 'htmlExtract', label: 'Extract from HTML', hint: 'HTML Extract', category: 'Transform', icon: '🔖', desc: 'Pull values out of HTML by CSS selector (element text or a named attribute) into named fields.' },
  { type: 'xml', label: 'XML ⇄ JSON', hint: 'XML', category: 'Transform', icon: '📄', desc: 'Convert XML to JSON (parse an XML string into structured JSON) or JSON back to XML.' },
  { type: 'markdown', label: 'Markdown ⇄ HTML', hint: 'Markdown', category: 'Transform', icon: '📝', desc: 'Convert Markdown text to HTML (headings, bold/italic, code, links, lists) or HTML back to Markdown.' },
  { type: 'crypto', label: 'Crypto', hint: 'Crypto', category: 'Transform', icon: '🔐', desc: 'Hash a field (MD5/SHA1/SHA256/SHA512) or base64 encode/decode, writing the result to a named field.' },
  { type: 'aggregate', label: 'Aggregate', hint: 'Aggregate', category: 'Transform', icon: '📊', desc: 'Collapse a field from many items into one item carrying all the collected values.' },
  { type: 'splitOut', label: 'Split out', hint: 'Split Out', category: 'Transform', icon: '✂️', desc: 'Expand an item\'s list field into multiple items, one per element.' },
  { type: 'sort', label: 'Sort', hint: 'Sort', category: 'Transform', icon: '↕️', desc: 'Reorder items by a chosen field, ascending or descending.' },
  { type: 'limit', label: 'Limit', hint: 'Limit', category: 'Transform', icon: '🔢', desc: 'Cap how many items pass through, keeping at most N.' },
  { type: 'removeDuplicates', label: 'Remove duplicates', hint: 'Remove Duplicates', category: 'Transform', icon: '🧹', desc: 'Drop duplicate items, keeping only the distinct ones.' },
  { type: 'renameKeys', label: 'Rename keys', hint: 'Rename Keys', category: 'Transform', icon: '🏷️', desc: 'Rename fields (old name → new name), preserving values and other fields.' },
  { type: 'dateTime', label: 'Date & time', hint: 'Date & Time', category: 'Transform', icon: '📅', desc: 'Format a date or add/subtract a span, writing the result onto the item.' },
  { type: 'summarize', label: 'Summarize', hint: 'Summarize', category: 'Transform', icon: '🧮', desc: 'Compute summary statistics (sum/count/avg/min/max), optionally grouped by a field.' },
  { type: 'compareDatasets', label: 'Compare datasets', hint: 'Compare Datasets', category: 'Transform', icon: '⚖️', desc: 'Compare two inputs by a key into matched / only-in-A / only-in-B.' },
  { type: 'if', label: 'Branch on a condition', hint: 'Conditional (IF)', category: 'Flow', icon: '❓', desc: 'Branch the run true/false on a condition.' },
  { type: 'switch', label: 'Route by rules', hint: 'Switch (multi-way)', category: 'Flow', icon: '🔀', desc: 'Route each item to an output by rules (multi-way).' },
  { type: 'filter', label: 'Keep matching items', hint: 'Filter', category: 'Flow', icon: '🔎', desc: 'Keep only items matching a condition; drop the rest.' },
  { type: 'merge', label: 'Merge inputs', hint: 'Merge', category: 'Flow', icon: '🔗', desc: 'Combine items from multiple incoming branches into one output.' },
  { type: 'loop', label: 'Loop over items', hint: 'Loop (batches)', category: 'Flow', icon: '🔁', desc: 'Iterate items in batches: run the loop body once per batch, then continue on the done output.' },
  { type: 'wait', label: 'Wait', hint: 'Pause', category: 'Flow', icon: '⏱️', desc: 'Pause the run for a configured time, then pass items through unchanged.' },
  { type: 'noop', label: 'No operation', hint: 'No-Op', category: 'Flow', icon: '➡️', desc: 'A no-op: passes items straight through unchanged.' },
  { type: 'stopError', label: 'Stop and error', hint: 'Stop And Error', category: 'Flow', icon: '🛑', desc: 'Deliberately fail the run with a custom error message, aborting downstream.' },
  { type: 'executeSubworkflow', label: 'Execute sub-workflow', hint: 'Execute Workflow', category: 'Actions', icon: '📦', desc: 'Run another saved automation as a step, feeding it these items and returning its results.' },
  { type: 'respondToWebhook', label: 'Respond to webhook', hint: 'Respond to Webhook', category: 'Actions', icon: '↩️', desc: 'Send a custom HTTP response (status + body) back to the webhook caller.' },
  { type: 'code', label: 'Run a code snippet', hint: 'Code / Function', category: 'Code', icon: '💻', desc: 'Run a JavaScript snippet over the items.' },
];
const LABELS = Object.fromEntries(STEP_TYPES.map((s) => [s.type, s.label]));
const CATEGORY_ORDER = ['Trigger', 'Actions', 'Transform', 'Flow', 'Code'];

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
  if (type === 'htmlExtract') return { htmlField: 'json.body', rules: [{ selector: 'h1', returnType: 'text', attribute: '', output: 'title' }] };
  if (type === 'xml') return { sourceField: 'json.body', direction: 'xmlToJson', outputName: 'data' };
  if (type === 'markdown') return { sourceField: 'json.body', direction: 'markdownToHtml', outputName: 'html' };
  if (type === 'crypto') return { action: 'hash', algorithm: 'sha256', sourceField: 'json.value', outputName: 'hash' };
  if (type === 'if') return { condition: { left: 'json.value', op: 'gt', right: 0 } };
  if (type === 'switch') return { rules: [{ left: 'json.value', op: 'gt', right: 0 }], fallback: true };
  if (type === 'filter') return { condition: { left: 'json.value', op: 'gte', right: 0 } };
  if (type === 'merge') return { mode: 'append' };
  if (type === 'aggregate') return { field: 'json.value', outputName: 'values' };
  if (type === 'splitOut') return { field: 'json.values', outputName: 'value' };
  if (type === 'sort') return { field: 'json.value', direction: 'asc' };
  if (type === 'limit') return { max: 1, keep: 'first' };
  if (type === 'removeDuplicates') return { by: 'field', field: 'json.id' };
  if (type === 'renameKeys') return { renames: { first: 'name' } };
  if (type === 'dateTime') return { operation: 'add', dateField: 'json.date', amount: 1, unit: 'days', format: 'YYYY-MM-DD', outputName: 'result' };
  if (type === 'summarize') return { func: 'sum', field: 'json.amount', groupBy: '', outputName: 'total' };
  if (type === 'compareDatasets') return { keyField: 'json.id' };
  if (type === 'scheduleTrigger') return { intervalSeconds: 1 };
  if (type === 'webhookTrigger') return { path: 'hook' };
  if (type === 'respondToWebhook') return { status: 200, bodyMode: 'firstItem', staticBody: '{}' };
  if (type === 'formTrigger') return { path: 'form', fields: ['name'] };
  if (type === 'errorTrigger') return { targetDefinitionId: '' };
  if (type === 'loop') return { batchSize: 1 };
  if (type === 'wait') return { ms: 1500 };
  if (type === 'stopError') return { message: 'Stopped with error' };
  if (type === 'executeSubworkflow') return { definitionId: '' };
  if (type === 'code') return { code: 'return $input;' };
  return {};
}

// Output ports a node exposes (drives rendering + connection 'port' values).
// Input ports a node exposes (left side). Most nodes have a single implicit
// input; multi-input nodes (Compare Datasets) expose named inputs.
function inputsOf(node) {
  if (node.type === 'compareDatasets') return ['a', 'b'];
  return [];
}
function portsOf(node) {
  if (node.type === 'if') return ['true', 'false'];
  if (node.type === 'loop') return ['loop', 'done'];
  if (node.type === 'compareDatasets') return ['matched', 'onlyA', 'onlyB'];
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
  if (port === 'matched') return 'M';
  if (port === 'onlyA' || port === 'a') return 'A';
  if (port === 'onlyB' || port === 'b') return 'B';
  if (port === 'main') return '→';
  return String(Number(port) + 1); // rule outputs shown 1-based
}
function inputPortPoint(node, port) {
  const ins = inputsOf(node);
  const idx = Math.max(0, ins.indexOf(port));
  return { x: node.x, y: node.y + 16 + idx * 18 };
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
// Target endpoint of a connection: a specific input handle if the edge feeds a
// named input (e.g. Compare Datasets A/B), else the node's left-centre.
function connTargetPoint(conn) {
  const to = nodeById(conn.to);
  if (!to) return { x: 0, y: 0 };
  if (conn.toPort && inputsOf(to).includes(conn.toPort)) return inputPortPoint(to, conn.toPort);
  return nodeInPoint(to);
}
function armConnection(from, port) {
  state.arm = { from, port };
  render();
}
function connect(fromId, port, toId, toPort) {
  if (!fromId || !toId || fromId === toId) return;
  const conn = { id: 'c' + (state.counter += 1), from: fromId, to: toId, port };
  if (toPort) conn.toPort = toPort;
  state.connections.push(conn);
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
    const a = portPoint(from, c.port), b = connTargetPoint(c);
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
    // Forgiving target: drop on the target node's body, OR on a specific input
    // handle (e.g. Compare Datasets A/B) to feed that named input.
    const elAt = document.elementFromPoint(ev.clientX, ev.clientY);
    const overInput = elAt?.closest('.input-port');
    const overNode = elAt?.closest('.node');
    if (d.moved && overInput) {
      connect(d.from, d.port, overInput.dataset.nodeId, overInput.dataset.port); // drag to a named input
    } else if (d.moved && overNode) {
      connect(d.from, d.port, overNode.dataset.nodeId); // drag-connect (default input)
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
    connections: state.connections.map((c) => ({ id: c.id, from: c.from, to: c.to, port: c.port, ...(c.toPort ? { toPort: c.toPort } : {}) })),
  };
}
function loadGraph(graph) {
  state.nodes = (graph.nodes || []).map((n) => ({
    id: n.id, type: n.type, label: n.label || LABELS[n.type] || n.type,
    x: n.position ? n.position.x : 60, y: n.position ? n.position.y : 60, params: n.params || defaultParams(n.type),
  }));
  state.connections = (graph.connections || []).map((c, i) => ({ id: c.id || 'c' + i, from: c.from, to: c.to, port: c.port || 'main', ...(c.toPort ? { toPort: c.toPort } : {}) }));
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
    // input ports (left side) for multi-input nodes (drop a connection here).
    const ins = inputsOf(n);
    if (ins.length) {
      const inWrap = document.createElement('div');
      inWrap.className = 'in-ports';
      for (const ip of ins) {
        const ie = document.createElement('div');
        ie.className = 'input-port';
        ie.dataset.testid = 'input-port';
        ie.dataset.nodeId = n.id;
        ie.dataset.port = ip;
        ie.title = 'input ' + ip;
        ie.textContent = portLabel(ip);
        inWrap.appendChild(ie);
      }
      el.appendChild(inWrap);
    }
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
      if (ev.target.closest('.port') || ev.target.closest('.input-port') || ev.target.closest('.conn-del') || ev.target.closest('.node-delete')) return;
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
    const a = portPoint(from, c.port), b = connTargetPoint(c);
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
    del.dataset.from = c.from; del.dataset.to = c.to; del.dataset.port = c.port; if (c.toPort) del.dataset.toPort = c.toPort;
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
  } else if (n.type === 'aggregate') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Collapses many items into one; the output field holds all the collected values.';
    c.appendChild(note);
    n.params.field = n.params.field ?? 'json.value';
    n.params.outputName = n.params.outputName ?? 'values';
    c.appendChild(field('Field to aggregate (path)', 'cfg-agg-field', input(n.params.field, (v) => (n.params.field = v))));
    c.appendChild(field('Output field name', 'cfg-agg-output', input(n.params.outputName, (v) => (n.params.outputName = v))));
  } else if (n.type === 'splitOut') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Expands a list field into one item per element.';
    c.appendChild(note);
    n.params.field = n.params.field ?? 'json.values';
    n.params.outputName = n.params.outputName ?? 'value';
    c.appendChild(field('List field to split (path)', 'cfg-split-field', input(n.params.field, (v) => (n.params.field = v))));
    c.appendChild(field('Output field name', 'cfg-split-output', input(n.params.outputName, (v) => (n.params.outputName = v))));
  } else if (n.type === 'sort') {
    n.params.field = n.params.field ?? 'json.value';
    n.params.direction = n.params.direction ?? 'asc';
    c.appendChild(field('Sort by field (path)', 'cfg-sort-field', input(n.params.field, (v) => (n.params.field = v))));
    const sel = document.createElement('select');
    for (const d of ['asc', 'desc']) { const o = document.createElement('option'); o.value = d; o.textContent = d === 'asc' ? 'Ascending' : 'Descending'; if (n.params.direction === d) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.direction = sel.value; });
    c.appendChild(field('Direction', 'cfg-sort-direction', sel));
  } else if (n.type === 'limit') {
    n.params.max = n.params.max ?? 1;
    n.params.keep = n.params.keep ?? 'first';
    const inp = input(String(n.params.max), (v) => { n.params.max = Math.max(0, Math.floor(Number(v) || 0)); });
    inp.type = 'number'; inp.min = '0';
    c.appendChild(field('Max items', 'cfg-limit-max', inp));
    const sel = document.createElement('select');
    for (const k of ['first', 'last']) { const o = document.createElement('option'); o.value = k; o.textContent = k === 'first' ? 'Keep first N' : 'Keep last N'; if (n.params.keep === k) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.keep = sel.value; });
    c.appendChild(field('Keep', 'cfg-limit-keep', sel));
  } else if (n.type === 'removeDuplicates') {
    n.params.by = n.params.by ?? 'field';
    n.params.field = n.params.field ?? 'json.id';
    const sel = document.createElement('select');
    for (const b of ['field', 'whole']) { const o = document.createElement('option'); o.value = b; o.textContent = b === 'field' ? 'By key field' : 'Whole item'; if (n.params.by === b) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.by = sel.value; });
    c.appendChild(field('Compare', 'cfg-dedup-by', sel));
    c.appendChild(field('Key field (path, when "By key field")', 'cfg-dedup-field', input(n.params.field, (v) => (n.params.field = v))));
  } else if (n.type === 'renameKeys') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Rename fields (old → new); values and other fields are preserved.';
    c.appendChild(note);
    n.params.renames = n.params.renames || {};
    c.appendChild(field('Rename mappings (JSON: "old":"new")', 'cfg-renames', textarea(jsonStr(n.params.renames), (v) => (n.params.renames = parseJsonSafe(v, n.params.renames)))));
  } else if (n.type === 'dateTime') {
    n.params.operation = n.params.operation ?? 'add';
    const sel = document.createElement('select');
    for (const op of ['add', 'subtract', 'format']) { const o = document.createElement('option'); o.value = op; o.textContent = op; if (n.params.operation === op) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.operation = sel.value; render(); });
    c.appendChild(field('Operation', 'cfg-dt-operation', sel));
    c.appendChild(field('Date field (path)', 'cfg-dt-field', input(n.params.dateField ?? 'json.date', (v) => (n.params.dateField = v))));
    if (n.params.operation === 'format') {
      c.appendChild(field('Format (YYYY MM DD HH mm ss)', 'cfg-dt-format', input(n.params.format ?? 'YYYY-MM-DD', (v) => (n.params.format = v))));
    } else {
      const amt = input(String(n.params.amount ?? 1), (v) => (n.params.amount = Number(v) || 0)); amt.type = 'number';
      c.appendChild(field('Amount', 'cfg-dt-amount', amt));
      const us = document.createElement('select');
      for (const u of ['days', 'hours', 'minutes', 'seconds']) { const o = document.createElement('option'); o.value = u; o.textContent = u; if ((n.params.unit ?? 'days') === u) o.selected = true; us.appendChild(o); }
      us.addEventListener('change', () => { n.params.unit = us.value; });
      c.appendChild(field('Unit', 'cfg-dt-unit', us));
    }
    c.appendChild(field('Output field name', 'cfg-dt-output', input(n.params.outputName ?? 'result', (v) => (n.params.outputName = v))));
  } else if (n.type === 'summarize') {
    n.params.func = n.params.func ?? 'sum';
    const sel = document.createElement('select');
    for (const f of ['sum', 'count', 'avg', 'min', 'max']) { const o = document.createElement('option'); o.value = f; o.textContent = f; if (n.params.func === f) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.func = sel.value; });
    c.appendChild(field('Function', 'cfg-sum-func', sel));
    c.appendChild(field('Field (path, numeric)', 'cfg-sum-field', input(n.params.field ?? 'json.amount', (v) => (n.params.field = v))));
    c.appendChild(field('Group by (path, optional)', 'cfg-sum-groupby', input(n.params.groupBy ?? '', (v) => (n.params.groupBy = v))));
    c.appendChild(field('Output field name', 'cfg-sum-output', input(n.params.outputName ?? 'total', (v) => (n.params.outputName = v))));
  } else if (n.type === 'compareDatasets') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Wire two inputs (A and B), then matched / only-in-A / only-in-B on the three outputs.';
    c.appendChild(note);
    n.params.keyField = n.params.keyField ?? 'json.id';
    c.appendChild(field('Match key field (path)', 'cfg-compare-key', input(n.params.keyField, (v) => (n.params.keyField = v))));
  } else if (n.type === 'scheduleTrigger') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Entry point. Save the automation, then Start the schedule to fire runs on the interval.';
    c.appendChild(note);
    n.params.intervalSeconds = n.params.intervalSeconds ?? 1;
    const inp = input(String(n.params.intervalSeconds), (v) => { n.params.intervalSeconds = Math.max(0.2, Number(v) || 1); });
    inp.type = 'number'; inp.step = '0.1'; inp.min = '0.2';
    c.appendChild(field('Interval (seconds)', 'cfg-schedule-interval', inp));
    const startBtn = document.createElement('button'); startBtn.textContent = 'Start schedule'; startBtn.dataset.testid = 'schedule-start'; startBtn.style.marginRight = '6px';
    startBtn.addEventListener('click', async () => {
      if (!state.defId) { $('#run-status').textContent = 'save the automation first'; return; }
      const r = await fetch('/definitions/' + state.defId + '/schedule/start', { method: 'POST' }).then((x) => x.json());
      $('#run-status').textContent = r.started ? 'schedule started (every ' + r.intervalMs + 'ms)' : 'schedule error: ' + (r.error || '');
      $('#run-status').dataset.scheduleMs = r.intervalMs || '';
    });
    const stopBtn = document.createElement('button'); stopBtn.textContent = 'Stop schedule'; stopBtn.dataset.testid = 'schedule-stop';
    stopBtn.addEventListener('click', async () => { if (!state.defId) return; await fetch('/definitions/' + state.defId + '/schedule/stop', { method: 'POST' }); $('#run-status').textContent = 'schedule stopped'; });
    const wrap = document.createElement('div'); wrap.style.marginTop = '8px'; wrap.append(startBtn, stopBtn);
    c.appendChild(wrap);
  } else if (n.type === 'webhookTrigger') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Entry point. A request to this path starts a run carrying the request payload.';
    c.appendChild(note);
    n.params.path = n.params.path ?? 'hook';
    const urlEl = document.createElement('input');
    const refreshUrl = () => { urlEl.value = location.origin + '/webhook/' + (n.params.path || ''); };
    c.appendChild(field('Path', 'cfg-webhook-path', input(n.params.path, (v) => { n.params.path = v; refreshUrl(); })));
    urlEl.readOnly = true; refreshUrl();
    c.appendChild(field('Listening URL', 'webhook-url', urlEl));
  } else if (n.type === 'respondToWebhook') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Sends the HTTP response to the webhook caller (use downstream of a Webhook trigger).';
    c.appendChild(note);
    n.params.status = n.params.status ?? 200;
    n.params.bodyMode = n.params.bodyMode ?? 'firstItem';
    const st = input(String(n.params.status), (v) => { n.params.status = Number(v) || 200; }); st.type = 'number';
    c.appendChild(field('Status code', 'cfg-respond-status', st));
    const sel = document.createElement('select');
    for (const m of ['firstItem', 'static']) { const o = document.createElement('option'); o.value = m; o.textContent = m === 'firstItem' ? "First item's data" : 'Static JSON'; if (n.params.bodyMode === m) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.bodyMode = sel.value; render(); });
    c.appendChild(field('Body', 'cfg-respond-bodymode', sel));
    if (n.params.bodyMode === 'static') {
      c.appendChild(field('Static body (JSON)', 'cfg-respond-body', textarea(n.params.staticBody ?? '{}', (v) => (n.params.staticBody = v))));
    }
  } else if (n.type === 'formTrigger') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Entry point. Save, then open the form URL; submitting it starts a run with the entered values.';
    c.appendChild(note);
    n.params.path = n.params.path ?? 'form';
    n.params.fields = Array.isArray(n.params.fields) ? n.params.fields : ['name'];
    const urlEl = document.createElement('input'); urlEl.readOnly = true;
    const refreshUrl = () => { urlEl.value = location.origin + '/form/' + (n.params.path || ''); };
    c.appendChild(field('Path', 'cfg-form-path', input(n.params.path, (v) => { n.params.path = v; refreshUrl(); })));
    c.appendChild(field('Fields (comma-separated)', 'cfg-form-fields', input(n.params.fields.join(','), (v) => { n.params.fields = v.split(',').map((s) => s.trim()).filter(Boolean); })));
    refreshUrl();
    c.appendChild(field('Form URL', 'form-url', urlEl));
  } else if (n.type === 'errorTrigger') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Entry point. Runs this automation when the linked target automation fails, with the failure details.';
    c.appendChild(note);
    const sel = document.createElement('select');
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = '— target automation to watch —'; sel.appendChild(ph);
    sel.addEventListener('change', () => { n.params.targetDefinitionId = sel.value; });
    c.appendChild(field('Handles failures of', 'cfg-error-target', sel));
    fetch('/definitions').then((r) => r.json()).then((list) => {
      for (const d of list) { const o = document.createElement('option'); o.value = d.id; o.textContent = d.name + ' (' + d.id.slice(0, 12) + '…)'; if (n.params.targetDefinitionId === d.id) o.selected = true; sel.appendChild(o); }
    }).catch(() => {});
  } else if (n.type === 'htmlExtract') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Pull values out of the source HTML by CSS selector (element text or a named attribute) into named fields.';
    c.appendChild(note);
    n.params.htmlField = n.params.htmlField ?? 'json.body';
    n.params.rules = Array.isArray(n.params.rules) ? n.params.rules : [];
    c.appendChild(field('Source HTML field (path)', 'cfg-html-source', input(n.params.htmlField, (v) => (n.params.htmlField = v))));
    const lab = document.createElement('label'); lab.textContent = 'Extraction rules (selector → field)';
    c.appendChild(lab);
    n.params.rules.forEach((rule, i) => {
      rule.returnType = rule.returnType ?? 'text';
      const row = document.createElement('div'); row.dataset.testid = 'extract-rule'; row.dataset.ruleIndex = String(i);
      row.style.cssText = 'border:1px solid #e5e7eb;border-radius:6px;padding:6px;margin-bottom:6px;';
      const selEl = input(rule.selector, (v) => (rule.selector = v)); selEl.placeholder = 'e.g. h1, a.cta, #price';
      row.appendChild(field('CSS selector', `cfg-rule-${i}-selector`, selEl));
      const ts = document.createElement('select');
      for (const t of ['text', 'attribute']) { const o = document.createElement('option'); o.value = t; o.textContent = t === 'text' ? 'Element text' : 'Named attribute'; if (rule.returnType === t) o.selected = true; ts.appendChild(o); }
      ts.addEventListener('change', () => { rule.returnType = ts.value; render(); });
      row.appendChild(field('Extract', `cfg-rule-${i}-type`, ts));
      if (rule.returnType === 'attribute') {
        const at = input(rule.attribute ?? '', (v) => (rule.attribute = v)); at.placeholder = 'e.g. href';
        row.appendChild(field('Attribute name', `cfg-rule-${i}-attr`, at));
      }
      row.appendChild(field('Into field', `cfg-rule-${i}-output`, input(rule.output ?? '', (v) => (rule.output = v))));
      const rm = document.createElement('button'); rm.textContent = 'Remove rule'; rm.dataset.testid = `cfg-rule-${i}-remove`; rm.style.marginTop = '4px';
      rm.addEventListener('click', () => { n.params.rules.splice(i, 1); render(); });
      row.appendChild(rm);
      c.appendChild(row);
    });
    const addBtn = document.createElement('button'); addBtn.textContent = '+ Add rule'; addBtn.dataset.testid = 'extract-add-rule';
    addBtn.addEventListener('click', () => { n.params.rules.push({ selector: '', returnType: 'text', attribute: '', output: '' }); render(); });
    c.appendChild(addBtn);
  } else if (n.type === 'xml') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Convert the source field between XML and JSON; the result is written to the output field (other fields preserved).';
    c.appendChild(note);
    n.params.sourceField = n.params.sourceField ?? 'json.body';
    n.params.direction = n.params.direction ?? 'xmlToJson';
    n.params.outputName = n.params.outputName ?? 'data';
    c.appendChild(field('Source field (path)', 'cfg-xml-source', input(n.params.sourceField, (v) => (n.params.sourceField = v))));
    const sel = document.createElement('select');
    for (const d of ['xmlToJson', 'jsonToXml']) { const o = document.createElement('option'); o.value = d; o.textContent = d === 'xmlToJson' ? 'XML → JSON (parse)' : 'JSON → XML (serialise)'; if (n.params.direction === d) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.direction = sel.value; });
    c.appendChild(field('Conversion', 'cfg-xml-direction', sel));
    c.appendChild(field('Output field name', 'cfg-xml-output', input(n.params.outputName, (v) => (n.params.outputName = v))));
  } else if (n.type === 'markdown') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Convert the source field between Markdown and HTML; the result is written to the output field (other fields preserved).';
    c.appendChild(note);
    n.params.sourceField = n.params.sourceField ?? 'json.body';
    n.params.direction = n.params.direction ?? 'markdownToHtml';
    n.params.outputName = n.params.outputName ?? 'html';
    c.appendChild(field('Source field (path)', 'cfg-md-source', input(n.params.sourceField, (v) => (n.params.sourceField = v))));
    const sel = document.createElement('select');
    for (const d of ['markdownToHtml', 'htmlToMarkdown']) { const o = document.createElement('option'); o.value = d; o.textContent = d === 'markdownToHtml' ? 'Markdown → HTML' : 'HTML → Markdown'; if (n.params.direction === d) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => { n.params.direction = sel.value; });
    c.appendChild(field('Conversion', 'cfg-md-direction', sel));
    c.appendChild(field('Output field name', 'cfg-md-output', input(n.params.outputName, (v) => (n.params.outputName = v))));
  } else if (n.type === 'crypto') {
    const note = document.createElement('div'); note.style.cssText = 'font-size:11px;color:#6b7280;margin-bottom:4px;'; note.textContent = 'Perform a cryptographic operation on the source field; the result is written to the output field (other fields preserved).';
    c.appendChild(note);
    n.params.action = n.params.action ?? 'hash';
    n.params.algorithm = n.params.algorithm ?? 'sha256';
    n.params.sourceField = n.params.sourceField ?? 'json.value';
    n.params.outputName = n.params.outputName ?? 'hash';
    const act = document.createElement('select');
    for (const a of ['hash', 'base64Encode', 'base64Decode']) { const o = document.createElement('option'); o.value = a; o.textContent = a === 'hash' ? 'Hash' : a === 'base64Encode' ? 'Base64 encode' : 'Base64 decode'; if (n.params.action === a) o.selected = true; act.appendChild(o); }
    act.addEventListener('change', () => { n.params.action = act.value; render(); });
    c.appendChild(field('Action', 'cfg-crypto-action', act));
    if (n.params.action === 'hash') {
      const alg = document.createElement('select');
      for (const a of ['md5', 'sha1', 'sha256', 'sha512']) { const o = document.createElement('option'); o.value = a; o.textContent = a.toUpperCase(); if (n.params.algorithm === a) o.selected = true; alg.appendChild(o); }
      alg.addEventListener('change', () => { n.params.algorithm = alg.value; });
      c.appendChild(field('Algorithm', 'cfg-crypto-algorithm', alg));
    }
    c.appendChild(field('Source field (path)', 'cfg-crypto-source', input(n.params.sourceField, (v) => (n.params.sourceField = v))));
    c.appendChild(field('Output field name', 'cfg-crypto-output', input(n.params.outputName, (v) => (n.params.outputName = v))));
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
$('#btn-new').addEventListener('click', () => { state.nodes = []; state.connections = []; state.selectedId = null; state.defId = null; state.lastSteps = {}; $('#automation-name').value = 'My automation'; const rs = $('#run-status'); rs.textContent = ''; delete rs.dataset.defId; history.replaceState(null, '', location.pathname); render(); });
$('#btn-save').addEventListener('click', save);
// Load via a point-and-pick list of saved automations BY NAME (B54).
async function openLoadList() {
  const list = await fetch('/definitions').then((r) => r.json());
  const rows = $('#load-rows');
  rows.innerHTML = '';
  if (!list.length) {
    const empty = document.createElement('div');
    empty.dataset.testid = 'load-empty';
    empty.style.cssText = 'color:#868e96; font-size:13px; padding:8px 0;';
    empty.textContent = 'No saved automations yet — build one and Save it.';
    rows.appendChild(empty);
  } else {
    for (const d of list) {
      const row = document.createElement('button');
      row.className = 'load-item';
      row.dataset.testid = 'load-item';
      row.dataset.defId = d.id;
      row.style.cssText = 'display:block; width:100%; text-align:left; padding:9px 11px; margin-bottom:6px; border:1px solid #d4d8e0; border-radius:8px; background:#fbfcfe; cursor:pointer; font-size:13px;';
      row.innerHTML = '<strong data-testid="load-item-name">' + d.name + '</strong>';
      row.addEventListener('click', () => { $('#load-panel').style.display = 'none'; loadById(d.id); });
      rows.appendChild(row);
    }
  }
  $('#load-panel').style.display = 'block';
}
$('#btn-load').addEventListener('click', openLoadList);
$('#btn-load-close').addEventListener('click', () => { $('#load-panel').style.display = 'none'; });
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
