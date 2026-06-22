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
  return db;
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
