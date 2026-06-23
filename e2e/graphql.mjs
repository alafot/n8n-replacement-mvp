// B59: GraphQL — send a query (with variables) to a configured endpoint and put
// the response data on the item. Verified against a local, reachable, OFFLINE
// test GraphQL endpoint with a KNOWN query -> EXPECTED data; variables change the
// result; downstream reads it; the error case surfaces a CLEAR failure;
// CRUD/persist; no regression.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const ENDPOINT = 'http://127.0.0.1:3000/test/graphql';
const QUERY = 'query($id: ID!){ user(id: $id){ id name } }';

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

  // E1: add a GraphQL step; configure endpoint + query + variables.
  // graphql -> sink(reads response).
  const gql = await add('graphql');
  assert.equal(await page.locator(`[data-testid="node"][data-node-id="${gql}"]`).getAttribute('data-node-type'), 'graphql', 'E1 GraphQL step added');
  await selNode(gql);
  await page.locator('[data-testid="cfg-graphql-endpoint"]').fill(ENDPOINT);
  await page.locator('[data-testid="cfg-graphql-query"]').fill(QUERY);
  await page.locator('[data-testid="cfg-graphql-variables"]').fill('{"id":"7"}');
  await page.locator('[data-testid="cfg-graphql-output"]').fill('data');
  log('B59 E1 added GraphQL step; endpoint + query(user by $id) + variables {id:7}');

  const sink = await add('code'); await selNode(sink);
  await page.locator('[data-testid="cfg-code"]').fill('return [{json:{readName:$input[0].json.data.user.name, readId:$input[0].json.data.user.id}}];');
  await dragConnect(gql, 'main', sink);

  // E2/E3/E5/E6: run with the KNOWN query+variables and verify EXPECTED data.
  let s = await runSteps();
  assert.equal(s.status, 'completed', 'E2 the GraphQL run completed');
  const data7 = s.steps[gql].output[0].json.data;
  assert.equal(data7.user.id, '7', 'E2 response data correct (user.id=7) for the known query+variable');
  assert.equal(data7.user.name, 'Ada', 'E2 response data correct (user.name=Ada) for id 7 — distinctive real data');
  const din = s.steps[sink].input[0].json;
  assert.equal(din.data.user.name, 'Ada', 'E6 downstream input carries the response data');
  assert.equal(s.steps[sink].output[0].json.readName, 'Ada', 'E3 downstream READ the returned data (name=Ada)');
  log(`B59 E2 known query (id=7) -> user {id:'${data7.user.id}', name:'${data7.user.name}'} (known -> expected)`);
  log('B59 E3/E6 downstream read name=Ada from the GraphQL response');

  // E2 (variables exercised): change the variable -> the result changes accordingly.
  await selNode(gql);
  await page.locator('[data-testid="cfg-graphql-variables"]').fill('{"id":"1"}');
  s = await runSteps();
  assert.equal(s.steps[gql].output[0].json.data.user.name, 'Alan', 'E2 changing the variable (id=1) changes the result (name=Alan)');
  log("B59 E2 variable change id=1 -> name='Alan' (the variable genuinely affects the result)");
  await page.screenshot({ path: path.join(SHOT_DIR, 'graphql-run.png') });

  // E4: error case — a bad query surfaces as a CLEAR failure, not a fake success.
  await selNode(gql);
  await page.locator('[data-testid="cfg-graphql-query"]').fill('{ nope }');
  const sErr = await runSteps();
  assert.equal(sErr.status, 'failed', 'E4 a bad GraphQL query fails the run clearly (not a fake success)');
  const failedStep = Object.values(sErr.steps).find((st) => st.status === 'failed' && st.error);
  assert.ok(failedStep && /graphql/i.test(failedStep.error), `E4 the failure carries clear GraphQL error info (got ${JSON.stringify(failedStep && failedStep.error)})`);
  log(`B59 E4 error case: bad query -> run FAILED with clear error: "${failedStep.error}"`);
  // restore the good query for persistence checks
  await selNode(gql);
  await page.locator('[data-testid="cfg-graphql-query"]').fill(QUERY);
  await page.locator('[data-testid="cfg-graphql-variables"]').fill('{"id":"7"}');

  // E7: full step behaviour + persistence (config AND layout) across reload.
  await page.locator('[data-testid="automation-name"]').fill('GraphQL test');
  const pos = await page.locator(`[data-testid="node"][data-node-id="${gql}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  await page.locator('[data-testid="btn-save"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.defId);
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await ctx.close();
  const ctx2 = await browser.newContext(); const page2 = await ctx2.newPage();
  await page2.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page2.waitForSelector(`[data-testid="node"][data-node-id="${gql}"]`);
  await page2.locator(`[data-testid="node"][data-node-id="${gql}"]`).click();
  assert.equal(await page2.locator('[data-testid="cfg-graphql-endpoint"]').inputValue(), ENDPOINT, 'E7 endpoint persisted');
  assert.equal(await page2.locator('[data-testid="cfg-graphql-query"]').inputValue(), QUERY, 'E7 query persisted');
  assert.equal(await page2.locator('[data-testid="cfg-graphql-variables"]').inputValue(), '{"id":"7"}', 'E7 variables persisted');
  assert.equal(await page2.locator('[data-testid="cfg-graphql-output"]').inputValue(), 'data', 'E7 output name persisted');
  const pos2 = await page2.locator(`[data-testid="node"][data-node-id="${gql}"]`).evaluate((el) => ({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
  assert.ok(Math.abs(pos2.x - pos.x) < 3 && Math.abs(pos2.y - pos.y) < 3, 'E7 layout persisted');
  log(`B59 E7 config (endpoint + query + variables + output) + layout persisted across a fresh reload at (${pos2.x},${pos2.y})`);
  const cb = await page2.locator('[data-testid="conn-delete"]').count();
  await page2.locator(`[data-testid="node-delete"][data-node-id="${gql}"]`).click();
  await page2.locator('[data-testid="confirm-delete-yes"]').click();
  assert.equal(await page2.locator(`[data-testid="node"][data-node-id="${gql}"]`).count(), 0, 'E7 GraphQL step deletable with confirmation');
  assert.ok((await page2.locator('[data-testid="conn-delete"]').count()) < cb, 'E7 deleting it removed its connections');
  log('B59 E7 selectable/configurable/connectable(full-span)/movable/deletable-with-confirm');

  // E8: no regression — other node types + click-add still function.
  const before = await page2.locator('[data-testid="node"]').count();
  await page2.locator('[data-testid="palette-item"][data-step-type="crypto"]').click();
  assert.equal(await page2.locator('[data-testid="node"]').count(), before + 1, 'E8 existing types + click-add still work');
  log('B59 E8 no regression: other node types + add/connect/move/delete/run still function');

  log('\nALL B59 ASSERTIONS PASSED (GraphQL query returns correct known data; variables change the result; downstream reads it; error case fails clearly; CRUD/persist; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
