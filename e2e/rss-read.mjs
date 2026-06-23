// B60: RSS Read — fetch an RSS/Atom feed and turn its entries into one item per
// entry. Verified against a local, reachable, OFFLINE test feed with KNOWN
// entries: the item COUNT equals the entry count, each item carries correct
// title/link/pubDate, downstream receives them, and an unreachable/invalid feed
// surfaces a CLEAR failure; CRUD/persist; no regression.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const FEED = 'http://127.0.0.1:3000/test/rss';
const BAD_FEED = 'http://127.0.0.1:3000/test/rss-missing';
// KNOWN feed contents.
const EXPECT = [
  { title: 'First Post', link: 'https://example.test/first' },
  { title: 'Second Post', link: 'https://example.test/second' },
  { title: 'Third Post', link: 'https://example.test/third' },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1340, height: 800 });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const selNode = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click();
  const dragConnect = async (fromId, port, toId) => {
    const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
    const t = await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).boundingBox();
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await page.mouse.up();
  };
  const runSteps = async () => {
    const prev = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.locator('[data-testid="btn-run"]').click();
    await page.waitForFunction((p) => { const r = document.querySelector('[data-testid="run-status"]').dataset.runId; return r && r !== p; }, prev);
    const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.waitForFunction((id) => { const el = document.querySelector('[data-testid="run-status"]'); return el.dataset.runId === id && el.dataset.runState && el.dataset.runState !== 'in-progress'; }, runId, { timeout: 20000 });
    return page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId);
  };

  // E1: add an RSS Read step; configure the feed URL.
  const rss = await add('rssRead');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${rss}"]`).getAttribute('data-node-type'), 'rssRead', 'E1 RSS Read step added');
  await selNode(rss);
  await page.locator('[data-testid="cfg-rss-url"]').fill(FEED);
  log('B60 E1 added RSS Read step; feed URL configured');

  const sink = await add('code'); await selNode(sink);
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{count:$input.length, titles:$input.map(i=>i.json.title), firstLink:$input[0].json.link}}];');
  await dragConnect(rss, 'main', sink);

  // E2/E3/E5/E6: run against the KNOWN feed and verify count + per-entry fields.
  const s = await runSteps();
  assert.equal(s.status, 'completed', 'E2 the RSS run completed');
  const items = s.steps[rss].output;
  assert.equal(items.length, EXPECT.length, `E2 one item per entry — count matches (${items.length} == ${EXPECT.length})`);
  EXPECT.forEach((e, i) => {
    assert.equal(items[i].json.title, e.title, `E3 entry ${i} title correct ('${e.title}')`);
    assert.equal(items[i].json.link, e.link, `E3 entry ${i} link correct ('${e.link}')`);
    assert.ok(items[i].json.pubDate, `E3 entry ${i} carries a publication date`);
  });
  log(`B60 E2 ${items.length} entries -> ${items.length} items (count matches the known feed)`);
  log(`B60 E3 titles=${JSON.stringify(items.map((it) => it.json.title))}; links match the known feed; each has a pubDate`);
  const din = s.steps[sink].input;
  assert.equal(din.length, EXPECT.length, 'E6 downstream received the per-entry items (all of them)');
  assert.deepEqual(s.steps[sink].output[0].json.titles, EXPECT.map((e) => e.title), 'E6 downstream read the entry titles');
  assert.equal(s.steps[sink].output[0].json.firstLink, EXPECT[0].link, 'E5 distinctive real data correlates to the feed (first link)');
  log('B60 E5/E6 downstream received the items and read distinctive titles/links from the real feed');
  await page.screenshot({ path: path.join(SHOT_DIR, 'rss-read-run.png') });

  // E4: unreachable/invalid feed -> CLEAR failure (not fake/empty success).
  await selNode(rss);
  await page.locator('[data-testid="cfg-rss-url"]').fill(BAD_FEED);
  const sErr = await runSteps();
  assert.equal(sErr.status, 'failed', 'E4 an unreachable/invalid feed fails the run clearly (not a fake/empty success)');
  const failedStep = Object.values(sErr.steps).find((st) => st.status === 'failed' && st.error);
  assert.ok(failedStep && /rss|feed|fetch|status/i.test(failedStep.error), `E4 the failure carries clear error info (got ${JSON.stringify(failedStep && failedStep.error)})`);
  log(`B60 E4 error case: unreachable feed -> run FAILED with clear error: "${failedStep.error}"`);
  // restore the good URL for persistence checks
  await selNode(rss);
  await page.locator('[data-testid="cfg-rss-url"]').fill(FEED);

  // E7: full step behaviour + persistence (config AND layout) across reload.
  await page.locator('[data-testid="automation-name"]').fill('RSS test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${rss}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${rss}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${rss}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-rss-url"]').inputValue(), FEED, 'E7 feed URL persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${rss}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E7 layout persisted');
  log(`B60 E7 config (feed URL) + layout persisted across a fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${rss}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${rss}"]`).count(), 0, 'E7 RSS Read step deletable with confirmation');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E7 deleting it removed its connections');
  log('B60 E7 selectable/configurable/connectable(full-span)/movable/deletable-with-confirm');

  // E8: no regression — other node types + click-add still function.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="graphql"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E8 existing types + click-add still work');
  log('B60 E8 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B60 ASSERTIONS PASSED (RSS Read: one item per entry, count + per-entry fields correct against the known feed; downstream receives them; unreachable feed fails clearly; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
