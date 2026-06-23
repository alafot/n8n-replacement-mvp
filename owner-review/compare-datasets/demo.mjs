// Compare Datasets — sample: dataset A [1,2,3] and B [2,3,4] -> Compare Datasets(key json.id),
// three outputs (matched / onlyA / onlyB) -> three sinks. Expect matched=[2,3], onlyA=[1], onlyB=[4].
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
const { page } = b;

// drag from a source output handle to a target node's named INPUT handle
const dragToInput = async (fromId, port, toId, toPort) => {
  const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
  const t = await page.locator(`[data-testid="input-port"][data-node-id="${toId}"][data-port="${toPort}"]`).boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 }); await page.mouse.up();
};
const dragConnect = async (fromId, port, toId) => {
  const s = await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).boundingBox();
  const t = await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).boundingBox();
  await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2); await page.mouse.down();
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await page.mouse.up();
};
const idsAt = (s, nid) => (s.steps[nid].input || []).map((it) => it.json.id).sort();

try {
  const cmp = await b.addNode('compareDatasets');
  await b.cfg(cmp);
  await b.fill('cfg-compare-key', 'json.id');

  const aSrc = await b.addNode('code'); await b.cfg(aSrc); await b.fill('cfg-code', 'return [{json:{id:1,from:"A"}},{json:{id:2,from:"A"}},{json:{id:3,from:"A"}}];');
  const bSrc = await b.addNode('code'); await b.cfg(bSrc); await b.fill('cfg-code', 'return [{json:{id:2,from:"B"}},{json:{id:3,from:"B"}},{json:{id:4,from:"B"}}];');
  const mSink = await b.addNode('code'); await b.cfg(mSink); await b.fill('cfg-code', 'return $input;');
  const aSink = await b.addNode('code'); await b.cfg(aSink); await b.fill('cfg-code', 'return $input;');
  const bSink = await b.addNode('code'); await b.cfg(bSink); await b.fill('cfg-code', 'return $input;');

  await dragToInput(aSrc, 'main', cmp, 'a');
  await dragToInput(bSrc, 'main', cmp, 'b');
  await dragConnect(cmp, 'matched', mSink);
  await dragConnect(cmp, 'onlyA', aSink);
  await dragConnect(cmp, 'onlyB', bSink);
  console.log('built: A[1,2,3] + B[2,3,4] -> compareDatasets(key id) -> matched/onlyA/onlyB sinks');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[cmp].status, 'completed', 'compare datasets completed');
  console.log('matched:', JSON.stringify(idsAt(s, mSink)), 'onlyA:', JSON.stringify(idsAt(s, aSink)), 'onlyB:', JSON.stringify(idsAt(s, bSink)));
  assert.deepEqual(idsAt(s, mSink), [2, 3], 'matched = 2,3');
  assert.deepEqual(idsAt(s, aSink), [1], 'only-in-A = 1');
  assert.deepEqual(idsAt(s, bSink), [4], 'only-in-B = 4');

  await b.cfg(mSink);
  await b.shotTo(path.join(DIR, 'compare-datasets-success.png'));
  console.log('Compare Datasets OK: matched [2,3], onlyA [1], onlyB [4].');
} catch (e) {
  console.error('Compare Datasets demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
