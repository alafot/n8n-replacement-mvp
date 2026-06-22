// Loop Over Items — sample workflow: seed 3 items -> Loop(batch size 1) -> body (marks
// processed) on the loop output, done path on the done output. Confirm the body ran once
// per item (3 iterations), every item processed exactly once, done path completed.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const { page } = b;
  const seed = await b.addNode('code');
  const loop = await b.addNode('loop');
  const body = await b.addNode('code');
  const done = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', 'return [{json:{id:1}},{json:{id:2}},{json:{id:3}}];');
  await b.cfg(loop);
  await b.fill('cfg-batch-size', '1');
  await b.cfg(body);
  await b.fill('cfg-code', 'return $input.map(it=>({json:{...it.json, processed:true}}));');
  await b.cfg(done);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', loop);
  await b.connect(loop, 'loop', body);
  await b.connect(loop, 'done', done);
  console.log('built: seed(3 items) -> loop(batch 1) -[loop]-> body(processed) / -[done]-> done');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  const iterations = s.steps[loop].meta?.iterations;
  const doneItems = s.steps[done].input || [];
  const ids = doneItems.map((it) => it.json.id).sort();
  console.log('loop iterations:', iterations, '| done received ids:', JSON.stringify(ids),
    '| all processed:', doneItems.every((it) => it.json.processed === true));

  assert.equal(iterations, 3, 'body ran once per batch: 3 iterations for 3 items at batch size 1');
  assert.deepEqual(ids, [1, 2, 3], 'every item reached the done path exactly once');
  assert.ok(doneItems.every((it) => it.json.processed === true), 'every item went through the loop body');
  assert.equal(s.steps[done].status, 'completed', 'done path ran after the final batch');

  await b.cfg(done); // show the done path's accumulated output in the inspector
  await b.shotTo(path.join(DIR, 'loop-success.png'));
  console.log('Loop OK: 3 iterations over 3 items, all processed exactly once, done path completed.');
} catch (e) {
  console.error('Loop demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
