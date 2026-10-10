#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  createSession,
  getActiveSession,
  getDisplaySession,
  getDb,
  getLatestAttemptForSession,
  markActiveSessionStatus,
  resetDatabase,
  RuleBreakdown,
} from "./db";
import { formatVerificationReport } from "./verifier";
import { runPostCommitHook } from "./hook";
import { startHudServer } from "./server";

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function cmdInit(repoRoot: string): void {
  getDb(repoRoot);
  const hooksDir = path.join(repoRoot, ".git", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, "post-commit");
  const hookContent = `#!/bin/sh\nnode --no-warnings ./commitgate/hook.js\n`;
  fs.writeFileSync(hookPath, hookContent, { encoding: "utf8", mode: 0o755 });
  console.log("CommitGate initialized");
  console.log("  database: commitgate.db (WAL mode)");
  console.log("  hook:     .git/hooks/post-commit -> node ./commitgate/hook.js");
}

function cmdStart(args: string[], repoRoot: string): void {
  const flags = parseFlags(args);
  const active = getActiveSession(repoRoot);
  const replace = Boolean(flags.replace);

  if (active && !replace) {
    console.log("CommitGate session already active\n");
    console.log(`session: ${active.session_id}`);
    console.log(`task:    ${active.task}`);
    console.log(`status:  ${active.status}`);
    console.log("rules:");
    console.log(`  - commit message must contain ${active.session_id}`);
    console.log(`  - must modify ${active.require_glob}`);
    console.log(`  - ${active.test_cmd} must pass\n`);
    console.log("To cancel it:");
    console.log(`  commitgate cancel ${active.session_id}\n`);
    console.log("To replace it:");
    console.log("  commitgate start --replace ...");
    process.exitCode = 1;
    return;
  }

  if (active && replace) {
    markActiveSessionStatus("SUPERSEDED", undefined, repoRoot);
  }

  const task =
    typeof flags.task === "string" ? flags.task : "Fix login validation";
  const requireGlob =
    typeof flags.require === "string" ? flags.require : "src/auth/**";
  const testCmd = typeof flags.test === "string" ? flags.test : "npm test";
  const token = typeof flags.token === "string" ? flags.token : "CG-001";

  const created = createSession(
    {
      session_id: token,
      task,
      require_glob: requireGlob,
      test_cmd: testCmd,
    },
    repoRoot
  );

  console.log("CommitGate session started\n");
  console.log(`session: ${created.session_id}`);
  console.log(`task:    ${created.task}`);
  console.log(`status:  ${created.status}`);
  console.log("rules:");
  console.log(`  - commit message must contain ${created.session_id}`);
  console.log(`  - must modify ${created.require_glob}`);
  console.log(`  - ${created.test_cmd} must pass`);
}

function cmdCancel(args: string[], repoRoot: string): void {
  const tokenArg = args.find((a) => !a.startsWith("--"));
  const active = getActiveSession(repoRoot);
  if (!active) {
    console.log("No active session. Awaiting focus block.");
    return;
  }
  if (tokenArg && tokenArg !== active.session_id) {
    console.log(
      `Active session is ${active.session_id} (not ${tokenArg}). Run: commitgate cancel ${active.session_id}`
    );
    process.exitCode = 1;
    return;
  }
  const canceled = markActiveSessionStatus("CANCELED", tokenArg, repoRoot);
  if (canceled) {
    console.log(`CommitGate session ${canceled.session_id} CANCELED.`);
  }
}

function cmdStatus(repoRoot: string): void {
  const session = getDisplaySession(repoRoot);
  if (!session) {
    console.log("No active session. Awaiting focus block.");
    return;
  }

  const latestAttempt = getLatestAttemptForSession(
    session.session_id,
    repoRoot
  );

  if (latestAttempt && latestAttempt.rules_json) {
    const rules = JSON.parse(latestAttempt.rules_json) as RuleBreakdown;
    const report = formatVerificationReport({
      session,
      commitSha: latestAttempt.commit_sha,
      attemptNumber: latestAttempt.attempt_number,
      status: latestAttempt.status as "REJECTED" | "VERIFIED",
      verificationId: session.verification_id,
      rules,
    });
    console.log(report);
    return;
  }

  console.log("CommitGate active session\n");
  console.log(`session: ${session.session_id}`);
  console.log(`task:    ${session.task}`);
  console.log(`attempt: ${session.attempt_count}`);
  console.log(`status:  ${session.status}`);
  console.log("rules:");
  console.log(`  [WAIT] commit message contains token ${session.session_id}`);
  console.log(`  [WAIT] required path modified (${session.require_glob})`);
  console.log(`  [WAIT] meaningful code change (non-whitespace)`);
  console.log(`  [WAIT] tests passed (${session.test_cmd})`);
}

function cmdDemoReset(repoRoot: string): void {
  resetDatabase(repoRoot);
  const validatePath = path.join(repoRoot, "src", "auth", "validate.ts");
  const initialValidate = `/**
 * Demo target module for CommitGate proof-of-work verification.
 * Task: Fix login validation so valid credentials return true.
 */
export function validateLogin(email: string, password: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@") || password.length < 8) {
    return false;
  }
  // Intentional bug for the 0:10-0:25 demo step (returns false instead of true):
  return false;
}
`;
  fs.writeFileSync(validatePath, initialValidate, "utf8");
  fs.writeFileSync(
    path.join(repoRoot, "notes.txt"),
    "# Scratch Notes\nInitial project notes.\n",
    "utf8"
  );
  console.log("CommitGate demo reset to Standby (IDLE).");
  console.log("  - commitgate.db cleared");
  console.log("  - src/auth/validate.ts reset to initial failing test state");
  console.log("  - notes.txt reset");
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const [, , subcommand, ...rest] = process.argv;

  switch (subcommand) {
    case "init":
      cmdInit(repoRoot);
      break;
    case "start":
      cmdStart(rest, repoRoot);
      break;
    case "cancel":
      cmdCancel(rest, repoRoot);
      break;
    case "status":
      cmdStatus(repoRoot);
      break;
    case "demo-reset":
      cmdDemoReset(repoRoot);
      break;
    case "serve": {
      const flags = parseFlags(rest);
      const port =
        typeof flags.port === "string" ? parseInt(flags.port, 10) : 4321;
      startHudServer(Number.isNaN(port) ? 4321 : port, repoRoot);
      break;
    }
    case "verify-commit":
      runPostCommitHook(repoRoot);
      break;
    default:
      console.log(
        "Usage: commitgate <init|start|status|cancel|demo-reset|serve> [options]"
      );
      break;
  }
}

main();
