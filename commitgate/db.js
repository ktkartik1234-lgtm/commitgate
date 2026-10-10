"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDbPath = getDbPath;
exports.getDb = getDb;
exports.formatTimeHMS = formatTimeHMS;
exports.getActiveSession = getActiveSession;
exports.getDisplaySession = getDisplaySession;
exports.getLatestAttemptForSession = getLatestAttemptForSession;
exports.createSession = createSession;
exports.markActiveSessionStatus = markActiveSessionStatus;
exports.recordVerificationAttempt = recordVerificationAttempt;
exports.recordUntrackedCommit = recordUntrackedCommit;
exports.getStateDigest = getStateDigest;
exports.resetDatabase = resetDatabase;
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
let dbInstance = null;
function getDbPath(repoRoot = process.cwd()) {
    return node_path_1.default.join(repoRoot, "commitgate.db");
}
function openDatabase(dbFile) {
    try {
        // Primary: better-sqlite3 as specified in 4-spec
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const BetterSqlite3 = require("better-sqlite3");
        return new BetterSqlite3(dbFile);
    }
    catch {
        // Fallback: Node 24 built-in synchronous node:sqlite (DatabaseSync)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = require("node:sqlite");
        return new DatabaseSync(dbFile);
    }
}
function getDb(repoRoot = process.cwd()) {
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
function formatTimeHMS(date = new Date()) {
    return date.toTimeString().split(" ")[0];
}
function getActiveSession(repoRoot) {
    const db = getDb(repoRoot);
    const row = db
        .prepare(`SELECT * FROM sessions WHERE status = 'PENDING' ORDER BY updated_at DESC LIMIT 1`)
        .get();
    return row ?? null;
}
function getDisplaySession(repoRoot) {
    const active = getActiveSession(repoRoot);
    if (active)
        return active;
    const db = getDb(repoRoot);
    const latest = db
        .prepare(`SELECT * FROM sessions WHERE status IN ('PENDING', 'VERIFIED') ORDER BY updated_at DESC LIMIT 1`)
        .get();
    return latest ?? null;
}
function getLatestAttemptForSession(sessionId, repoRoot) {
    const db = getDb(repoRoot);
    const row = db
        .prepare(`SELECT * FROM commit_attempts WHERE session_id = ? ORDER BY id DESC LIMIT 1`)
        .get(sessionId);
    return row ?? null;
}
function createSession(params, repoRoot) {
    const db = getDb(repoRoot);
    const now = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO sessions (
      session_id, task, require_glob, test_cmd, status, attempt_count, verification_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'PENDING', 0, NULL, ?, ?)`).run(params.session_id, params.task, params.require_glob, params.test_cmd, now, now);
    return getActiveSession(repoRoot);
}
function markActiveSessionStatus(newStatus, token, repoRoot) {
    const active = getActiveSession(repoRoot);
    if (!active)
        return null;
    if (token && active.session_id !== token) {
        return null;
    }
    const db = getDb(repoRoot);
    const now = new Date().toISOString();
    db.prepare(`UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?`).run(newStatus, now, active.session_id);
    return { ...active, status: newStatus, updated_at: now };
}
function recordVerificationAttempt(params, repoRoot) {
    const db = getDb(repoRoot);
    const attemptNumber = params.session.attempt_count + 1;
    const attemptStatus = params.passedAll
        ? "VERIFIED"
        : "REJECTED";
    const nowIso = new Date().toISOString();
    const timeHms = formatTimeHMS(new Date());
    const verificationId = params.passedAll
        ? node_crypto_1.default
            .createHash("sha256")
            .update(`${params.session.session_id}:${params.commitSha}:${nowIso}`)
            .digest("hex")
            .slice(0, 7)
        : null;
    db.prepare(`INSERT INTO commit_attempts (
      session_id, attempt_number, commit_sha, commit_message, status, rules_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(params.session.session_id, attemptNumber, params.commitSha, params.commitMessage, attemptStatus, JSON.stringify(params.rules), timeHms);
    const nextSessionStatus = params.passedAll
        ? "VERIFIED"
        : "PENDING";
    db.prepare(`UPDATE sessions
     SET attempt_count = ?, status = ?, verification_id = ?, updated_at = ?
     WHERE session_id = ?`).run(attemptNumber, nextSessionStatus, verificationId, nowIso, params.session.session_id);
    return {
        attemptNumber,
        status: attemptStatus,
        verificationId,
        timestamp: timeHms,
    };
}
function recordUntrackedCommit(commitSha, commitMessage, repoRoot) {
    const db = getDb(repoRoot);
    const timeHms = formatTimeHMS(new Date());
    db.prepare(`INSERT INTO commit_attempts (
      session_id, attempt_number, commit_sha, commit_message, status, rules_json, created_at
    ) VALUES (NULL, 0, ?, ?, 'UNTRACKED', NULL, ?)`).run(commitSha, commitMessage, timeHms);
}
function getStateDigest(repoRoot) {
    const db = getDb(repoRoot);
    const dvRow = db.prepare("PRAGMA data_version").get();
    const session = getDisplaySession(repoRoot);
    const latestAttempt = session
        ? getLatestAttemptForSession(session.session_id, repoRoot)
        : null;
    return `${dvRow?.data_version ?? 0}:${session?.session_id ?? "none"}:${session?.status ?? "IDLE"}:${session?.attempt_count ?? 0}:${latestAttempt?.id ?? 0}`;
}
function resetDatabase(repoRoot) {
    const db = getDb(repoRoot);
    db.exec(`
    DELETE FROM commit_attempts;
    DELETE FROM sessions;
  `);
}
