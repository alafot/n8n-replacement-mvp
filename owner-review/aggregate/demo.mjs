// Aggregate — sample: seed 3 items (amount 10,20,30) -> Aggregate(field json.amount -> amounts)
// -> sink. Confirm the 3 items collapse to ONE item whose 'amounts' holds [10,20,30].
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const agg = await b.addNode('aggregate');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', 'return [{json:{amount:10}},{json:{amount:20}},{json:{amount:30}}];');
  await b.cfg(agg);
  await b.fill('cfg-agg-field', 'json.amount');
  await b.fill('cfg-agg-output', 'amounts');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', agg);
  await b.connect(agg, 'main', sink);
  console.log('built: seed(3 items: amount 10,20,30) -> aggregate(json.amount -> amounts) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[agg].status, 'completed', 'aggregate completed');
  const out = s.steps[agg].output;
  console.log('aggregate output:', JSON.stringify(out.map((i) => i.json)));
  assert.equal(out.length, 1, 'many items collapsed into exactly one output item');
  assert.deepEqual(out[0].json.amounts, [10, 20, 30], 'the output field holds all collected values');
  assert.equal(s.steps[sink].input.length, 1, 'downstream received the single aggregated item');

  await b.cfg(agg);
  await b.shotTo(path.join(DIR, 'aggregate-success.png'));
  console.log('Aggregate OK: 3 items -> 1 item with amounts [10,20,30].');
} catch (e) {
  console.error('Aggregate demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
