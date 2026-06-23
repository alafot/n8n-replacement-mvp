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
| 6 | No Operation | ✅ satisfied | seed([3,1,1,2] unsorted+dup) → No-Op → sink | `no-operation/noop-success.png` |
| 7 | Stop and Error | ✅ satisfied | reached→FAIL w/ message (downstream skipped); not-reached→completes | `stop-and-error/stop-error-failed.png`, `stop-and-error/stop-error-not-reached.png` |
| 8 | Execute Sub-workflow | ✅ satisfied | save "Doubler" sub; parent seed(5)→ExecuteSub→sink ⇒ 10 | `execute-sub-workflow/execute-sub-success.png` |
| 9 | Aggregate | ✅ satisfied | seed(amount 10,20,30) → Aggregate ⇒ one item {amounts:[10,20,30]} | `aggregate/aggregate-success.png` |
| 10 | Split Out | ✅ satisfied | seed{tags:[a,b,c]} → Split Out ⇒ 3 items (a/b/c) | `split-out/split-out-success.png` |
| 11 | Sort | ✅ satisfied | seed[3,1,2,1] → Sort(asc) ⇒ [1,1,2,3] | `sort/sort-success.png` |
| 12 | Limit | ✅ satisfied | seed(5 items) → Limit(max 2, first) ⇒ [1,2] | `limit/limit-success.png` |
| 13 | Remove Duplicates | ✅ satisfied | seed ids[1,2,2,3,1] → Remove Dups ⇒ [1,2,3] | `remove-duplicates/remove-duplicates-success.png` |
| 14 | Rename Keys | ✅ satisfied | {first,qty,city} → Rename ⇒ {name,quantity,city} | `rename-keys/rename-keys-success.png` |
| 15 | Date & Time | ✅ satisfied | seed{date:2026-01-01} → add 1 day ⇒ 2026-01-02 | `date-and-time/date-and-time-success.png` |
| 16 | Summarize | ✅ satisfied | seed[A:10,B:5,A:7] → sum group by cat ⇒ A=17,B=5 | `summarize/summarize-success.png` |
| 17 | Compare Datasets | ✅ satisfied | A[1,2,3] vs B[2,3,4] ⇒ matched[2,3]/onlyA[1]/onlyB[4] | `compare-datasets/compare-datasets-success.png` |
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

### Node 6 — No Operation ✅
- Sample workflow: seed (deliberately unsorted + with a duplicate: ids `[3,1,1,2]`) → **No Operation** → sink. Ran on the real engine; run **completed**.
- Verified: the No-Op output was identical to its input and the downstream step received the same items unchanged — `[3,1,1,2]` with order and the duplicate preserved (nothing reordered/deduped/added/removed). Screenshot shows the completed run with the No-Op inspector output.
- Screenshot: `no-operation/noop-success.png`. Demo: `no-operation/demo.mjs`.
- Assumptions: none (the node has no configuration).

### Node 7 — Stop and Error ✅
- Two sample scenarios on the real engine:
  - **Reached:** seed → **Stop and Error** ("Halt: invalid record") → sink. Run ended **failed** carrying the exact message (shown in the run status bar + inspector); downstream sink stayed `pending` (did not run).
  - **Not reached:** seed(value 5) → IF(value>100) → [true] Stop and Error / [false] sink. False branch taken → run **completed** normally, Stop and Error `skipped`, no spurious failure.
- Screenshots: `stop-and-error/stop-error-failed.png`, `stop-and-error/stop-error-not-reached.png`. Demo: `stop-and-error/demo.mjs`.
- Assumptions: none. (Note: for this node a *failed* run is the correct/successful outcome — that's the node doing its job.)

### Node 8 — Execute Sub-workflow ✅ (completes the FLOW group)
- Sample: saved a sub-workflow **"Doubler (review demo)"** (a code step that doubles `value`). Then built a parent: seed(`value:5`) → **Execute Sub-workflow** (selected Doubler from the dropdown) → sink. Ran on the real engine; run **completed**.
- Verified: the parent's downstream received **`value: 10`** (5 doubled) — proving the referenced separate automation genuinely ran and its result flowed back into the parent (not a stub). Screenshot shows the completed parent run with the doubled value.
- Screenshot: `execute-sub-workflow/execute-sub-success.png`. Demo: `execute-sub-workflow/demo.mjs`.
- Assumptions: created my own "Doubler (review demo)" definition to call (left saved in the store for your inspection).

---
**FLOW group complete** (nodes 1–8: Switch, Filter, Merge, Loop Over Items, Wait, No Operation, Stop and Error, Execute Sub-workflow). Proceeding to the DATA group (9–17).

### Node 9 — Aggregate ✅
- Sample: seed (3 items, `amount` 10/20/30) → **Aggregate** (field `json.amount` → output `amounts`) → sink. Ran on the real engine; run **completed**.
- Verified: the 3 items collapsed into **exactly one** output item `{amounts:[10,20,30]}` — every input value present, none missing/invented — and downstream received that single aggregated item.
- Screenshot: `aggregate/aggregate-success.png`. Demo: `aggregate/demo.mjs`.
- Assumptions: aggregated a single numeric field (`amount`) into a list; the node also supports choosing the output field name (used `amounts`).

### Node 10 — Split Out ✅
- Sample: seed (one item `{tags:['a','b','c']}`) → **Split Out** (field `json.tags` → output `tag`) → sink. Ran on the real engine; run **completed**.
- Verified: the single item expanded into **3 items** `{tag:a}/{tag:b}/{tag:c}` — one element per item, in order, none missing/duplicated — and downstream received all 3. True inverse of Aggregate.
- Screenshot: `split-out/split-out-success.png`. Demo: `split-out/demo.mjs`.
- Assumptions: split a string list (`tags`) placing each element on field `tag`.

### Node 11 — Sort ✅
- Sample: seed (`value` = `[3,1,2,1]`) → **Sort** (field `json.value`, Ascending) → sink. Ran on the real engine; run **completed**.
- Verified: items emerged ascending `[1,1,2,3]` — same set and count preserved including the duplicate, nothing dropped/added — and downstream received all 4 in sorted order. (Examiner also confirmed Descending → `[3,2,1,1]`.)
- Screenshot: `sort/sort-success.png`. Demo: `sort/demo.mjs`.
- Assumptions: demoed ascending on a numeric field; direction selector also offers descending.

### Node 12 — Limit ✅
- Sample: seed (5 items, `n` 1..5) → **Limit** (max 2, keep first) → sink. Ran on the real engine; run **completed**.
- Verified: only **2** items continued downstream — the first two (`n:1, n:2`) in order. (Examiner also confirmed keep-last keeps the last 2, and that fewer-than-N items all pass through unchanged.)
- Screenshot: `limit/limit-success.png`. Demo: `limit/demo.mjs`.
- Assumptions: demoed keep-first with max 2; the node also offers keep-last.

### Node 13 — Remove Duplicates ✅
- Sample: seed (ids `[1,2,2,3,1]`) → **Remove Duplicates** (compare: by key field `json.id`) → sink. Ran on the real engine; run **completed**.
- Verified: only distinct items continued — `[1,2,3]`, first occurrence kept in original order — and downstream received the 3 de-duplicated items. (Examiner also confirmed whole-item compare and the no-duplicates pass-through case.)
- Screenshot: `remove-duplicates/remove-duplicates-success.png`. Demo: `remove-duplicates/demo.mjs`.
- Assumptions: demoed by-key-field on `id`; the node also offers whole-item comparison.

### Node 14 — Rename Keys ✅
- Sample: seed (`{first:'Ada', qty:3, city:'London'}`) → **Rename Keys** (`first→name`, `qty→quantity`) → sink. Ran on the real engine; run **completed**.
- Verified: output `{name:'Ada', quantity:3, city:'London'}` — old keys gone, new keys present with the same values, multiple mappings applied together, and the unreferenced field `city` left untouched.
- Screenshot: `rename-keys/rename-keys-success.png`. Demo: `rename-keys/demo.mjs`.
- Assumptions: mappings entered as JSON (`{"old":"new"}`), the node's config format.

### Node 15 — Date & Time ✅
- Sample: seed (`{date:'2026-01-01', label:'newyear'}`) → **Date & Time** (operation: add, 1 day, → `result`) → sink. Ran on the real engine; run **completed**.
- Verified (known input → expected output): `result` = `2026-01-02` (returned as ISO `2026-01-02T00:00:00.000Z`) — Jan 1 + 1 day correctly computed — with the original `date` and `label` preserved. (Examiner also confirmed the format operation: `2026-01-01` as DD/MM/YYYY → `01/01/2026`.)
- Screenshot: `date-and-time/date-and-time-success.png`. Demo: `date-and-time/demo.mjs`.
- Assumptions: demoed the add operation; the node also offers subtract and format. (Note: add/subtract return a full ISO timestamp; the format operation returns a plain formatted string.)

### Node 16 — Summarize ✅
- Sample: seed (`[{cat:A,amt:10},{cat:B,amt:5},{cat:A,amt:7}]`) → **Summarize** (function sum, field `json.amt`, group by `json.cat`, → `total`) → sink. Ran on the real engine; run **completed**.
- Verified (known input → expected): grouped sum produced `[{cat:A,total:17},{cat:B,total:5}]` (10+7=17, 5). (Examiner also confirmed ungrouped sum=22 and grouped count A=2,B=1.)
- Screenshot: `summarize/summarize-success.png`. Demo: `summarize/demo.mjs`.
- Assumptions: demoed grouped sum; the node also offers count/avg/min/max and ungrouped totals.

### Node 17 — Compare Datasets ✅ (completes the DATA group)
- Sample: dataset A (`ids [1,2,3]`) and dataset B (`ids [2,3,4]`) → **Compare Datasets** (two inputs A/B, key `json.id`, three outputs) → three sinks. Ran on the real engine; run **completed**.
- Verified (known input → expected): matched = `[2,3]`, only-in-A = `[1]`, only-in-B = `[4]`, each on its own output consumed by a separate downstream. (Examiner also confirmed swapping which dataset feeds A/B swaps only-in-A/only-in-B — a genuine two-input comparison.)
- Screenshot: `compare-datasets/compare-datasets-success.png` (the matched sink showing ids 2,3 selected). Demo: `compare-datasets/demo.mjs`.
- Assumptions: matched on `id`; demoed the three-output categorisation.

---
**DATA group complete** (nodes 9–17: Aggregate, Split Out, Sort, Limit, Remove Duplicates, Rename Keys, Date & Time, Summarize, Compare Datasets). Only the TRIGGER group (18–22) remains.

> **⚠️ Decision flagged for your review (triggers):** The original roadmap (seq 244) deferred the *trigger execution model* — "reuse the existing run model vs. design-first" — until the trigger phase. Since you're asleep and authorised finishing all node types, I'm proceeding by specifying each trigger's **capability and configuration** and leaving the *execution mechanism* (whether a trigger fires fully live — a real timer/HTTP listener — vs. is a configured trigger node you start, as fits a spike) to the implementer, requiring the trigger-specific behaviour to be real and demonstrable. Please confirm/redirect this in the morning if you wanted a specific trigger model.
