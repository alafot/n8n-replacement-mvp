// B27 CORRECTION — verify a connection RENDERS as a complete line spanning the
// two steps end to end (no truncated stub), by MEASURING painted geometry
// (hit-testing along the line) + screenshots, at several placements and after moves.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const connectClick = async (f, port, t) => { await page.locator(`[data-testid="port"][data-node-id="${f}"][data-port="${port}"]`).click(); await page.locator(`[data-testid="node"][data-node-id="${t}"]`).click(); };
  const moveBy = async (id, dx, dy) => {
    const b = await page.locator(`[data-testid="node"][data-node-id="${id}"]`).boundingBox();
    await page.mouse.move(b.x + 20, b.y + 10); await page.mouse.down();
    await page.mouse.move(b.x + 20 + dx, b.y + 10 + dy, { steps: 12 }); await page.mouse.up();
  };

  // MEASURE the painted line: sample points along it and hit-test whether the
  // line element is actually rendered there (catches viewport-clipped stubs).
  const measure = (connId) => page.evaluate((cid) => {
    const line = document.querySelector(`line[data-conn-id="${cid}"]`);
    const svg = document.querySelector('#links');
    const svgRect = svg.getBoundingClientRect();
    const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1'), x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
    const sPE = svg.style.pointerEvents, lPE = line.style.pointerEvents;
    svg.style.pointerEvents = 'auto'; line.style.pointerEvents = 'stroke';
    // Make every other element transparent to hit-testing so coverage reflects
    // ONLY whether the line itself is painted at each sampled point.
    const occluders = [...document.querySelectorAll('.node, .port, .conn-del')];
    const savedPE = occluders.map((e) => e.style.pointerEvents);
    occluders.forEach((e) => { e.style.pointerEvents = 'none'; });
    // Sample the INTERIOR band (0.15..0.85) so the node/port boxes at the ends
    // (which sit on top of the line) don't confound the painted-coverage measure.
    const N = 24; let hits = 0, samples = 0;
    for (let i = 0; i <= N; i++) {
      const t = 0.15 + (0.7 * i) / N;
      const cx = svgRect.left + x1 + (x2 - x1) * t, cy = svgRect.top + y1 + (y2 - y1) * t;
      samples++;
      let hit = false;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [2, 0], [0, 2]]) {
        if (document.elementFromPoint(cx + dx, cy + dy) === line) { hit = true; break; }
      }
      if (hit) hits++;
    }
    svg.style.pointerEvents = sPE; line.style.pointerEvents = lPE;
    occluders.forEach((e, i) => { e.style.pointerEvents = savedPE[i]; });
    const lr = line.getBoundingClientRect();
    return {
      coverage: hits / samples,                      // fraction of interior path actually painted
      renderedLen: Math.hypot(lr.width, lr.height),  // rendered bbox diagonal
      geomLen: Math.hypot(x2 - x1, y2 - y1),         // intended span
      svgW: Math.round(svgRect.width), svgH: Math.round(svgRect.height),
      ends: { x1, y1, x2, y2 },
    };
  }, connId);

  const connId = () => page.locator('[data-testid="conn-delete"]').first().getAttribute('data-conn-id');

  const a = await add('httpRequest');
  const b = await add('code');
  await connectClick(a, 'main', b);
  const cid = await connId();

  const check = async (label, shot) => {
    const m = await measure(cid);
    log(`${label}: span=${Math.round(m.geomLen)}px rendered=${Math.round(m.renderedLen)}px paintedCoverage=${(m.coverage * 100).toFixed(0)}% (svg ${m.svgW}x${m.svgH})`);
    assert.ok(m.svgW >= 1500 && m.svgH >= 1100, 'drawing surface spans the canvas (not a 300x150 intrinsic box)');
    assert.ok(m.coverage > 0.9, `line is painted along its FULL span (no stub) — coverage ${(m.coverage * 100).toFixed(0)}%`);
    assert.ok(Math.abs(m.renderedLen - m.geomLen) < 6, 'rendered length matches the inter-anchor distance');
    if (shot) await page.screenshot({ path: path.join(SHOT_DIR, shot) });
    return m;
  };

  // E1 + E2: full-span at several representative placements.
  await check('B27 E1 near/horizontal', 'render-near.png');
  await moveBy(b, 520, 360); await check('B27 E2 far down-right', 'render-far.png');
  await moveBy(b, -900, -120); await check('B27 E2 target left of source (reverse)', null);
  await moveBy(a, 300, 380); await check('B27 E2 different vertical direction', null);

  // E3: stays anchored AND full-span after moving a step.
  await moveBy(b, 250, -300);
  const m = await check('B27 E3 after moving a step', 'render-after-move.png');
  log('B27 E3 endpoints after move: ' + JSON.stringify(m.ends));

  log('\nALL B27-CORRECTION ASSERTIONS PASSED (line renders full-span, no stub, at all placements + after moves).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
