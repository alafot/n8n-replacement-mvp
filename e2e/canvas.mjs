// Driven-browser check for the visual canvas (B12). Loads the canvas in a real
// Chrome, asserts the palette offers each engine step type, clicks each, and
// verifies a placed node of the MATCHING type appears. Exits non-zero on any
// failed assertion. Screenshots written to the path in SHOT_DIR.
//
// usage: SHOT_DIR=/tmp node e2e/canvas.mjs
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
// The engine's REAL step types (from B2/B7/B8/B9).
const EXPECTED_TYPES = ['httpRequest', 'transform', 'if', 'code'];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const log = (m) => console.log(m);

try {
  // E1: canvas page loads, canvas surface visible.
  const resp = await page.goto(URL, { waitUntil: 'networkidle' });
  assert.equal(resp.status(), 200, 'page HTTP status');
  log(`E1 page loaded: HTTP ${resp.status()}, title="${await page.title()}"`);
  const canvas = page.locator('[data-testid="canvas"]');
  assert.ok(await canvas.isVisible(), 'canvas surface visible');
  log('E1 canvas surface visible: true');

  // E2/E5: palette offers each of the four real engine step types.
  const paletteTypes = await page.locator('[data-testid="palette-item"]').evaluateAll((els) =>
    els.map((e) => e.dataset.stepType),
  );
  log(`E2 palette offers ${paletteTypes.length} types: ${JSON.stringify(paletteTypes)}`);
  for (const t of EXPECTED_TYPES) {
    assert.ok(paletteTypes.includes(t), `palette missing type ${t}`);
  }
  assert.deepEqual([...paletteTypes].sort(), [...EXPECTED_TYPES].sort(), 'palette types == engine types');
  log(`E5 palette types correspond to engine step types: ${JSON.stringify(EXPECTED_TYPES)}`);

  await page.screenshot({ path: path.join(SHOT_DIR, 'canvas-empty.png') });

  // E3: selecting each palette type places a node of the MATCHING type.
  for (const t of EXPECTED_TYPES) {
    const before = await page.locator('[data-testid="node"]').count();
    await page.locator(`[data-testid="palette-item"][data-step-type="${t}"]`).click();
    await page.locator(`[data-testid="node"][data-node-type="${t}"]`).first().waitFor();
    const after = await page.locator('[data-testid="node"]').count();
    assert.equal(after, before + 1, `clicking ${t} added exactly one node`);
    const placedType = await page
      .locator('[data-testid="node"]')
      .last()
      .getAttribute('data-node-type');
    assert.equal(placedType, t, `placed node type matches chosen palette type (${t})`);
    log(`E3 chose '${t}' -> placed node data-node-type='${placedType}' (match)`);
  }

  // E4: one of each placed simultaneously — all four present together.
  const placedTypes = await page.locator('[data-testid="node"]').evaluateAll((els) =>
    els.map((e) => e.dataset.nodeType),
  );
  log(`E4 nodes placed on canvas at once: ${placedTypes.length} -> ${JSON.stringify(placedTypes)}`);
  assert.equal(placedTypes.length, 4, 'four nodes placed');
  assert.deepEqual([...placedTypes].sort(), [...EXPECTED_TYPES].sort(), 'all four types placed together');

  await page.screenshot({ path: path.join(SHOT_DIR, 'canvas-four-nodes.png') });
  log('\nALL ASSERTIONS PASSED — canvas + palette + matching placement verified in a real browser.');
} catch (err) {
  console.error('ASSERTION FAILED:', err.message);
  await page.screenshot({ path: path.join(SHOT_DIR, 'canvas-failure.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
