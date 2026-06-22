// B22: export an automation built here to n8n-compatible JSON; confirm it
// conforms to n8n's schema shape, carries config, and round-trips back to the
// same automation via re-import.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';
import { readFileSync } from 'fs';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1300, height: 760 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const connect = async (f, port, t) => { await page.locator(`[data-testid="port"][data-node-id="${f}"][data-port="${port}"]`).click(); await page.locator(`[data-testid="node"][data-node-id="${t}"]`).click(); };

  // Build an automation HERE: http -> if --true--> set / --false--> code.
  const http = await add('httpRequest');
  const iff = await add('if');
  const set = await add('transform');
  const code = await add('code');
  await page.locator(`[data-testid="node"][data-node-id="${http}"]`).click();
  await page.locator('[data-testid="cfg-url"]').fill('https://api.example.com/widgets/9');
  await page.locator('[data-testid="cfg-method"]').selectOption('POST');
  await page.locator(`[data-testid="node"][data-node-id="${iff}"]`).click();
  await page.locator('[data-testid="cfg-left"]').fill('json.body.qty');
  await page.locator('[data-testid="cfg-op"]').selectOption('gte');
  await page.locator('[data-testid="cfg-right"]').fill('10');
  await page.locator(`[data-testid="node"][data-node-id="${set}"]`).click();
  await page.locator('[data-testid="cfg-set"]').fill('{"bulk":"true","label":"wholesale"}');
  await page.locator(`[data-testid="node"][data-node-id="${code}"]`).click();
  await page.locator('[data-testid="cfg-code"]').fill('return [{ json: { retail: true } }];');
  await connect(http, 'main', iff);
  await connect(iff, 'true', set);
  await connect(iff, 'false', code);

  // Snapshot BEFORE (canvas truth).
  const snapshot = async (p) => {
    const nodes = await p.locator('[data-testid="node"]').evaluateAll((els) => els.map((e) => ({ id: e.dataset.nodeId, type: e.dataset.nodeType, label: e.querySelector('.node-title').textContent })));
    const conns = await p.locator('[data-testid="conn-delete"]').evaluateAll((els) => els.map((e) => `${e.dataset.from}-${e.dataset.port}->${e.dataset.to}`));
    return { nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)), conns: conns.sort() };
  };
  const before = await snapshot(page);
  log(`built automation here: ${before.nodes.length} steps, connections ${JSON.stringify(before.conns)}`);

  // E1/E2: Export to n8n JSON (download) and inspect conformance.
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-testid="btn-export"]').click()]);
  const file = await download.path();
  const n8n = JSON.parse(readFileSync(file, 'utf8'));

  // Conformance to n8n's workflow schema shape.
  assert.ok(Array.isArray(n8n.nodes) && typeof n8n.connections === 'object', 'has nodes[] and connections{}');
  for (const n of n8n.nodes) {
    assert.ok(n.type.startsWith('n8n-nodes-base.'), `node type is an n8n type (${n.type})`);
    assert.ok(typeof n.typeVersion === 'number', 'node has typeVersion');
    assert.ok(Array.isArray(n.position) && n.position.length === 2, 'node has [x,y] position');
    assert.ok(n.parameters && typeof n.parameters === 'object', 'node has parameters');
    assert.ok(n.name && n.id, 'node has name and id');
  }
  // Connections are keyed by node NAME, with main output ports; IF has two outputs.
  const ifNode = n8n.nodes.find((n) => n.type === 'n8n-nodes-base.if');
  assert.equal(n8n.connections[ifNode.name].main.length, 2, 'IF node exports two main outputs (true/false)');
  log(`B22 E1 export conforms to n8n schema: ${n8n.nodes.length} n8n nodes (types: ${n8n.nodes.map((n) => n.type.replace('n8n-nodes-base.', '')).join(', ')}); connections keyed by name; IF has 2 main outputs`);

  // E5: config carried into the export (not blank params).
  const httpN = n8n.nodes.find((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.equal(httpN.parameters.url, 'https://api.example.com/widgets/9', 'exported HTTP url carries config');
  assert.equal(httpN.parameters.method, 'POST', 'exported HTTP method carries config');
  assert.equal(ifNode.parameters.conditions.conditions[0].operator.operation, 'gte', 'exported IF operator carries config');
  const setN = n8n.nodes.find((n) => n.type === 'n8n-nodes-base.set');
  assert.ok(setN.parameters.assignments.assignments.some((a) => a.name === 'label' && a.value === 'wholesale'), 'exported Set carries field changes');
  log('B22 E5 config carried into export: HTTP url/method=POST, IF operator gte, Set label=wholesale, IF leftValue=' + ifNode.parameters.conditions.conditions[0].leftValue);

  // E3/E4: re-import the exported JSON HERE and confirm same automation.
  await page.locator('[data-testid="btn-new"]').click();
  assert.equal(await page.locator('[data-testid="node"]').count(), 0, 'canvas cleared before re-import');
  await page.locator('[data-testid="import-file"]').setInputFiles(file);
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node"]').length === n, before.nodes.length);
  const after = await snapshot(page);

  assert.deepEqual(after.nodes, before.nodes, 'steps identical after round-trip (id/type/label)');
  assert.deepEqual(after.conns, before.conns, 'connections identical after round-trip (incl branch routes)');
  log(`B22 E3/E4 round-trip reproduces the SAME automation: steps ${after.nodes.length} match; connections ${JSON.stringify(after.conns)} match`);

  // Config preserved through the round-trip.
  const httpId = after.nodes.find((n) => n.type === 'httpRequest').id;
  await page.locator(`[data-testid="node"][data-node-id="${httpId}"]`).click();
  assert.equal(await page.locator('[data-testid="cfg-url"]').inputValue(), 'https://api.example.com/widgets/9', 'config preserved through round-trip');
  log('B22 E5 per-step config preserved through round-trip (HTTP url intact)');
  await page.screenshot({ path: path.join(SHOT_DIR, 'roundtrip.png') });

  log('\nALL B22 ASSERTIONS PASSED.');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
