// Summarize — sample: seed [{cat:A,amt:10},{cat:B,amt:5},{cat:A,amt:7}] -> Summarize
// (sum of json.amt, grouped by json.cat, output 'total') -> sink. Expect A=17, B=5.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const seed = await b.addNode('code');
  const sum = await b.addNode('summarize');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', "return [{json:{cat:'A',amt:10}},{json:{cat:'B',amt:5}},{json:{cat:'A',amt:7}}];");
  await b.cfg(sum);
  await b.select('cfg-sum-func', 'sum');
  await b.fill('cfg-sum-field', 'json.amt');
  await b.fill('cfg-sum-groupby', 'json.cat');
  await b.fill('cfg-sum-output', 'total');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', sum);
  await b.connect(sum, 'main', sink);
  console.log('built: seed([A:10,B:5,A:7]) -> summarize(sum amt group by cat -> total) -> sink');

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[sum].status, 'completed', 'summarize completed');
  const out = s.steps[sum].output.map((i) => i.json);
  console.log('summarize output:', JSON.stringify(out));
  assert.equal(out.length, 2, 'one summary row per group');
  const byTotal = Object.fromEntries(out.map((r) => [r.cat, r.total]));
  assert.equal(byTotal.A, 17, 'group A sum = 10 + 7 = 17');
  assert.equal(byTotal.B, 5, 'group B sum = 5');

  await b.cfg(sum);
  await b.shotTo(path.join(DIR, 'summarize-success.png'));
  console.log('Summarize OK: grouped sum A=17, B=5.');
} catch (e) {
  console.error('Summarize demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
