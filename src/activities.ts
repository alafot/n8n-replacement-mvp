// Step implementations run as Temporal activities (real-world side effects live
// here, outside the deterministic workflow). Iteration 0 has one step: the
// caller-configurable HTTP Request step (B2).

import * as vm from 'vm';
import { Items, Item, makeItem, BinaryDatum } from './itemFormat';
import { getPath } from './graph';

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

// ---- HTML Extract step (B55) -------------------------------------------------
// Pull values out of an HTML string by CSS selector — either the matched
// element's text or one of its named attributes — into named output fields.

export interface HtmlExtractRule {
  /** CSS selector locating the element (e.g. 'h1', 'a.cta', '#price'). */
  selector: string;
  /** 'text' = the element's text content; 'attribute' = a named attribute. */
  returnType?: 'text' | 'attribute';
  /** Attribute name to read when returnType is 'attribute' (e.g. 'href'). */
  attribute?: string;
  /** Field name to write the extracted value into on each item's json. */
  output: string;
}

export interface HtmlExtractInput {
  /** Dot-path to the HTML string on each item (e.g. 'json.body'). */
  htmlField: string;
  /** One or more extraction rules, each producing one output field. */
  rules: HtmlExtractRule[];
  /** The items received from upstream. */
  input: Items;
}

// --- Genuine (compact) HTML parser + CSS selector engine ---------------------
interface ElNode { type: 'el'; tag: string; attribs: Record<string, string>; children: DomNode[]; }
interface TextNode { type: 'text'; text: string; }
type DomNode = ElNode | TextNode;

// Elements that never have a closing tag (so they don't nest the following content).
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, d) => { try { return String.fromCodePoint(Number(d)); } catch { return _m; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _m; } })
    .replace(/&amp;/g, '&');
}

function parseTag(inner: string): { tag: string; attribs: Record<string, string> } {
  const m = inner.match(/^\s*([a-zA-Z][\w:-]*)/);
  const tag = (m ? m[1] : '').toLowerCase();
  const attribs: Record<string, string> = {};
  const rest = inner.slice(m ? m[0].length : 0);
  const re = /([^\s=\/]+)(\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(rest))) {
    if (!a[1]) break;
    const name = a[1].toLowerCase();
    let val = '';
    if (a[2] !== undefined) {
      val = a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : (a[6] ?? '');
    }
    attribs[name] = decodeEntities(val);
  }
  return { tag, attribs };
}

function parseHtml(html: string): ElNode {
  const root: ElNode = { type: 'el', tag: '#root', attribs: {}, children: [] };
  const stack: ElNode[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { top().children.push({ type: 'text', text: html.slice(i) }); break; }
    if (lt > i) top().children.push({ type: 'text', text: html.slice(i, lt) });
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt + 4); i = end === -1 ? n : end + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const end = html.indexOf('>', lt); i = end === -1 ? n : end + 1; continue; }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end === -1 ? n : end).trim().toLowerCase();
      for (let s = stack.length - 1; s >= 1; s--) { if (stack[s].tag === name) { stack.length = s; break; } }
      i = end === -1 ? n : end + 1;
      continue;
    }
    const end = html.indexOf('>', lt);
    if (end === -1) { top().children.push({ type: 'text', text: html.slice(lt) }); break; }
    let inner = html.slice(lt + 1, end);
    let selfClose = false;
    if (inner.endsWith('/')) { selfClose = true; inner = inner.slice(0, -1); }
    const { tag, attribs } = parseTag(inner);
    const el: ElNode = { type: 'el', tag, attribs, children: [] };
    top().children.push(el);
    if (!selfClose && !VOID_ELEMENTS.has(tag) && tag) stack.push(el);
    i = end + 1;
  }
  return root;
}

interface Compound { tag?: string; ids: string[]; classes: string[]; attrs: { name: string; value?: string }[]; }

function parseCompound(s: string): Compound {
  const c: Compound = { ids: [], classes: [], attrs: [] };
  const tagM = s.match(/^([a-zA-Z][\w:-]*|\*)/);
  let rest = s;
  if (tagM) { if (tagM[1] !== '*') c.tag = tagM[1].toLowerCase(); rest = s.slice(tagM[0].length); }
  const re = /([.#][^.#\[\]]+)|(\[[^\]]*\])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    const tok = m[0];
    if (tok[0] === '.') c.classes.push(tok.slice(1));
    else if (tok[0] === '#') c.ids.push(tok.slice(1));
    else {
      const innerTok = tok.slice(1, -1);
      const eq = innerTok.indexOf('=');
      if (eq === -1) c.attrs.push({ name: innerTok.trim().toLowerCase() });
      else {
        let v = innerTok.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        c.attrs.push({ name: innerTok.slice(0, eq).trim().toLowerCase(), value: v });
      }
    }
  }
  return c;
}

function classListOf(el: ElNode): string[] {
  return (el.attribs['class'] ?? '').split(/\s+/).filter(Boolean);
}

function matchCompound(el: ElNode, c: Compound): boolean {
  if (c.tag && el.tag !== c.tag) return false;
  if (c.ids.length && !c.ids.every((id) => el.attribs['id'] === id)) return false;
  if (c.classes.length) { const cls = classListOf(el); if (!c.classes.every((k) => cls.includes(k))) return false; }
  for (const a of c.attrs) {
    if (!(a.name in el.attribs)) return false;
    if (a.value !== undefined && el.attribs[a.name] !== a.value) return false;
  }
  return true;
}

// Descendant-combinator match: the element (path tail) matches the last
// compound, and each earlier compound matches some ancestor, in order.
function matchPath(path: ElNode[], compounds: Compound[]): boolean {
  let ci = compounds.length - 1;
  let pi = path.length - 1;
  if (ci < 0) return false;
  if (!matchCompound(path[pi], compounds[ci])) return false;
  ci--; pi--;
  while (ci >= 0) {
    let found = false;
    while (pi >= 0) {
      if (matchCompound(path[pi], compounds[ci])) { found = true; pi--; break; }
      pi--;
    }
    if (!found) return false;
    ci--;
  }
  return true;
}

// First element (document order) matching the CSS selector (comma = selector list).
function querySelectorFirst(root: ElNode, selector: string): ElNode | null {
  const groups = selector.split(',').map((g) => g.trim()).filter(Boolean).map((g) => g.split(/\s+/).filter(Boolean).map(parseCompound));
  if (!groups.length) return null;
  const path: ElNode[] = [];
  let result: ElNode | null = null;
  const visit = (node: ElNode) => {
    for (const child of node.children) {
      if (result) return;
      if (child.type !== 'el') continue;
      path.push(child);
      if (groups.some((cs) => matchPath(path, cs))) { result = child; path.pop(); return; }
      visit(child);
      path.pop();
    }
  };
  visit(root);
  return result;
}

function textOf(el: ElNode): string {
  let out = '';
  const walk = (node: DomNode) => {
    if (node.type === 'text') out += node.text;
    else for (const ch of node.children) walk(ch);
  };
  for (const ch of el.children) walk(ch);
  return decodeEntities(out).trim();
}

/**
 * HTML Extract step (B55). For each item, locate its source HTML string, apply
 * each CSS-selector rule (element text or a named attribute), and write the
 * result into the configured output field. Other fields are preserved (it edits
 * a copy of the item's json). Pure and deterministic.
 */
export async function extractHtml(args: HtmlExtractInput): Promise<Items> {
  const rules = Array.isArray(args.rules) ? args.rules : [];
  return args.input.map((item): Item => {
    const raw = getPath(item, args.htmlField);
    const html = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
    const dom = parseHtml(html);
    const json: Record<string, unknown> = { ...item.json };
    for (const rule of rules) {
      if (!rule || !rule.output) continue;
      const el = querySelectorFirst(dom, String(rule.selector ?? ''));
      let val: string | null = null;
      if (el) {
        if (rule.returnType === 'attribute') {
          const attr = String(rule.attribute ?? '').toLowerCase();
          val = attr in el.attribs ? el.attribs[attr] : null;
        } else {
          val = textOf(el);
        }
      }
      json[rule.output] = val;
    }
    return makeItem(json, { ...item.binary });
  });
}
