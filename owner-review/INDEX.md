# Owner review — overnight node-roadmap run (2026-06-22 night)

I (the interpreter) drove the remaining node roadmap autonomously while you slept. For each
iteration I built a small **sample workflow** that uses the node, ran it on the real engine,
and saved a screenshot of the **successful run** here for you to double-check.

- App to test live yourself: **http://127.0.0.1:3000/**
- Screenshots + sample-workflow notes are per-node below, files under `owner-review/<node>/`.
- Any judgement calls I had to make in your absence are logged under **Assumptions** per node.

## Roadmap progress

| # | Node | Status | Sample workflow | Screenshot |
|---|------|--------|-----------------|------------|
| UX | Palette redesign (categories, icons, tooltips) | ✅ satisfied | categorized palette + hover tooltip | `palette-redesign/palette-categories.png`, `palette-redesign/palette-tooltip-hover.png` |
| 3 | Merge | ✅ satisfied | 2 branches (A:2 items + B:1) → Merge(append) → sink | `merge/merge-success.png` |
| 4 | Loop Over Items | ✅ satisfied | seed(3 items) → Loop(batch 1) → body / done | `loop-over-items/loop-success.png` |
| 5 | Wait | ✅ satisfied | seed → Wait(2500ms) → sink; measured 2807ms pause | `wait/wait-pausing.png`, `wait/wait-success.png` |
| 6 | No Operation | _pending_ | — | — |
| 7 | Stop and Error | _pending_ | — | — |
| 8 | Execute Sub-workflow | _pending_ | — | — |
| 9 | Aggregate | _pending_ | — | — |
| 10 | Split Out | _pending_ | — | — |
| 11 | Sort | _pending_ | — | — |
| 12 | Limit | _pending_ | — | — |
| 13 | Remove Duplicates | _pending_ | — | — |
| 14 | Rename Keys | _pending_ | — | — |
| 15 | Date & Time | _pending_ | — | — |
| 16 | Summarize | _pending_ | — | — |
| 17 | Compare Datasets | _pending_ | — | — |
| 18 | Schedule (trigger) | _pending_ | — | — |
| 19 | Webhook (trigger) | _pending_ | — | — |
| 20 | Respond to Webhook | _pending_ | — | — |
| 21 | Form (trigger) | _pending_ | — | — |
| 22 | Error Trigger | _pending_ | — | — |

## Notes log

(Newest entries appended below as each iteration completes.)

### Palette redesign ✅
- Palette now grouped into n8n-style categories: **Actions / Transform / Flow / Code**, each with a heading.
- Each node is a compact icon button (🌐 web service, ✏️ reshape, ❓ branch, 🔀 switch, 🔎 filter, 💻 code).
- Hovering a node shows a tooltip with its name + description (verified: hovering "Route by rules" shows "Route each item to an output by rules (multi-way)").
- Click-to-add and drag-to-drop both still create the correct step type; no regression.
- Screenshots: `palette-redesign/palette-categories.png`, `palette-redesign/palette-tooltip-hover.png`. Demo: `palette-redesign/demo.mjs`.
- Assumptions: none.

### Node 3 — Merge ✅
- Sample workflow: two code branches (A produces 2 items, B produces 1 item) wired into a **Merge** step (mode: append), then a sink. Ran on the real engine; run **completed**.
- Verified: the Merge output contained all 3 items together — `{src:A,n:1}`, `{src:A,n:2}`, `{src:B,n:3}` — i.e. items from BOTH inputs appear on the single combined output. Screenshot shows the completed run with the merge inspector output.
- Screenshot: `merge/merge-success.png`. Demo: `merge/demo.mjs`.
- Assumptions: used the baseline "append" combine mode for the demo (the node also exposes a mode selector).

### Node 4 — Loop Over Items ✅
- Sample workflow: seed (3 items) → **Loop Over Items** (batch size 1); its loop output → a body step that marks each item `processed:true`; its done output → a done step. Ran on the real engine; run **completed**.
- Verified: the loop body ran **3 times** (once per item at batch size 1), every item reached the done path **exactly once** (ids 1,2,3, iterations 0,1,2), all `processed:true`, and the done path completed after the final batch. Screenshot shows the completed run with the done-path output.
- Screenshot: `loop-over-items/loop-success.png`. Demo: `loop-over-items/demo.mjs`.
- Assumptions: demoed at batch size 1 (the node also takes larger batch sizes → correspondingly fewer iterations, still every item once).

### Node 5 — Wait ✅
- Sample workflow: seed → **Wait** (2500 ms) → sink. Ran on the real engine.
- Verified: the run genuinely **paused** at the Wait — measured wall-time **2807 ms** for the configured 2500 ms (not instantaneous) — and the mid-run screenshot shows seed `completed`, Wait `running`, downstream `pending` while it pauses. Items passed through unchanged (`{token:X, n:7}` in == out). Run completed after the wait elapsed.
- Screenshots: `wait/wait-pausing.png` (the pause in action), `wait/wait-success.png` (completed). Demo: `wait/demo.mjs`.
- Assumptions: duration entered in milliseconds (the node's unit); demoed 2500 ms.
