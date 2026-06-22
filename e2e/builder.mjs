// Driven-browser checks for B13 (connect/disconnect + branch ports),
// B14 (per-step config + retention), B15 (save & reload in a FRESH session).
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const addNode = async (type) => {
    await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click();
    const id = await page.locator('[data-testid="node"]').last().getAttribute('data-node-id');
    return id;
  };
  const connect = async (fromId, port, toId) => {
    await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).click();
    await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).click();
  };
  const connCount = () => page.locator('[data-testid="conn-delete"]').count();
  const hasConn = (from, to, port) =>
    page.locator(`[data-testid="conn-delete"][data-from="${from}"][data-to="${to}"][data-port="${port}"]`).count();

  // Build: fetch(http) -> gate(if) --true--> adult(code) ; --false--> minor(code) ; plus a transform.
  const fetchId = await addNode('httpRequest');
  const gateId = await addNode('if');
  const adultId = await addNode('code');
  const minorId = await addNode('code');
  const xformId = await addNode('transform');
  log(`placed: fetch=${fetchId} gate=${gateId} adult=${adultId} minor=${minorId} xform=${xformId}`);

  // ===== B13 =====
  log('\n========== B13: connect / disconnect / branch ports ==========');
  // E3: branch step exposes two distinct outgoing ports (true & false).
  const truePort = await page.locator(`[data-testid="port"][data-node-id="${gateId}"][data-port="true"]`).count();
  const falsePort = await page.locator(`[data-testid="port"][data-node-id="${gateId}"][data-port="false"]`).count();
  assert.equal(truePort, 1); assert.equal(falsePort, 1);
  log(`B13 E3 branch exposes two distinct ports: true=${truePort}, false=${falsePort}`);

  // E1: draw connections -> visible links.
  await connect(fetchId, 'main', gateId);
  await connect(gateId, 'true', adultId);   // E4: true -> adult
  await connect(gateId, 'false', minorId);  // E4: false -> minor (distinct target)
  await connect(fetchId, 'main', xformId);  // extra link we will delete in E2
  assert.equal(await connCount(), 4, 'four connections drawn');
  assert.equal(await hasConn(fetchId, gateId, 'main'), 1, 'fetch->gate link visible');
  assert.equal(await hasConn(gateId, adultId, 'true'), 1, 'gate(true)->adult link visible');
  assert.equal(await hasConn(gateId, minorId, 'false'), 1, 'gate(false)->minor link visible');
  log('B13 E1 links established between the specific nodes (fetch->gate, gate.true->adult, gate.false->minor)');
  log(`B13 E4 true->${adultId} and false->${minorId} wired to DISTINCT targets (kept separate)`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'builder-connected.png') });

  // E2: delete a connection -> removed from view (before/after).
  const before = await connCount();
  await page.locator(`[data-testid="conn-delete"][data-from="${fetchId}"][data-to="${xformId}"]`).click();
  const after = await connCount();
  assert.equal(after, before - 1, 'one connection removed');
  assert.equal(await hasConn(fetchId, xformId, 'main'), 0, 'deleted link no longer present');
  log(`B13 E2 deleted a connection: ${before} -> ${after} (the fetch->xform link is gone)`);

  // E5: structure serializes to the engine's graph/branch model with wiring intact.
  const graph = await page.evaluate(() => window.__lastGraph ?? null);
  // Expose serialization for assertion (toGraph is internal) — read via the run payload instead:
  const serialized = await page.evaluate(() => {
    // mirror toGraph()
    return {
      nodes: window.STATE ? null : null,
    };
  });
  // Pull the structure the engine would run by intercepting the next run payload:
  let runPayload = null;
  await page.route('**/workflows/run-graph', async (route) => {
    runPayload = JSON.parse(route.request().postData());
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ runId: 'preview', status: 'in-progress' }) });
  });
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForTimeout(200);
  await page.unroute('**/workflows/run-graph');
  assert.ok(runPayload, 'captured serialized graph');
  const connT = runPayload.connections.find((c) => c.from === gateId && c.port === 'true');
  const connF = runPayload.connections.find((c) => c.from === gateId && c.port === 'false');
  assert.equal(connT.to, adultId, 'serialized true-branch maps to adult');
  assert.equal(connF.to, minorId, 'serialized false-branch maps to minor');
  assert.equal(runPayload.nodes.find((n) => n.id === gateId).type, 'if', 'gate serializes as engine type if');
  log('B13 E5 canvas serializes to the engine graph with true/false wiring intact:');
  log('       connections -> ' + JSON.stringify(runPayload.connections.map((c) => `${c.from}-${c.port}->${c.to}`)));

  // ===== B14 =====
  log('\n========== B14: per-step configuration ==========');
  // E2: each type surfaces its OWN parameters.
  await page.locator(`[data-testid="node"][data-node-id="${fetchId}"]`).click();
  assert.ok(await page.locator('[data-testid="cfg-url"]').count(), 'http step shows URL field');
  assert.ok(await page.locator('[data-testid="cfg-method"]').count(), 'http step shows method field');
  await page.locator(`[data-testid="node"][data-node-id="${gateId}"]`).click();
  assert.ok(await page.locator('[data-testid="cfg-left"]').count(), 'if step shows condition field');
  assert.ok(await page.locator('[data-testid="cfg-op"]').count(), 'if step shows operator');
  await page.locator(`[data-testid="node"][data-node-id="${adultId}"]`).click();
  assert.ok(await page.locator('[data-testid="cfg-code"]').count(), 'code step shows code field');
  await page.locator(`[data-testid="node"][data-node-id="${xformId}"]`).click();
  assert.ok(await page.locator('[data-testid="cfg-set"]').count(), 'transform step shows set/field changes');
  log('B14 E2/E5 each type surfaces its own engine-relevant params (http: method/url; if: condition; code: code; transform: field changes)');

  // E1/E3: enter values, revisit, confirm retained.
  await page.locator(`[data-testid="node"][data-node-id="${fetchId}"]`).click();
  await page.locator('[data-testid="cfg-url"]').fill('http://127.0.0.1:4555/value/40');
  await page.locator('[data-testid="cfg-method"]').selectOption('GET');
  // E4: two code steps hold DISTINCT values.
  await page.locator(`[data-testid="node"][data-node-id="${adultId}"]`).click();
  await page.locator('[data-testid="cfg-code"]').fill('return [{ json: { decision: "ADULT", doubled: $input[0].json.body.value * 2 } }];');
  await page.locator(`[data-testid="node"][data-node-id="${minorId}"]`).click();
  await page.locator('[data-testid="cfg-code"]').fill('return [{ json: { decision: "MINOR" } }];');
  await page.locator(`[data-testid="node"][data-node-id="${gateId}"]`).click();
  await page.locator('[data-testid="cfg-left"]').fill('json.body.value');
  await page.locator('[data-testid="cfg-op"]').selectOption('gt');
  await page.locator('[data-testid="cfg-right"]').fill('18');

  // Revisit fetch -> URL retained (E3).
  await page.locator(`[data-testid="node"][data-node-id="${xformId}"]`).click(); // navigate away
  await page.locator(`[data-testid="node"][data-node-id="${fetchId}"]`).click(); // and back
  const urlBack = await page.locator('[data-testid="cfg-url"]').inputValue();
  assert.equal(urlBack, 'http://127.0.0.1:4555/value/40', 'URL retained on revisit');
  log(`B14 E3 entered value survives revisit: fetch URL = "${urlBack}"`);

  // Distinct per step (E4).
  await page.locator(`[data-testid="node"][data-node-id="${adultId}"]`).click();
  const adultCode = await page.locator('[data-testid="cfg-code"]').inputValue();
  await page.locator(`[data-testid="node"][data-node-id="${minorId}"]`).click();
  const minorCode = await page.locator('[data-testid="cfg-code"]').inputValue();
  assert.ok(adultCode.includes('ADULT') && minorCode.includes('MINOR') && adultCode !== minorCode, 'same-type steps hold distinct values');
  log('B14 E4 two code steps hold DISTINCT values (ADULT vs MINOR) — no global bleed');

  // ===== B15 =====
  log('\n========== B15: save & reload in a FRESH session ==========');
  await page.locator('[data-testid="automation-name"]').fill('Branching automation');
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  log(`saved automation -> definition id ${defId}`);
  await ctx.close(); // discard this session entirely

  // Genuinely fresh context: no shared cookies/localStorage/memory.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const storage = await page2.evaluate(() => ({})).catch(() => ({}));
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector('[data-testid="node"]');
  // Prove fresh: localStorage empty in this context.
  const lsLen = await page2.evaluate(() => window.localStorage.length);
  log(`fresh session check: localStorage entries = ${lsLen} (server-side restore, not client memory)`);

  // E1 steps restored.
  const reNodes = await page2.locator('[data-testid="node"]').evaluateAll((els) => els.map((e) => ({ id: e.dataset.nodeId, type: e.dataset.nodeType })));
  assert.equal(reNodes.length, 5, 'all five steps restored');
  // E2 connections restored incl branch routes.
  const reConns = await page2.locator('[data-testid="conn-delete"]').evaluateAll((els) => els.map((e) => `${e.dataset.from}-${e.dataset.port}->${e.dataset.to}`));
  assert.ok(reConns.includes(`${gateId}-true->${adultId}`), 'true route restored');
  assert.ok(reConns.includes(`${gateId}-false->${minorId}`), 'false route restored (distinct)');
  log(`B15 E1 steps restored: ${reNodes.length}; E2 connections restored: ${JSON.stringify(reConns)}`);

  // E3 per-step config preserved.
  await page2.locator(`[data-testid="node"][data-node-id="${fetchId}"]`).click();
  const urlRestored = await page2.locator('[data-testid="cfg-url"]').inputValue();
  await page2.locator(`[data-testid="node"][data-node-id="${adultId}"]`).click();
  const adultRestored = await page2.locator('[data-testid="cfg-code"]').inputValue();
  assert.equal(urlRestored, 'http://127.0.0.1:4555/value/40', 'URL config preserved across fresh reload');
  assert.ok(adultRestored.includes('ADULT'), 'code config preserved across fresh reload');
  log(`B15 E3 config preserved across fresh session: URL="${urlRestored}", adult code retained`);
  await page2.screenshot({ path: path.join(SHOT_DIR, 'builder-reloaded-fresh.png') });

  log('\nALL BUILDER ASSERTIONS PASSED (B13, B14, B15).');
  log('DEFID=' + defId);
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
