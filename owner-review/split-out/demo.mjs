// Split Out — sample: seed ONE item {tags:['a','b','c']} -> Split Out(json.tags -> tag)
// -> sink. Confirm the single item expands into 3 items, one per element, in order.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const split = await b.addNode('splitOut');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', "return [{ json: { tags: ['a','b','c'] } }];");
  await b.cfg(split);
  await b.fill('cfg-split-field', 'json.tags');
  await b.fill('cfg-split-output', 'tag');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', split);
  await b.connect(split, 'main', sink);
  console.log("built: seed(1 item {tags:[a,b,c]}) -> splitOut(json.tags -> tag) -> sink");

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[split].status, 'completed', 'split out completed');
  const out = s.steps[split].output;
  console.log('split out output:', JSON.stringify(out.map((i) => i.json)));
  assert.equal(out.length, 3, 'one item expanded into 3 items (one per element)');
  assert.deepEqual(out.map((i) => i.json.tag), ['a', 'b', 'c'], 'one element per item, in order, none missing');
  assert.equal(s.steps[sink].input.length, 3, 'downstream received the 3 split items');

  await b.cfg(split);
  await b.shotTo(path.join(DIR, 'split-out-success.png'));
  console.log('Split Out OK: 1 item with [a,b,c] -> 3 items (a / b / c).');
} catch (e) {
  console.error('Split Out demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
