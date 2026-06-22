// B33: palette redesign — categories with headings, compact icon buttons, hover
// tooltips (name + description). Presentation-only; no regression. Verified by
// rendered headings/icons + an EXECUTED hover showing the tooltip + screenshots.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const ALL = ['httpRequest', 'transform', 'if', 'switch', 'filter', 'code'];
const EXPECT_CAT = { httpRequest: 'Actions', transform: 'Transform', if: 'Flow', switch: 'Flow', filter: 'Flow', code: 'Code' };
const EXPECT_NAME = { httpRequest: 'Call a web service', transform: 'Reshape data', if: 'Branch on a condition', switch: 'Route by rules', filter: 'Keep matching items', code: 'Run a code snippet' };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  // E1: categories with VISIBLE headings, nodes grouped correctly.
  const cats = await page.locator('[data-testid="palette-category"]').evaluateAll((els) => els.map((e) => ({ name: e.dataset.category, visible: e.offsetParent !== null })));
  log('B33 E1 category headings rendered: ' + JSON.stringify(cats.map((c) => c.name)));
  assert.ok(cats.length >= 3 && cats.every((c) => c.visible), 'category headings are visible');
  const grouping = await page.evaluate(() => {
    const out = {}; let cur = null;
    for (const child of document.querySelector('#palette').children) {
      if (child.dataset && child.dataset.testid === 'palette-category') cur = child.dataset.category;
      else if (child.classList && child.classList.contains('palette-grid')) for (const b of child.querySelectorAll('[data-testid="palette-item"]')) out[b.dataset.stepType] = cur;
    }
    return out;
  });
  for (const t of ALL) assert.equal(grouping[t], EXPECT_CAT[t], `${t} grouped under ${EXPECT_CAT[t]}`);
  log('B33 E1 grouping correct: ' + JSON.stringify(grouping));

  // E2 + E4: every type is a compact icon button.
  for (const t of ALL) {
    const item = page.locator(`[data-testid="palette-item"][data-step-type="${t}"]`);
    const icon = await item.locator('[data-testid="palette-icon"]').textContent();
    const box = await item.boundingBox();
    assert.ok(icon && icon.trim().length > 0, `${t} has a rendered icon`);
    assert.ok(box.width < 130, `${t} button is compact (${Math.round(box.width)}px wide)`);
  }
  log('B33 E2/E4 all six types are compact icon buttons (icon rendered, width < 130px)');

  // E3 + E4 (crux): hover each button -> tooltip APPEARS with name + description.
  const tip = page.locator('[data-testid="palette-tooltip"]');
  for (const t of ALL) {
    await page.locator(`[data-testid="palette-item"][data-step-type="${t}"]`).hover();
    await page.waitForFunction(() => { const el = document.querySelector('[data-testid="palette-tooltip"]'); return el && el.style.display !== 'none'; });
    assert.ok(await tip.isVisible(), `tooltip visible on hover for ${t}`);
    const name = await tip.locator('[data-testid="tooltip-name"]').textContent();
    const desc = await tip.locator('[data-testid="tooltip-desc"]').textContent();
    assert.equal(name.trim(), EXPECT_NAME[t], `tooltip name for ${t}`);
    assert.ok(desc && desc.trim().length > 10, `tooltip description for ${t}`);
    if (t === 'switch') await page.screenshot({ path: path.join(SHOT_DIR, 'palette-tooltip.png') });
  }
  log('B33 E3/E4 hovering each of the six buttons shows a tooltip with its NAME + DESCRIPTION (executed hover; screenshot captured)');

  // E5: click-to-add still works, correct type.
  await page.locator('[data-testid="palette-item"][data-step-type="filter"]').click();
  let last = page.locator('[data-testid="node"]').last();
  assert.equal(await last.getAttribute('data-node-type'), 'filter', 'E5 click-add creates the correct type (filter)');
  log('B33 E5 click-to-add still works (created a filter step)');

  // E6: drag-to-drop still works, correct type AT the drop location.
  const before = await page.locator('[data-testid="node"]').count();
  const pb = await page.locator('[data-testid="palette-item"][data-step-type="switch"]').boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.mouse.down();
  await page.mouse.move(720, 430, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="node"]').length === n, before + 1);
  last = page.locator('[data-testid="node"]').last();
  const cb = await page.locator('[data-testid="canvas"]').boundingBox();
  const lb = await last.boundingBox();
  assert.equal(await last.getAttribute('data-node-type'), 'switch', 'E6 drag-drop creates the correct type (switch)');
  assert.ok(Math.abs(lb.x - 720) < 14 && Math.abs(lb.y - 430) < 14, 'E6 dropped at the drop location');
  log(`B33 E6 drag-to-drop still works: switch dropped at (${Math.round(lb.x)},${Math.round(lb.y)}) ~ (720,430)`);

  // E7/E8: connect + run + delete still work; created steps are real engine types.
  const a = await page.locator('[data-testid="node"][data-node-type="filter"]').last().getAttribute('data-node-id');
  const seedBtn = page.locator('[data-testid="palette-item"][data-step-type="code"]');
  await seedBtn.click();
  const seed = await page.locator('[data-testid="node"]').last().getAttribute('data-node-id');
  await page.locator(`[data-testid="node"][data-node-id="${seed}"]`).click();
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{value:50}}];');
  await page.locator(`[data-testid="node"][data-node-id="${a}"]`).click();
  await page.locator('[data-testid="cfg-left"]').fill('json.value');
  await page.locator('[data-testid="cfg-op"]').selectOption('gte');
  await page.locator('[data-testid="cfg-right"]').fill('10');
  // drag-connect seed -> filter
  const s = await page.locator(`[data-testid="port"][data-node-id="${seed}"][data-port="main"]`).boundingBox();
  const tg = await page.locator(`[data-testid="node"][data-node-id="${a}"]`).boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
  await page.mouse.move(tg.x + tg.width / 2, tg.y + tg.height / 2, { steps: 10 }); await page.mouse.up();
  await page.locator('[data-testid="btn-run"]').click();
  await page.waitForFunction(() => { const st = document.querySelector('[data-testid="run-status"]').dataset.runState; return st && st !== 'in-progress'; }, null, { timeout: 15000 });
  const runState = await page.locator('[data-testid="run-status"]').getAttribute('data-run-state');
  assert.equal(runState, 'completed', 'E7/E8 connect + run still work (real engine types)');
  await page.locator(`[data-testid="node-delete"][data-node-id="${a}"]`).click();
  await page.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${a}"]`).count(), 0, 'E7 delete-with-confirm still works');
  log('B33 E7/E8 no regression: connect/run/delete still work; created steps are real engine types (run completed)');
  await page.screenshot({ path: path.join(SHOT_DIR, 'palette-redesign.png') });

  log('\nALL B33 ASSERTIONS PASSED (categories + compact icon buttons + hover tooltips; no regression; presentation-only).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
