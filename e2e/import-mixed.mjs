// B21: importing an n8n workflow with unsupported step types surfaces them and
// imports the supported remainder coherently, with no silent loss and no crash.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';
import { readFileSync } from 'fs';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const EXPORT = path.resolve('examples/n8n-mixed.json');
const source = JSON.parse(readFileSync(EXPORT, 'utf8'));
const log = (m) => console.log(m);

// Which source nodes are unsupported (truth for the no-silent-loss check).
const SUPPORTED = new Set(['n8n-nodes-base.httpRequest', 'n8n-nodes-base.set', 'n8n-nodes-base.if', 'n8n-nodes-base.code', 'n8n-nodes-base.function']);
const sourceUnsupported = source.nodes.filter((n) => !SUPPORTED.has(n.type));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1300, height: 760 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  log(`E5 genuine mixed input: ${source.nodes.length} nodes — supported (httpRequest, set) + unsupported (${sourceUnsupported.map((n) => n.type).join(', ')})`);

  await page.locator('[data-testid="import-file"]').setInputFiles(EXPORT);
  await page.waitForSelector('[data-testid="node"]');

  // E4: no crash — the page completed the import and is usable.
  const nodeCount = await page.locator('[data-testid="node"]').count();
  log(`B21 E4 import completed without crashing; canvas usable with ${nodeCount} steps`);

  // E1: unsupported parts reported AND identified (by name + type).
  const warn = page.locator('[data-testid="import-warning"]');
  const reported = JSON.parse((await warn.getAttribute('data-unsupported')) ?? '[]');
  log(`B21 E1 unsupported surfaced to user: "${(await warn.textContent()).trim()}"`);
  for (const u of sourceUnsupported) {
    assert.ok(reported.some((r) => r.type === u.type && r.name === u.name), `unsupported ${u.name} [${u.type}] reported`);
  }

  // E3 (crux): no silent data loss — count/set reported == count/set in input.
  assert.equal(reported.length, sourceUnsupported.length, 'every unsupported node accounted for');
  log(`B21 E3 no silent loss: input had ${sourceUnsupported.length} unsupported, exactly ${reported.length} reported (${reported.map((r) => r.name).join(', ')})`);

  // E2: supported remainder imported, mapped, and wired among themselves.
  const nodes = await page.locator('[data-testid="node"]').evaluateAll((els) => els.map((e) => ({ type: e.dataset.nodeType, label: e.querySelector('.node-title').textContent, id: e.dataset.nodeId })));
  const byLabel = Object.fromEntries(nodes.map((n) => [n.label, n]));
  assert.ok(byLabel['Fetch order'] && byLabel['Fetch order'].type === 'httpRequest', 'supported HTTP step imported');
  assert.ok(byLabel['Tag processed'] && byLabel['Tag processed'].type === 'transform', 'supported Set step imported');
  assert.equal(nodes.length, 2, 'only the supported steps are on the canvas');
  const conns = await page.locator('[data-testid="conn-delete"]').evaluateAll((els) => els.map((e) => ({ from: e.dataset.from, to: e.dataset.to })));
  assert.ok(conns.some((c) => c.from === byLabel['Fetch order'].id && c.to === byLabel['Tag processed'].id), 'supported steps wired among themselves (Fetch order -> Tag processed)');
  log('B21 E2 supported remainder imported & wired: Fetch order (httpRequest) -> Tag processed (transform)');

  // Still usable: editable.
  await page.locator(`[data-testid="node"][data-node-id="${byLabel['Fetch order'].id}"]`).click();
  assert.ok(await page.locator('[data-testid="cfg-url"]').count(), 'imported supported step remains editable');
  await page.screenshot({ path: path.join(SHOT_DIR, 'import-mixed.png') });

  log('\nALL B21 ASSERTIONS PASSED.');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
