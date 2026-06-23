// Date & Time — sample: seed {date:'2026-01-01'} -> Date&Time(add 1 day, output 'result')
// -> sink. Confirm result is exactly 2026-01-02 (known input/expected output), date preserved.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const b = await openBuilder();
try {
  const { page } = b;
  const seed = await b.addNode('code');
  const dt = await b.addNode('dateTime');
  const sink = await b.addNode('code');

  await b.cfg(seed);
  await b.fill('cfg-code', "return [{ json: { date: '2026-01-01', label: 'newyear' } }];");
  await b.cfg(dt);
  await b.select('cfg-dt-operation', 'add'); // re-renders amount/unit fields
  await b.fill('cfg-dt-field', 'json.date');
  await b.fill('cfg-dt-amount', '1');
  await b.select('cfg-dt-unit', 'days');
  await b.fill('cfg-dt-output', 'result');
  await b.cfg(sink);
  await b.fill('cfg-code', 'return $input;');

  await b.connect(seed, 'main', dt);
  await b.connect(dt, 'main', sink);
  console.log("built: seed({date:2026-01-01}) -> dateTime(add 1 day -> result) -> sink");

  const runId = await b.run();
  const s = await b.engineSteps(runId);
  assert.equal(s.steps[dt].status, 'completed', 'date & time completed');
  const out = s.steps[dt].output[0].json;
  console.log('date&time output:', JSON.stringify(out));
  assert.ok(String(out.result).startsWith('2026-01-02'), 'add 1 day to 2026-01-01 => 2026-01-02 (got ' + out.result + ')');
  assert.equal(out.date, '2026-01-01', 'original date field preserved');
  assert.equal(out.label, 'newyear', 'other fields preserved');

  await b.cfg(dt);
  await b.shotTo(path.join(DIR, 'date-and-time-success.png'));
  console.log('Date & Time OK: 2026-01-01 + 1 day = 2026-01-02.');
} catch (e) {
  console.error('Date & Time demo FAILED:', e.stack || e.message);
  process.exitCode = 1;
} finally {
  await b.close();
}
