// Step implementations run as Temporal activities (real-world side effects live
// here, outside the deterministic workflow). Iteration 0 has one step: the
// caller-configurable HTTP Request step (B2).

import * as vm from 'vm';
import { Items, Item, makeItem, BinaryDatum } from './itemFormat';

export interface HttpRequestInput {
  /** HTTP method; defaults to GET. */
  method?: string;
  /** Absolute target URL. */
  url: string;
  /** Optional request headers. */
  headers?: Record<string, string>;
  /** Optional request body (string). */
  body?: string;
}

/** Content types we represent as text (kept losslessly as a string in json.body). */
function isTextual(contentType: string): boolean {
  return (
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('javascript') ||
    contentType.includes('x-www-form-urlencoded')
  );
}

/**
 * HTTP Request step. Performs a REAL outbound request honouring the caller's
 * method/url/headers/body, then returns the response in the STANDARD item
 * format with the status surfaced so success vs failure is distinguishable.
 *
 * - A non-2xx response is NOT an error: it returns normally with ok=false and
 *   the statusCode, so callers can distinguish it from success (B2 E3).
 * - A network/connection error throws — surfacing as an activity/workflow
 *   failure rather than a fake "success".
 */
export async function httpRequest(input: HttpRequestInput): Promise<Items> {
  const method = (input.method ?? 'GET').toUpperCase();
  const res = await fetch(input.url, {
    method,
    headers: input.headers,
    body: input.body,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let body: unknown = null;
  const binary: Record<string, BinaryDatum> = {};

  if (contentType.includes('application/json')) {
    const text = await res.text();
    body = text.length ? JSON.parse(text) : null;
  } else if (isTextual(contentType) || contentType === '') {
    // text/HTML/etc. — kept losslessly as a string (B2 E4).
    body = await res.text();
  } else {
    // Truly binary payload — base64 into the binary slot without loss.
    const buf = Buffer.from(await res.arrayBuffer());
    binary.data = {
      data: buf.toString('base64'),
      mimeType: contentType,
      byteLength: buf.byteLength,
    };
    body = null;
  }

  // Status is surfaced inside the standard item so callers can tell success
  // (ok=true, 2xx) from failure (ok=false, non-2xx).
  return [
    makeItem(
      {
        statusCode: res.status,
        ok: res.ok,
        contentType,
        headers,
        body,
      },
      binary,
    ),
  ];
}

export interface CodeStepInput {
  /** JS body, executed with `$input` bound to the upstream items. Must return items. */
  code: string;
  /** The items received from the upstream node(s) — the data flowing in. */
  input: Items;
}

/**
 * Code/Transform step. Runs caller-supplied JavaScript over the items it
 * receives from upstream and returns new items in the standard format. This is
 * how a downstream node operates on the data produced by an upstream node.
 */
export async function runCode(args: CodeStepInput): Promise<Items> {
  // Run caller code in an ISOLATED vm context (B9): the sandbox exposes only
  // `$input` — no `require`, `process`, `global`, or filesystem — and a wall
  // clock timeout guards against runaway loops. Misbehaving code throws here,
  // failing the activity (and so the run) cleanly without touching the engine.
  const sandbox: Record<string, unknown> = {
    $input: JSON.parse(JSON.stringify(args.input)), // deep copy: code can't mutate engine state
  };
  const script = `(function($input){ ${args.code} })($input)`;
  const produced = vm.runInNewContext(script, sandbox, { timeout: 1000 });

  if (!Array.isArray(produced)) {
    throw new Error('code step must return an array of items');
  }

  // Normalise to the standard item format ({ json, binary }).
  return produced.map((it: any): Item => {
    const json = it && typeof it.json === 'object' && it.json !== null ? it.json : { value: it };
    const binary: Record<string, BinaryDatum> = it && typeof it.binary === 'object' && it.binary !== null ? it.binary : {};
    return makeItem(json, binary);
  });
}

export interface TransformConfig {
  /** Set literal new fields: { fieldName: value }. */
  set?: Record<string, unknown>;
  /** Copy/map values: { destField: "sourceField" } (source read from json). */
  copy?: Record<string, string>;
  /** Rename fields: { oldName: newName }. */
  rename?: Record<string, string>;
  /** Remove fields by name. */
  remove?: string[];
}

export interface TransformStepInput {
  config: TransformConfig;
  input: Items;
}

/**
 * Transform/Set step (B7). Reshapes each item's `json` per the config. Pure:
 * operates only on the items passing through, no external calls, deterministic.
 * Fields not referenced by the config are left intact (it edits a copy rather
 * than rebuilding the item from scratch).
 * Order: copy (reads originals) -> set -> rename -> remove.
 */
export async function runTransform(args: TransformStepInput): Promise<Items> {
  const { set, copy, rename, remove } = args.config;
  return args.input.map((item): Item => {
    const json: Record<string, unknown> = { ...item.json };

    if (copy) {
      for (const [dest, source] of Object.entries(copy)) {
        json[dest] = (item.json as Record<string, unknown>)[source];
      }
    }
    if (set) {
      for (const [field, value] of Object.entries(set)) {
        json[field] = value;
      }
    }
    if (rename) {
      for (const [oldName, newName] of Object.entries(rename)) {
        if (oldName in json) {
          json[newName] = json[oldName];
          delete json[oldName];
        }
      }
    }
    if (remove) {
      for (const field of remove) delete json[field];
    }

    return makeItem(json, { ...item.binary });
  });
}
