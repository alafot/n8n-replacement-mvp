// Persistent store for workflow definitions (B10). Backed by SQLite on disk so
// definitions survive engine/process restarts. CRUD with full round-trip
// fidelity (the definition is stored verbatim as JSON).

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { GraphDefinition } from './graph';

export interface StoredDefinition {
  id: string;
  name: string;
  graph: GraphDefinition;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, 'definitions.db');

let db: Database.Database | null = null;

function handle(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS definitions (
      id    TEXT PRIMARY KEY,
      name  TEXT NOT NULL,
      graph TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id          TEXT PRIMARY KEY,
      automation_name TEXT NOT NULL,
      automation_id   TEXT,
      started_at      TEXT NOT NULL,
      finished_at     TEXT,
      status          TEXT NOT NULL,
      graph_json      TEXT,
      steps_json      TEXT
    )
  `);
  return db;
}

export type RunOutcome = 'running' | 'completed' | 'failed' | 'cancelled';

export interface RunRecord {
  runId: string;
  automationName: string;
  automationId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: RunOutcome;
  /** The graph definition that was run (so the run is re-runnable as it was). */
  graph: unknown | null;
  /** Persisted per-step detail (status/input/output/error), once recorded. */
  steps: unknown | null;
}

export function recordRunStart(rec: { runId: string; automationName: string; automationId?: string | null; startedAt: string; graph?: unknown }): void {
  handle()
    .prepare('INSERT OR REPLACE INTO runs (run_id, automation_name, automation_id, started_at, status, graph_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(rec.runId, rec.automationName, rec.automationId ?? null, rec.startedAt, 'running', rec.graph ? JSON.stringify(rec.graph) : null);
}

export function updateRunOutcome(runId: string, status: RunOutcome, finishedAt: string | null, steps?: unknown): void {
  if (steps !== undefined) {
    handle().prepare('UPDATE runs SET status = ?, finished_at = ?, steps_json = ? WHERE run_id = ?').run(status, finishedAt, JSON.stringify(steps), runId);
  } else {
    handle().prepare('UPDATE runs SET status = ?, finished_at = ? WHERE run_id = ?').run(status, finishedAt, runId);
  }
}

function rowToRun(r: any): RunRecord {
  return {
    runId: r.run_id,
    automationName: r.automation_name,
    automationId: r.automation_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    graph: r.graph_json ? JSON.parse(r.graph_json) : null,
    steps: r.steps_json ? JSON.parse(r.steps_json) : null,
  };
}

export function listRuns(): RunRecord[] {
  return (handle().prepare('SELECT * FROM runs ORDER BY started_at DESC').all() as any[]).map(rowToRun);
}

export function getRun(runId: string): RunRecord | null {
  const r = handle().prepare('SELECT * FROM runs WHERE run_id = ?').get(runId);
  return r ? rowToRun(r) : null;
}

export function createDefinition(id: string, name: string, graph: GraphDefinition): StoredDefinition {
  handle()
    .prepare('INSERT INTO definitions (id, name, graph) VALUES (?, ?, ?)')
    .run(id, name, JSON.stringify(graph));
  return { id, name, graph };
}

export function getDefinition(id: string): StoredDefinition | null {
  const row = handle().prepare('SELECT id, name, graph FROM definitions WHERE id = ?').get(id) as
    | { id: string; name: string; graph: string }
    | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, graph: JSON.parse(row.graph) };
}

export function listDefinitions(): Array<{ id: string; name: string }> {
  return handle().prepare('SELECT id, name FROM definitions ORDER BY id').all() as Array<{
    id: string;
    name: string;
  }>;
}

export function updateDefinition(id: string, name: string, graph: GraphDefinition): StoredDefinition | null {
  const res = handle()
    .prepare('UPDATE definitions SET name = ?, graph = ? WHERE id = ?')
    .run(name, JSON.stringify(graph), id);
  if (res.changes === 0) return null;
  return { id, name, graph };
}

export function deleteDefinition(id: string): boolean {
  return handle().prepare('DELETE FROM definitions WHERE id = ?').run(id).changes > 0;
}
