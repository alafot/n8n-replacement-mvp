// B28: reposition a step by dragging; connections stay attached and follow;
// wiring unchanged; position persists across save + reload (fresh session).
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

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const connectClick = async (f, port, t) => { await page.locator(`[data-testid="port"][data-node-id="${f}"][data-port="${port}"]`).click(); await page.locator(`[data-testid="node"][data-node-id="${t}"]`).click(); };
  const pos = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  const lineCoords = (connId) => page.locator(`line[data-conn-id="${connId}"]`).evaluate((el) => ({ x1: +el.getAttribute('x1'), y1: +el.getAttribute('y1') }));
  const conns = () => page.locator('[data-testid="conn-delete"]').evaluateAll((els) => els.map((e) => ({ id: e.dataset.connId, from: e.dataset.from, to: e.dataset.to, port: e.dataset.port })));

  const a = await add('httpRequest');
  const b = await add('code');
  await connectClick(a, 'main', b);
  const wiringBefore = JSON.stringify((await conns()).map((c) => `${c.from}-${c.port}->${c.to}`).sort());
  const connId = (await conns())[0].id;

  // E1: drag step A to a new position.
  const before = await pos(a);
  const lineBefore = await lineCoords(connId);
  const bx = await page.locator(`[data-testid="node"][data-node-id="${a}"]`).boundingBox();
  await page.mouse.move(bx.x + 30, bx.y + 12);
  await page.mouse.down();
  await page.mouse.move(bx.x + 30 + 260, bx.y + 12 + 180, { steps: 12 });
  await page.mouse.up();
  const after = await pos(a);
  assert.ok(Math.abs(after.x - before.x) > 100 && Math.abs(after.y - before.y) > 100, 'E1 step moved to a new position');
  log(`B28 E1 dragged step: (${before.x},${before.y}) -> (${after.x},${after.y})`);

  // E2: the connection stays attached and follows (its source endpoint re-routes).
  const cAfter = await conns();
  assert.equal(cAfter.length, 1, 'connection still present (not detached)');
  assert.ok(cAfter[0].from === a && cAfter[0].to === b, 'same endpoints after move');
  const lineAfter = await lineCoords(connId);
  assert.ok(lineAfter.x1 !== lineBefore.x1 || lineAfter.y1 !== lineBefore.y1, 'E2 the link re-routed to follow the moved step');
  log(`B28 E2 connection followed: link source endpoint (${lineBefore.x1},${lineBefore.y1}) -> (${lineAfter.x1},${lineAfter.y1}), endpoints unchanged (${a}->${b})`);

  // E3: wiring/graph unchanged — layout only.
  const wiringAfter = JSON.stringify((await conns()).map((c) => `${c.from}-${c.port}->${c.to}`).sort());
  assert.equal(wiringAfter, wiringBefore, 'E3 wiring identical before/after (move did not rewire)');
  log('B28 E3 wiring unchanged by the move: ' + wiringAfter);
  await page.screenshot({ path: path.join(SHOT_DIR, 'drag-move.png') });

  // E4: position persists via save + reload in a FRESH session.
  await page.locator('[data-testid="automation-name"]').fill('Layout test');
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();

  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${a}"]`);
  const reloaded = await page2.locator(`[data-testid="node"][data-node-id="${a}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(reloaded.x - after.x) < 3 && Math.abs(reloaded.y - after.y) < 3, 'E4 position persisted across save + fresh reload');
  log(`B28 E4 position persisted across save + fresh session: reloaded at (${reloaded.x},${reloaded.y}) ~= (${after.x},${after.y})`);

  log('\nALL B28 ASSERTIONS PASSED (drag-move, links follow, wiring unchanged, position persists).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
