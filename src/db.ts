import path from "node:path";
import crypto from "node:crypto";

export type SessionStatus = "PENDING" | "VERIFIED" | "CANCELED" | "SUPERSEDED";
export type AttemptStatus = "REJECTED" | "VERIFIED" | "UNTRACKED";

export interface RuleBreakdown {
  tokenMatch: {
    passed: boolean;
    token: string;
  };
  requiredPath: {
    passed: boolean;
    expected: string;
    changedFiles: string[];
    matchedFiles: string[];
    diffSummary: string;
  };
  meaningfulChange: {
    passed: boolean;
    nonWhitespaceLinesChanged: number;
    reason?: string;
  };
  testsPassed: {
    passed: boolean;
    command: string;
    exitCode: number;
    outputSnippet: string[];
  };
}

export interface SessionRow {
  session_id: string;
  task: string;
  require_glob: string;
  test_cmd: string;
  status: SessionStatus;
  attempt_count: number;
  verification_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommitAttemptRow {
  id: number;
  session_id: string | null;
  attempt_number: number;
  commit_sha: string;
  commit_message: string;
  status: AttemptStatus;
  rules_json: string | null;
  created_at: string;
}

interface SyncStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SyncDatabase {
  exec(sql: string): void;
  prepare(sql: string): SyncStatement;
}

let dbInstance: SyncDatabase | null = null;

export function getDbPath(repoRoot: string = process.cwd()): string {
  return path.join(repoRoot, "commitgate.db");
}

function openDatabase(dbFile: string): SyncDatabase {
  try {
    // Primary: better-sqlite3 as specified in 4-spec
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BetterSqlite3 = require("better-sqlite3");
    return new BetterSqlite3(dbFile) as SyncDatabase;
  } catch {
    // Fallback: Node 24 built-in synchronous node:sqlite (DatabaseSync)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(dbFile) as SyncDatabase;
  }
}

export function getDb(repoRoot: string = process.cwd()): SyncDatabase {
  if (!dbInstance) {
    const dbPath = getDbPath(repoRoot);
    dbInstance = openDatabase(dbPath);
    dbInstance.exec("PRAGMA journal_mode = WAL;");
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        require_glob TEXT NOT NULL,
        test_cmd TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        verification_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS commit_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        attempt_number INTEGER NOT NULL,
        commit_sha TEXT NOT NULL,
        commit_message TEXT NOT NULL,
        status TEXT NOT NULL,
        rules_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }
  return dbInstance;
}

export function formatTimeHMS(date: Date = new Date()): string {
  return date.toTimeString().split(" ")[0];
}

export function getActiveSession(repoRoot?: string): SessionRow | null {
  const db = getDb(repoRoot);
  const row = db
    .prepare(
      `SELECT * FROM sessions WHERE status = 'PENDING' ORDER BY updated_at DESC LIMIT 1`
    )
    .get() as SessionRow | undefined;
  return row ?? null;
}

export function getDisplaySession(repoRoot?: string): SessionRow | null {
  const active = getActiveSession(repoRoot);
  if (active) return active;
  const db = getDb(repoRoot);
  const latest = db
    .prepare(
      `SELECT * FROM sessions WHERE status IN ('PENDING', 'VERIFIED') ORDER BY updated_at DESC LIMIT 1`
    )
    .get() as SessionRow | undefined;
  return latest ?? null;
}

export function getLatestAttemptForSession(
  sessionId: string,
  repoRoot?: string
): CommitAttemptRow | null {
  const db = getDb(repoRoot);
  const row = db
    .prepare(
      `SELECT * FROM commit_attempts WHERE session_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(sessionId) as CommitAttemptRow | undefined;
  return row ?? null;
}

export function createSession(
  params: {
    session_id: string;
    task: string;
    require_glob: string;
    test_cmd: string;
  },
  repoRoot?: string
): SessionRow {
  const db = getDb(repoRoot);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO sessions (
      session_id, task, require_glob, test_cmd, status, attempt_count, verification_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?)`
  ).run(
    params.session_id,
    params.task,
    params.require_glob,
    params.test_cmd,
    now,
    now
  );

  return getActiveSession(repoRoot)!;
}

export function markActiveSessionStatus(
  newStatus: "CANCELED" | "SUPERSEDED",
  token?: string,
  repoRoot?: string
): SessionRow | null {
  const active = getActiveSession(repoRoot);
  if (!active) return null;
  if (token && active.session_id !== token) {
    return null;
  }
  const db = getDb(repoRoot);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?`
  ).run(newStatus, now, active.session_id);
  return { ...active, status: newStatus, updated_at: now };
}

export function recordVerificationAttempt(
  params: {
    session: SessionRow;
    commitSha: string;
    commitMessage: string;
    passedAll: boolean;
    rules: RuleBreakdown;
  },
  repoRoot?: string
): {
  attemptNumber: number;
  status: "REJECTED" | "VERIFIED";
  verificationId: string | null;
  timestamp: string;
} {
  const db = getDb(repoRoot);
  const attemptNumber = params.session.attempt_count + 1;
  const attemptStatus: "REJECTED" | "VERIFIED" = params.passedAll
    ? "VERIFIED"
    : "REJECTED";
  const nowIso = new Date().toISOString();
  const timeHms = formatTimeHMS(new Date());

  const verificationId = params.passedAll
    ? crypto
        .createHash("sha256")
        .update(`${params.session.session_id}:${params.commitSha}:${nowIso}`)
        .digest("hex")
        .slice(0, 7)
    : null;

  db.prepare(
    `INSERT INTO commit_attempts (
      session_id, attempt_number, commit_sha, commit_message, status, rules_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.session.session_id,
    attemptNumber,
    params.commitSha,
    params.commitMessage,
    attemptStatus,
    JSON.stringify(params.rules),
    timeHms
  );

  const nextSessionStatus: SessionStatus = params.passedAll
    ? "VERIFIED"
    : "PENDING";

  db.prepare(
    `UPDATE sessions
     SET attempt_count = ?, status = ?, verification_id = ?, updated_at = ?
     WHERE session_id = ?`
  ).run(
    attemptNumber,
    nextSessionStatus,
    verificationId,
    nowIso,
    params.session.session_id
  );

  return {
    attemptNumber,
    status: attemptStatus,
    verificationId,
    timestamp: timeHms,
  };
}

export function recordUntrackedCommit(
  commitSha: string,
  commitMessage: string,
  repoRoot?: string
): void {
  const db = getDb(repoRoot);
  const timeHms = formatTimeHMS(new Date());
  db.prepare(
    `INSERT INTO commit_attempts (
      session_id, attempt_number, commit_sha, commit_message, status, rules_json, created_at
    ) VALUES (NULL, 0, ?, ?, 'UNTRACKED', NULL, ?)`
  ).run(commitSha, commitMessage, timeHms);
}

export function getStateDigest(repoRoot?: string): string {
  const db = getDb(repoRoot);
  const dvRow = db.prepare("PRAGMA data_version").get() as
    | { data_version?: number }
    | undefined;
  const session = getDisplaySession(repoRoot);
  const latestAttempt = session
    ? getLatestAttemptForSession(session.session_id, repoRoot)
    : null;
  return `${dvRow?.data_version ?? 0}:${session?.session_id ?? "none"}:${
    session?.status ?? "IDLE"
  }:${session?.attempt_count ?? 0}:${latestAttempt?.id ?? 0}`;
}

export function resetDatabase(repoRoot?: string): void {
  const db = getDb(repoRoot);
  db.exec(`
    DELETE FROM commit_attempts;
    DELETE FROM sessions;
  `);
}
