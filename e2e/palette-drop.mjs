// B30: add a step by dragging it from the palette and dropping it at a chosen
// canvas location. Verified by MEASURED rendered position + screenshots; the
// dropped step is fully usable; no regression to click-add or connect/move/delete.
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

  const canvasBox = await page.locator('[data-testid="canvas"]').boundingBox();
  // Drag a palette entry to a viewport point; return the new node's id.
  const dragPaletteTo = async (type, cx, cy) => {
    const before = await page.locator('[data-testid="node"]').count();
    const pb = await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).boundingBox();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(cx, cy, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node"]').length === n, before + 1);
    return page.locator('[data-testid="node"]').last().getAttribute('data-node-id');
  };
  const nodeBox = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).boundingBox();
  const nodeType = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).getAttribute('data-node-type');

  // E1 + E2: drag each supported type to a distinct chosen location; the rendered
  // top-left should land at (approximately) the drop point.
  const drops = [
    { type: 'httpRequest', x: 380, y: 180 },
    { type: 'transform', x: 720, y: 250 },
    { type: 'if', x: 470, y: 470 },
    { type: 'code', x: 840, y: 560 },
  ];
  log('B30 E1/E2 drag each palette type to a chosen drop point; measured rendered top-left:');
  const placed = {};
  for (const d of drops) {
    const id = await dragPaletteTo(d.type, d.x, d.y);
    placed[d.type] = id;
    const b = await nodeBox(id);
    assert.equal(await nodeType(id), d.type, `dropped node is type ${d.type}`);
    assert.ok(Math.abs(b.x - d.x) < 12 && Math.abs(b.y - d.y) < 12, `${d.type} rendered at the drop point (got ${Math.round(b.x)},${Math.round(b.y)} vs drop ${d.x},${d.y})`);
    log(`   ${d.type}: dropped at (${d.x},${d.y}) -> rendered at (${Math.round(b.x)},${Math.round(b.y)})`);
  }
  await page.screenshot({ path: path.join(SHOT_DIR, 'palette-drop.png') });

  // E1 crux: SAME type dropped at a DIFFERENT location lands THERE (not a constant).
  const c1 = await dragPaletteTo('code', 300, 650);
  const c2 = await dragPaletteTo('code', 900, 150);
  const b1 = await nodeBox(c1), b2 = await nodeBox(c2);
  assert.ok(Math.abs(b1.x - 300) < 12 && Math.abs(b2.x - 900) < 12 && Math.abs(b1.x - b2.x) > 400, 'same type drops at different points land at their own drop points');
  log(`B30 E1 same type at two points: (${Math.round(b1.x)},${Math.round(b1.y)}) and (${Math.round(b2.x)},${Math.round(b2.y)}) — distinct, each at its drop point`);

  // E3: a dropped step is selectable & shows type-appropriate config.
  await page.locator(`[data-testid="node"][data-node-id="${placed.httpRequest}"]`).click();
  assert.ok(await page.locator('[data-testid="cfg-url"]').count(), 'dropped HTTP step shows its URL config');
  log('B30 E3 dropped step selectable & configurable (HTTP step shows URL/method)');

  // E4: dropped step is connectable via drag (full-span line), movable, deletable.
  // drag-connect httpRequest -> transform (drop on body, forgiving)
  const src = await page.locator(`[data-testid="port"][data-node-id="${placed.httpRequest}"][data-port="main"]`).boundingBox();
  const tgt = await nodeBox(placed.transform);
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2); await page.mouse.down();
  await page.mouse.move(tgt.x + tgt.width / 2, tgt.y + tgt.height / 2, { steps: 10 }); await page.mouse.up();
  const cid = await page.locator('[data-testid="conn-delete"]').first().getAttribute('data-conn-id');
  // measure painted coverage of the new line (full-span, no stub)
  const coverage = await page.evaluate((id) => {
    const line = document.querySelector(`line[data-conn-id="${id}"]`); const svg = document.querySelector('#links');
    const r = svg.getBoundingClientRect(); const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1'), x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
    svg.style.pointerEvents = 'auto'; line.style.pointerEvents = 'stroke';
    const occ = [...document.querySelectorAll('.node,.port,.conn-del')]; const sv = occ.map((e) => e.style.pointerEvents); occ.forEach((e) => e.style.pointerEvents = 'none');
    let hits = 0, n = 0; for (let i = 0; i <= 20; i++) { const t = 0.15 + 0.7 * i / 20; const cx = r.left + x1 + (x2 - x1) * t, cy = r.top + y1 + (y2 - y1) * t; n++; let h = false; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) if (document.elementFromPoint(cx + dx, cy + dy) === line) { h = true; break; } if (h) hits++; }
    occ.forEach((e, i) => e.style.pointerEvents = sv[i]); svg.style.pointerEvents = ''; line.style.pointerEvents = '';
    return hits / n;
  }, cid);
  assert.ok(coverage > 0.9, `dropped step's connection renders full-span (coverage ${(coverage * 100).toFixed(0)}%)`);
  log(`B30 E4 drag-connected dropped step; line renders full-span (painted coverage ${(coverage * 100).toFixed(0)}%)`);
  // move the dropped transform step
  const beforeMove = await nodeBox(placed.transform);
  await page.mouse.move(beforeMove.x + 30, beforeMove.y + 12); await page.mouse.down();
  await page.mouse.move(beforeMove.x + 30 + 120, beforeMove.y + 12 + 90, { steps: 10 }); await page.mouse.up();
  const afterMove = await nodeBox(placed.transform);
  assert.ok(Math.abs(afterMove.x - beforeMove.x) > 80, 'dropped step is movable');
  // delete the dropped code step c1 with confirmation
  await page.locator(`[data-testid="node-delete"][data-node-id="${c1}"]`).click();
  await page.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${c1}"]`).count(), 0, 'dropped step is deletable (with confirm)');
  log('B30 E4 dropped step is movable and deletable (with confirmation)');

  // E5: drop position persists via save + fresh reload.
  await page.locator('[data-testid="automation-name"]').fill('Palette drop layout');
  const keepId = placed.if;
  const posBeforeSave = await page.locator(`[data-testid="node"][data-node-id="${keepId}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${keepId}"]`);
  const posReload = await page2.locator(`[data-testid="node"][data-node-id="${keepId}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(posReload.x - posBeforeSave.x) < 3 && Math.abs(posReload.y - posBeforeSave.y) < 3, 'drop position persisted across fresh reload');
  log(`B30 E5 drop position persisted across fresh reload: (${posReload.x},${posReload.y}) ~= (${posBeforeSave.x},${posBeforeSave.y})`);

  // E6: click-to-add still works (no regression).
  const beforeClick = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="transform"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), beforeClick + 1, 'E6 click-to-add still works');
  log('B30 E6 no regression: click-to-add still adds a step; connect/move/delete shown working above');

  log('\nALL B30 ASSERTIONS PASSED (drag-from-palette drops at the chosen location; fully usable; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
