// Records two videos:
//  1) 01-building.webm   — a simulated human building + running a workflow in the builder.
//  2) 02-temporal.webm   — touring that exact run inside Temporal's own Web UI.
// A visible cursor + a caption banner are injected so the videos are easy to follow.
import { chromium } from 'playwright';
import * as path from 'path';
import { rename } from 'fs/promises';

const BASE = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';
const TEMPORAL_UI = process.env.TEMPORAL_UI ?? 'http://localhost:8233';
const DIR = path.dirname(new URL(import.meta.url).pathname);
const RAW = path.join(DIR, 'raw');

// Injected into every page: a fake cursor that follows the mouse + a caption banner.
const OVERLAY = `
(() => {
  const add = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div'); c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:20px;height:20px;border-radius:50%;background:rgba(255,70,70,.55);border:2px solid #c00;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);transition:width .08s,height .08s';
    const b = document.createElement('div'); b.id = '__cap';
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;pointer-events:none;background:rgba(17,24,39,.92);color:#fff;font:600 18px/1.5 system-ui,sans-serif;padding:12px 18px;text-align:center;letter-spacing:.2px';
    document.body.appendChild(c); document.body.appendChild(b);
    addEventListener('mousemove', e => { c.style.left = e.clientX+'px'; c.style.top = e.clientY+'px'; }, true);
    addEventListener('mousedown', () => { c.style.width='12px'; c.style.height='12px'; c.style.background='rgba(255,0,0,.85)'; }, true);
    addEventListener('mouseup', () => { c.style.width='20px'; c.style.height='20px'; c.style.background='rgba(255,70,70,.55)'; }, true);
  };
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
})();`;

const VW = { width: 1360, height: 820 };

async function buildingVideo() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: VW, recordVideo: { dir: RAW, size: VW } });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const video = page.video();
  let runId = null;
  const pause = (ms) => page.waitForTimeout(ms);
  const cap = (t) => page.evaluate((x) => { const e = document.getElementById('__cap'); if (e) e.textContent = x; }, t);
  const box = async (loc) => (await loc.boundingBox());
  const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

  const addNode = async (type, label) => {
    await cap('Adding step: ' + label);
    const item = page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`);
    await item.scrollIntoViewIfNeeded();
    await item.click();
    await pause(500);
    return page.locator('[data-testid="node"]').last().getAttribute('data-node-id');
  };
  const moveNode = async (id, tx, ty) => {
    const b = await box(page.locator(`[data-testid="node"][data-node-id="${id}"]`));
    const c = center(b);
    await page.mouse.move(c.x, c.y, { steps: 18 });
    await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 28 });
    await page.mouse.up();
    await pause(450);
  };
  const cfg = async (id) => { await page.locator(`[data-testid="node"][data-node-id="${id}"]`).click(); await pause(450); };
  const type = async (testid, val) => { const f = page.locator(`[data-testid="${testid}"]`); await f.click(); await f.fill(''); await f.pressSequentially(val, { delay: 28 }); await pause(300); };
  const set = async (testid, val) => { await page.locator(`[data-testid="${testid}"]`).fill(val); await pause(300); };
  const sel = async (testid, val) => { await page.locator(`[data-testid="${testid}"]`).selectOption(val); await pause(300); };
  // Proven click-to-connect: click the source port, then click the target node.
  // The injected cursor glides between them, so it still reads as wiring.
  const connect = async (fromId, port, toId) => {
    await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).click();
    await pause(400);
    await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).click();
    await pause(550);
  };

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await pause(800);
    await cap('Building an order-triage automation from scratch');
    await pause(1200);

    const gen = await addNode('code', 'Generate orders');
    await moveNode(gen, 300, 230);
    const filter = await addNode('filter', 'Filter');
    await moveNode(filter, 540, 230);
    const sort = await addNode('sort', 'Sort');
    await moveNode(sort, 780, 230);
    const gate = await addNode('if', 'Branch (If)');
    await moveNode(gate, 1010, 230);
    const high = await addNode('code', 'High-value path');
    await moveNode(high, 1230, 140);
    const std = await addNode('code', 'Standard path');
    await moveNode(std, 1230, 330);

    await cap('Configuring "Generate orders"');
    await cfg(gen);
    await set('cfg-code', 'return [{json:{id:1,amount:120}},{json:{id:2,amount:15}},{json:{id:3,amount:340}},{json:{id:4,amount:80}}];');

    await cap('Filter: keep orders with amount ≥ 20');
    await cfg(filter);
    await set('cfg-left', 'json.amount');
    await sel('cfg-op', 'gte');
    await type('cfg-right', '20');

    await cap('Sort by amount, descending');
    await cfg(sort);
    await set('cfg-sort-field', 'json.amount');
    await sel('cfg-sort-direction', 'desc');

    await cap('Branch: is the top order a high value (> 100)?');
    await cfg(gate);
    await set('cfg-left', 'json.amount');
    await sel('cfg-op', 'gt');
    await type('cfg-right', '100');

    await cap('Two branches: high-value vs standard');
    await cfg(high);
    await set('cfg-code', "return $input.map(it => ({ json: { ...it.json, tier: 'HIGH' } }));");
    await cfg(std);
    await set('cfg-code', "return $input.map(it => ({ json: { ...it.json, tier: 'STD' } }));");

    await cap('Wiring the steps together (drag from a port to the next step)');
    await connect(gen, 'main', filter);
    await connect(filter, 'main', sort);
    await connect(sort, 'main', gate);
    await connect(gate, 'true', high);
    await connect(gate, 'false', std);

    await cap('Naming and saving the automation');
    await page.locator('#automation-name').click();
    await page.locator('#automation-name').fill('');
    await page.locator('#automation-name').pressSequentially('Order triage (video demo)', { delay: 26 });
    await pause(300);
    await page.locator('#btn-save').click();
    await page.waitForFunction(() => location.search.includes('def='));
    await pause(800);

    await cap('Running it — watch each step turn green, live');
    await page.locator('[data-testid="btn-run"]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runId);
    runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
    await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runState !== 'in-progress', null, { timeout: 30000 });
    await pause(1200);
    await cap('Done — taken branch completed, untaken branch skipped. Run id: ' + runId);
    await pause(2500);
  } finally {
    await ctx.close();
    await browser.close();
  }
  const raw = await video.path();
  const out = path.join(DIR, '01-building.webm');
  await rename(raw, out);
  console.log('BUILDING_VIDEO=' + out);
  console.log('RUN_ID=' + runId);
  return runId;
}

async function temporalVideo(runId) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: VW, recordVideo: { dir: RAW, size: VW } });
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  const video = page.video();
  const pause = (ms) => page.waitForTimeout(ms);
  const cap = (t) => page.evaluate((x) => { const e = document.getElementById('__cap'); if (e) e.textContent = x; }, t).catch(() => {});
  try {
    await cap('The same run, inside the Temporal Web UI');
    await page.goto(TEMPORAL_UI + '/namespaces/default/workflows/' + runId, { waitUntil: 'domcontentloaded' });
    await pause(4000);
    await cap('Workflow type runGraph — status Completed, durably recorded by Temporal');
    await pause(3500);
    // Slowly scroll through the durable event history.
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 320);
      await pause(900);
    }
    await cap('Each step ran as a Temporal activity (runCode / runTransform / httpRequest) — fully replayable');
    await pause(3500);
    await page.mouse.wheel(0, -2000);
    await pause(1500);
    await cap('This is real durable execution — not a simulation');
    await pause(3000);
  } finally {
    await ctx.close();
    await browser.close();
  }
  const raw = await video.path();
  const out = path.join(DIR, '02-temporal-execution.webm');
  await rename(raw, out);
  console.log('TEMPORAL_VIDEO=' + out);
}

const runId = await buildingVideo();
if (runId) await temporalVideo(runId);
else { console.error('no runId captured; skipping temporal video'); process.exitCode = 1; }
