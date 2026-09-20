import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { JevDecision } from "../types";

let db: Database | null = null;

const DB_PATH = "./data/decision-cache.db";

function ensureDir(): void {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function initializeDecisionCache(): void {
  ensureDir();
  db = new Database(DB_PATH);

  db.run(`
    CREATE TABLE IF NOT EXISTS jev_decisions (
      state_hash TEXT PRIMARY KEY,
      decision_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function hashState(stateString: string): string {
  return Bun.hash(stateString).toString(16);
}

export function getDecision(stateString: string): JevDecision | null {
  if (!db) return null;
  const hash = hashState(stateString);
  const row = db
    .query("SELECT decision_json FROM jev_decisions WHERE state_hash = ?")
    .get(hash) as { decision_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.decision_json) as JevDecision;
}

export function setDecision(stateString: string, decision: JevDecision): void {
  if (!db) return;
  const hash = hashState(stateString);
  db.run(
    "INSERT OR REPLACE INTO jev_decisions (state_hash, decision_json, created_at) VALUES (?, ?, ?)",
    [hash, JSON.stringify(decision), new Date().toISOString()],
  );
}

export function hasDecision(stateString: string): boolean {
  if (!db) return false;
  const hash = hashState(stateString);
  const row = db
    .query("SELECT 1 FROM jev_decisions WHERE state_hash = ?")
    .get(hash);
  return row !== undefined;
}

export function getCacheSize(): number {
  if (!db) return 0;
  const row = db.query("SELECT COUNT(*) as cnt FROM jev_decisions").get() as {
    cnt: number;
  };
  return row.cnt;
}

export function clearDecisionCache(): void {
  if (!db) return;
  db.run("DELETE FROM jev_decisions");
}

export function exportAllDecisions(): Map<string, JevDecision> {
  const map = new Map<string, JevDecision>();
  if (!db) return map;
  const rows = db
    .query("SELECT state_hash, decision_json FROM jev_decisions")
    .all() as { state_hash: string; decision_json: string }[];
  for (const row of rows) {
    map.set(row.state_hash, JSON.parse(row.decision_json) as JevDecision);
  }
  return map;
}

export function importAllDecisions(entries: Map<string, JevDecision>): void {
  if (!db) return;
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO jev_decisions (state_hash, decision_json, created_at) VALUES (?, ?, ?)",
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const [hash, decision] of entries) {
      stmt.run(hash, JSON.stringify(decision), now);
    }
  })();
}

export function closeDecisionCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}
