// B54: Load via point-and-pick list of saved automations BY NAME (defect fix —
// no free-text id entry). Verified by the real list + picking + correct load.
import { chromium } from 'playwright';
import { strict as assert } from 'assert';
import * as path from 'path';

const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const SHOT_DIR = process.env.SHOT_DIR ?? '.';
const log = (m) => console.log(m);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  // Fail loudly if any native prompt() appears (the old defect must be gone).
  page.on('dialog', async (d) => { await d.dismiss(); throw new Error('a native prompt/dialog appeared — id-typing not removed'); });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const add = async (type) => { await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click(); return page.locator('[data-testid="node"]').last().getAttribute('data-node-id'); };
  const selNode = (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click();
  const saveAs = async (name) => { await page.locator('[data-testid="automation-name"]').fill(name); await page.locator('[data-testid="btn-save"]').click(); await page.waitForFunction((n) => document.querySelector('[data-testid="run-status"]').dataset.defId && document.querySelector('[data-testid="automation-name"]').value === n, name); };

  // E4: empty state (DB was wiped) — Load shows a 'no saved automations' state.
  await page.locator('[data-testid="btn-load"]').click();
  await page.waitForSelector('[data-testid="load-panel"]');
  assert.ok(await page.locator('[data-testid="load-empty"]').isVisible(), 'E4 empty state shown when there are no saved automations');
  log('B54 E4 empty state: "' + (await page.locator('[data-testid="load-empty"]').textContent()).trim() + '"');
  await page.locator('[data-testid="btn-load-close"]').click();

  // Build + save two DISTINCTLY-named automations.
  const a = await add('code'); await selNode(a); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{which:"alpha"}}];');
  await saveAs('Alpha pipeline');
  await page.locator('[data-testid="btn-new"]').click();
  const b = await add('code'); await selNode(b); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{which:"beta"}}];');
  await saveAs('Beta pipeline');
  log('saved two automations: "Alpha pipeline" and "Beta pipeline"');

  // E1: Load presents a selectable list BY NAME.
  await page.locator('[data-testid="btn-load"]').click();
  await page.waitForSelector('[data-testid="load-item"]');
  const names = await page.locator('[data-testid="load-item-name"]').evaluateAll((els) => els.map((e) => e.textContent));
  assert.ok(names.includes('Alpha pipeline') && names.includes('Beta pipeline'), 'E1 list shows the real saved names: ' + JSON.stringify(names));
  log('B54 E1 Load list shows saved automations by name: ' + JSON.stringify(names));

  // E2: no free-text id input anywhere in the Load flow.
  assert.equal(await page.locator('[data-testid="load-panel"] input[type="text"], [data-testid="load-panel"] input:not([type])').count(), 0, 'E2 no free-text id entry in the Load flow');
  await page.screenshot({ path: path.join(SHOT_DIR, 'load-picker.png') });
  await page.locator('[data-testid="btn-load-close"]').click();

  // Pick a saved automation by clicking its name; verify its distinctive content loads.
  const pickAndCheck = async (name, marker) => {
    await page.locator('[data-testid="btn-new"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="node"]').length === 0);
    await page.locator('[data-testid="btn-load"]').click();
    await page.waitForSelector('[data-testid="load-item"]');
    await page.locator(`[data-testid="load-item"]:has-text("${name}")`).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="node"]').length > 0);
    assert.equal(await page.locator('[data-testid="automation-name"]').inputValue(), name, `picking "${name}" opened ${name}`);
    await page.locator('[data-testid="node"]').first().click();
    assert.ok((await page.locator('[data-testid="cfg-code"]').inputValue()).includes(marker), `the picked automation's distinctive content (${marker}) loaded`);
  };

  // E2/E3: pick Beta by clicking -> Beta loads; then Alpha -> Alpha loads.
  await pickAndCheck('Beta pipeline', 'beta');
  log('B54 E2/E3 picked "Beta pipeline" by clicking -> Beta loaded (which:beta)');
  await pickAndCheck('Alpha pipeline', 'alpha');
  log('B54 E3 picking a different one ("Alpha pipeline") loads the different one (which:alpha)');

  // E5: restore fidelity — build a richer automation, save, load it, verify restored.
  await page.locator('[data-testid="btn-new"]').click();
  const seed = await add('code'); await selNode(seed); await page.locator('[data-testid="cfg-code"]').fill('return [{json:{v:5}}];');
  const ifn = await add('if'); await selNode(ifn); await page.locator('[data-testid="cfg-left"]').fill('json.v'); await page.locator('[data-testid="cfg-op"]').selectOption('gt'); await page.locator('[data-testid="cfg-right"]').fill('3');
  // connect seed -> if (click-connect)
  await page.locator(`[data-testid="port"][data-node-id="${seed}"][data-port="main"]`).click();
  await page.locator(`[data-testid="node"][data-node-id="${ifn}"]`).click();
  await saveAs('Rich pipeline');
  await page.locator('[data-testid="btn-new"]').click();
  await page.locator('[data-testid="btn-load"]').click();
  await page.locator('[data-testid="load-item"]:has-text("Rich pipeline")').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="automation-name"]').value === 'Rich pipeline');
  assert.equal(await page.locator('[data-testid="node"]').count(), 2, 'E5 steps restored');
  assert.equal(await page.locator('[data-testid="conn-delete"]').count(), 1, 'E5 connection restored');
  await page.locator(`[data-testid="node"][data-node-id="${ifn}"]`).click();
  assert.equal(await page.locator('[data-testid="cfg-right"]').inputValue(), '3', 'E5 config restored');
  log('B54 E5 restore fidelity: steps + connection + config restored by the picker-load');

  // E6: no regression — reopening via ?def= still works.
  const defId = await page.locator('[data-testid="run-status"]').getAttribute('data-def-id');
  await page.goto(URL + '?def=' + defId, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="node"]').length === 2);
  assert.equal(await page.locator('[data-testid="automation-name"]').inputValue(), 'Rich pipeline', 'E6 reopen via saved reference (?def) still works');
  log('B54 E6 no regression: save + reopen via ?def reference still works');

  log('\nALL B54 ASSERTIONS PASSED (Load is a point-and-pick list by name; no id typing; correct automation loads; empty state; restore fidelity; no regression).');
} catch (err) {
  console.error('ASSERTION FAILED:', err.stack || err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
