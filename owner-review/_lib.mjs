// Shared helpers for owner-review demo workflows: build a small sample workflow
// using a node, run it on the real engine, and screenshot the successful run.
// Drives the real builder UI at CANVAS_URL with Chrome (same approach as e2e/*.mjs).
import { chromium } from 'playwright';
import * as path from 'path';

export const URL = process.env.CANVAS_URL ?? 'http://127.0.0.1:3000/';

export async function openBuilder() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  await page.goto(URL, { waitUntil: 'networkidle' });

  const api = {
    page,
    browser,
    addNode: async (type) => {
      await page.locator(`[data-testid="palette-item"][data-step-type="${type}"]`).click();
      return page.locator('[data-testid="node"]').last().getAttribute('data-node-id');
    },
    connect: async (fromId, port, toId) => {
      await page.locator(`[data-testid="port"][data-node-id="${fromId}"][data-port="${port}"]`).click();
      await page.locator(`[data-testid="node"][data-node-id="${toId}"]`).click();
    },
    cfg: (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).click(),
    fill: (testid, value) => page.locator(`[data-testid="${testid}"]`).fill(value),
    select: (testid, value) => page.locator(`[data-testid="${testid}"]`).selectOption(value),
    status: (id) => page.locator(`[data-testid="node"][data-node-id="${id}"]`).getAttribute('data-step-status'),
    run: async () => {
      await page.locator('[data-testid="btn-run"]').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="run-status"]').dataset.runId);
      const runId = await page.locator('[data-testid="run-status"]').getAttribute('data-run-id');
      await page.waitForFunction(
        () => document.querySelector('[data-testid="run-status"]').dataset.runState !== 'in-progress',
        null, { timeout: 30000 });
      return runId;
    },
    engineSteps: (runId) => page.evaluate((id) => fetch('/runs/' + id + '/steps').then((r) => r.json()), runId),
    shot: (name) => page.screenshot({ path: path.join(path.dirname(new URL(import.meta.url).pathname), name) }),
    shotTo: (abs) => page.screenshot({ path: abs }),
    close: () => browser.close(),
  };
  return api;
}
