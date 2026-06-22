// Merge node — sample workflow: two seed branches (A: 2 items, B: 1 item) -> Merge (append)
// -> sink. Run on the real engine and confirm the Merge output contains items from BOTH
// branches; screenshot the successful run.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const { page } = b;
  const seedA = await b.addNode('code');
  const seedB = await b.addNode('code');
  const merge = await b.addNode('merge');
  const sink  = await b.addNode('code');

  await b.cfg(seedA);
  await b.fill('cfg-code', 'return [{ json: { src: "A", n: 1 } }, { json: { src: "A", n: 2 } }];');
  await b.cfg(seedB);
  await b.fill('cfg-code', 'return [{ json: { src: "B", n: 3 } }];');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seedA, 'main', merge);
  await b.connect(seedB, 'main', merge);
  await b.connect(merge, 'main', sink);
  console.log('built: seedA(2 items) + seedB(1 item) -> merge(append) -> sink');

  const runId = await b.run();
  console.log('run:', runId);

  const mergeStatus = await b.status(merge);
  assert.equal(mergeStatus, 'completed', 'merge step completed');

  // Inspect the merge output: should contain items from BOTH branches (3 total).
  await b.cfg(merge);
  const out = JSON.parse(await page.locator('[data-testid="step-output"]').textContent());
  const srcs = out.map((i) => i.json.src).sort();
  console.log('merge output srcs:', JSON.stringify(srcs), 'count:', out.length);
  assert.equal(out.length, 3, 'merge combined all 3 items from both branches');
  assert.deepEqual([...new Set(srcs)].sort(), ['A', 'B'], 'items from BOTH branch A and branch B present');

  await b.shotTo(path.join(DIR, 'merge-success.png'));
  console.log('Merge OK: items from both inputs appear together on the single output.');
} catch (e) {
  console.error('Merge demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
