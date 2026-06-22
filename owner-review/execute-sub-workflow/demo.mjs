// Execute Sub-workflow — sample:
//  1. Save a sub-workflow "Doubler (review demo)": a code step that doubles json.value.
//  2. New parent: seed(value 5) -> Execute Sub-workflow(Doubler) -> sink.
//  Confirm the parent's downstream receives 10 (5 doubled) — proving the sub genuinely ran.
import { openBuilder } from '../_lib.mjs';
import { strict as assert } from 'assert';
import * as path from 'path';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const SUB_NAME = 'Doubler (review demo)';

// ---- 1) Build + save the sub-workflow ----
{
  const b = await openBuilder();
  try {
    const { page } = b;
    const doubler = await b.addNode('code');
    await b.cfg(doubler);
    await b.fill('cfg-code', 'return $input.map(it => ({ json: { ...it.json, value: (it.json.value || 0) * 2 } }));');
    await page.locator('#automation-name').fill(SUB_NAME);
    await page.locator('#btn-save').click();
    await page.waitForFunction(() => location.search.includes('def='), null, { timeout: 8000 });
    console.log('saved sub-workflow:', SUB_NAME, '->', await page.evaluate(() => location.search));
  } catch (e) { console.error('sub-workflow save FAILED:', e.stack || e.message); process.exitCode = 1; }
  finally { await b.close(); }
}

// ---- 2) Build the parent that calls it ----
{
  const b = await openBuilder();
  try {
    const { page } = b;
    const seed = await b.addNode('code');
    const exec = await b.addNode('executeSubworkflow');
    const sink = await b.addNode('code');

    await b.cfg(seed);
    await b.fill('cfg-code', 'return [{ json: { value: 5 } }];');
    await b.cfg(exec);
    // wait for the dropdown to populate from /definitions, then select Doubler by its label.
    await page.waitForFunction(() => document.querySelector('[data-testid="cfg-subworkflow"]')?.options.length > 1, null, { timeout: 8000 });
    const subId = await page.locator('[data-testid="cfg-subworkflow"]').evaluate((sel, name) => {
      const opt = [...sel.options].find((o) => o.textContent.startsWith(name));
      return opt ? opt.value : '';
    }, SUB_NAME);
    assert.ok(subId, 'Doubler appears in the sub-workflow dropdown');
    await page.locator('[data-testid="cfg-subworkflow"]').selectOption(subId);
    await b.cfg(sink);
    await b.fill('cfg-code', 'return $input;');

    await b.connect(seed, 'main', exec);
    await b.connect(exec, 'main', sink);
    console.log('built parent: seed(value 5) -> executeSubworkflow(Doubler) -> sink');

    const runId = await b.run();
    const s = await b.engineSteps(runId);
    assert.equal(s.steps[exec].status, 'completed', 'execute-sub-workflow step completed');
    const downstream = s.steps[sink].input.map((i) => i.json.value);
    console.log('parent downstream values:', JSON.stringify(downstream), '(expected [10] = 5 doubled by the sub)');
    assert.deepEqual(downstream, [10], 'the sub-workflow genuinely ran: 5 came back as 10');

    await b.cfg(sink);
    await b.shotTo(path.join(DIR, 'execute-sub-success.png'));
    console.log('Execute Sub-workflow OK: parent called Doubler, got 10 from 5 back downstream.');
  } catch (e) { console.error('parent run FAILED:', e.stack || e.message); process.exitCode = 1; }
  finally { await b.close(); }
}
