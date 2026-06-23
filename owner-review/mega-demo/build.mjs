// Builds a big, coherent "Order processing & reporting" automation that exercises ALL 26
// node types, saves it as a loadable definition, then loads + runs it to confirm it completes.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const BASE = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const api = (p, body, method = 'POST') => fetch(BASE.replace(/\/$/, '') + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

// ---- 1) A small sub-workflow for Execute Sub-workflow to call ----
const subGraph = {
  nodes: [{ id: 'enrich', type: 'code', label: 'Enrich', position: { x: 80, y: 80 },
    params: { code: 'return $input.map(it => ({ json: { ...it.json, doubled: (it.json.value||0)*2, enriched: true } }));' } }],
  connections: [],
};
const sub = await api('/definitions', { name: 'Enrich items (sub)', graph: subGraph });
console.log('saved sub-workflow:', sub.id);

// ---- 2) The mega workflow ----
const N = (id, type, x, y, params = {}, label) => ({ id, type, label: label ?? type, position: { x, y }, params });
const C = (from, to, port, toPort) => ({ id: from + '->' + to + (port ? ':' + port : '') + (toPort ? '@' + toPort : ''), from, to, ...(port ? { port } : {}), ...(toPort ? { toPort } : {}) });

const orders = [
  { id: 1, customer: 'Ada', category: 'electronics', amount: 120, country: 'UK', date: '2026-01-05', tags: ['new', 'priority'] },
  { id: 2, customer: 'Bob', category: 'books', amount: 25, country: 'US', date: '2026-02-11', tags: ['repeat'] },
  { id: 3, customer: 'Cleo', category: 'electronics', amount: 340, country: 'US', date: '2026-03-02', tags: ['priority'] },
  { id: 4, customer: 'Dan', category: 'food', amount: 8, country: 'UK', date: '2026-01-20', tags: [] },
  { id: 5, customer: 'Eve', category: 'books', amount: 60, country: 'DE', date: '2026-02-28', tags: ['gift'] },
  { id: 3, customer: 'Cleo', category: 'electronics', amount: 340, country: 'US', date: '2026-03-02', tags: ['priority'] },
  { id: 6, customer: 'Finn', category: 'food', amount: 15, country: 'DE', date: '2026-03-15', tags: ['repeat', 'gift'] },
  { id: 7, customer: 'Gwen', category: 'electronics', amount: 999, country: 'US', date: '2026-03-20', tags: ['priority', 'vip'] },
];

const nodes = [
  // main spine
  N('sched', 'scheduleTrigger', 60, 80, { intervalSeconds: 60 }, 'Every hour'),
  N('gen', 'code', 280, 80, { code: 'return ' + JSON.stringify(orders) + '.map(o => ({ json: o }));' }, 'Generate orders'),
  N('dedupe', 'removeDuplicates', 500, 80, { by: 'field', field: 'json.id' }, 'Drop dup orders'),
  N('rename', 'renameKeys', 720, 80, { renames: { customer: 'buyer' } }, 'customer→buyer'),
  N('addDate', 'dateTime', 940, 80, { operation: 'add', dateField: 'json.date', amount: 7, unit: 'days', outputName: 'shipBy' }, 'Ship-by +7d'),
  N('sortAmt', 'sort', 1160, 80, { field: 'json.amount', direction: 'desc' }, 'Sort by amount'),
  N('guard', 'if', 1380, 80, { condition: { left: 'json.amount', op: 'gt', right: 100000 } }, 'Sanity guard'),
  N('halt', 'stopError', 1380, 240, { message: 'Amount exceeds limit — halted' }, 'Halt (guard)'),
  N('filter', 'filter', 1600, 80, { condition: { left: 'json.amount', op: 'gte', right: 10 } }, 'Keep amount ≥ 10'),
  N('switchCat', 'switch', 1820, 80, { rules: [{ left: 'json.category', op: 'eq', right: 'electronics' }, { left: 'json.category', op: 'eq', right: 'books' }], fallback: true }, 'Route by category'),
  N('sumElec', 'summarize', 2040, 40, { func: 'sum', field: 'json.amount', groupBy: 'json.country', outputName: 'revenue' }, 'Electronics by country'),
  N('aggBooks', 'aggregate', 2040, 170, { field: 'json.amount', outputName: 'amounts' }, 'Collect book amounts'),
  N('fbNoop', 'noop', 2040, 300, {}, 'Other (pass-through)'),
  N('merge', 'merge', 2300, 170, { mode: 'append' }, 'Merge results'),
  N('loop', 'loop', 2520, 170, { batchSize: 2 }, 'Loop in batches'),
  N('body', 'code', 2740, 60, { code: 'return $input.map(it => ({ json: { ...it.json, looped: true } }));' }, 'Tag batch'),
  N('limit', 'limit', 2740, 200, { max: 3, keep: 'first' }, 'Top 3'),
  N('reshape', 'transform', 2960, 200, { set: { stage: 'final' }, copy: {}, rename: {}, remove: [] }, 'Stamp stage'),
  N('pause', 'wait', 3180, 200, { ms: 300 }, 'Brief wait'),
  N('report', 'code', 3400, 200, { code: 'return [{ json: { report: "done", count: $input.length } }];' }, 'Final report'),
  // HTTP tributary
  N('http', 'httpRequest', 60, 460, { method: 'GET', url: 'http://127.0.0.1:4555/json' }, 'Fetch reference'),
  N('httpSink', 'code', 280, 460, { code: 'return $input;' }, 'Keep response'),
  // Split Out tributary
  N('tagsSeed', 'code', 60, 580, { code: "return [{ json: { sku: 'A', tags: ['red','blue','green'] } }];" }, 'One item w/ tags'),
  N('splitTags', 'splitOut', 280, 580, { field: 'json.tags', outputName: 'tag' }, 'Split tags'),
  N('splitSink', 'code', 500, 580, { code: 'return $input;' }, 'One per tag'),
  // Compare Datasets tributary
  N('cmpA', 'code', 60, 700, { code: 'return [1,2,3].map(id => ({ json: { id } }));' }, 'Dataset A'),
  N('cmpB', 'code', 60, 820, { code: 'return [2,3,4].map(id => ({ json: { id } }));' }, 'Dataset B'),
  N('compare', 'compareDatasets', 300, 760, { keyField: 'json.id' }, 'Compare A vs B'),
  N('mSink', 'code', 540, 680, { code: 'return $input;' }, 'Matched'),
  N('aSink', 'code', 540, 800, { code: 'return $input;' }, 'Only in A'),
  N('bSink', 'code', 540, 920, { code: 'return $input;' }, 'Only in B'),
  // Execute Sub-workflow tributary
  N('subSeed', 'code', 60, 1040, { code: 'return [{ json: { value: 5 } }];' }, 'Seed value'),
  N('execSub', 'executeSubworkflow', 280, 1040, { definitionId: sub.id }, 'Run sub-workflow'),
  N('subSink', 'code', 500, 1040, { code: 'return $input;' }, 'Enriched'),
  // Webhook + Respond tributary
  N('webhook', 'webhookTrigger', 60, 1160, { path: 'mega-demo-hook' }, 'On webhook'),
  N('whCode', 'code', 280, 1160, { code: 'return $input.map(it => ({ json: { ...it.json, ack: true } }));' }, 'Build reply'),
  N('respond', 'respondToWebhook', 500, 1160, { status: 200, bodyMode: 'firstItem' }, 'Respond 200'),
  // Form tributary
  N('form', 'formTrigger', 60, 1280, { path: 'mega-demo-form', fields: ['name', 'email'] }, 'On form submit'),
  N('formSink', 'code', 280, 1280, { code: 'return $input;' }, 'Capture form'),
  // Error tributary
  N('errT', 'errorTrigger', 60, 1400, { targetDefinitionId: '' }, 'On failure'),
  N('errSink', 'code', 280, 1400, { code: 'return $input;' }, 'Handle error'),
];

const connections = [
  C('sched', 'gen'), C('gen', 'dedupe'), C('dedupe', 'rename'), C('rename', 'addDate'), C('addDate', 'sortAmt'),
  C('sortAmt', 'guard'), C('guard', 'halt', 'true'), C('guard', 'filter', 'false'), C('filter', 'switchCat'),
  C('switchCat', 'sumElec', '0'), C('switchCat', 'aggBooks', '1'), C('switchCat', 'fbNoop', 'fallback'),
  C('sumElec', 'merge'), C('aggBooks', 'merge'), C('fbNoop', 'merge'),
  C('merge', 'loop'), C('loop', 'body', 'loop'), C('loop', 'limit', 'done'),
  C('limit', 'reshape'), C('reshape', 'pause'), C('pause', 'report'),
  C('http', 'httpSink'),
  C('tagsSeed', 'splitTags'), C('splitTags', 'splitSink'),
  C('cmpA', 'compare', 'main', 'a'), C('cmpB', 'compare', 'main', 'b'),
  C('compare', 'mSink', 'matched'), C('compare', 'aSink', 'onlyA'), C('compare', 'bSink', 'onlyB'),
  C('subSeed', 'execSub'), C('execSub', 'subSink'),
  C('webhook', 'whCode'), C('whCode', 'respond'),
  C('form', 'formSink'),
  C('errT', 'errSink'),
];

const NAME = 'Order processing & reporting (full demo)';
const def = await api('/definitions', { name: NAME, graph: { nodes, connections } });
console.log('saved mega workflow:', def.id, '|', nodes.length, 'nodes,', connections.length, 'connections');

// ---- 3) Load + run it to confirm it completes ----
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(BASE + '?def=' + def.id, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="node"]');
  const loaded = await page.locator('[data-testid="node"]').count();
  assert.equal(loaded, nodes.length, 'all nodes loaded onto the canvas');

  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runId);
  const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runState !== 'in-progress', null, { timeout: 60000 });
  const runState = await page.locator('[data-testid="run-status"]').getAttribute('data-run-state');

  const s = await page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  const byStatus = {};
  for (const [, st] of Object.entries(s.steps)) byStatus[st.status] = (byStatus[st.status] || 0) + 1;
  const failed = Object.entries(s.steps).filter(([, st]) => st.status === 'failed').map(([id]) => id);
  console.log('run-state:', runState, '| step status counts:', JSON.stringify(byStatus));
  assert.equal(runState, 'completed', 'the whole automation ran to completion');
  assert.equal(failed.length, 0, 'no failed steps (got: ' + failed.join(',') + ')');
  assert.equal(s.steps.halt.status, 'skipped', 'Stop-and-Error sat on the untaken guard branch (skipped, did not fire)');

  await page.screenshot({ path: path.join(DIR, 'mega-demo-canvas.png'), fullPage: true });
  console.log('Mega demo OK: "' + NAME + '" loads and runs to completion. Step statuses:', JSON.stringify(byStatus));
  console.log('LOAD IT: open ' + BASE + ' -> Load… -> "' + NAME + '"');
} catch (e) {
  console.error('Mega demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
