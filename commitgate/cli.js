#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("./db");
const verifier_1 = require("./verifier");
const hook_1 = require("./hook");
const server_1 = require("./server");
const node_http_1 = __importDefault(require("node:http"));
const node_child_process_1 = require("node:child_process");
function parseFlags(args) {
    const flags = {};
    const positionals = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
            const next = args[i + 1];
            if (next && !next.startsWith("--")) {
                flags[key] = next;
                i++;
            }
            else {
                flags[key] = true;
            }
        }
        else {
            positionals.push(arg);
        }
    }
    return { flags, positionals };
}
function writeHookShim(repoRoot) {
    const hooksDir = node_path_1.default.join(repoRoot, ".git", "hooks");
    node_fs_1.default.mkdirSync(hooksDir, { recursive: true });
    const hookPath = node_path_1.default.join(hooksDir, "post-commit");
    const localHookScript = node_path_1.default.join(repoRoot, "commitgate", "hook.js");
    const resolvedHookRef = node_fs_1.default.existsSync(localHookScript)
        ? "./commitgate/hook.js"
        : `"${node_path_1.default.resolve(__dirname, "hook.js").replace(/\\/g, "/")}"`;
    const hookContent = `#!/bin/sh\nnode --no-warnings ${resolvedHookRef}\n`;
    node_fs_1.default.writeFileSync(hookPath, hookContent, { encoding: "utf8", mode: 0o755 });
    return resolvedHookRef;
}
function ensureHookInstalled(repoRoot) {
    const hookPath = node_path_1.default.join(repoRoot, ".git", "hooks", "post-commit");
    if (!node_fs_1.default.existsSync(hookPath)) {
        writeHookShim(repoRoot);
    }
}
function isHudServerListening(port = 4321) {
    return new Promise((resolve) => {
        const req = node_http_1.default.get(`http://localhost:${port}/api/state`, { timeout: 250 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
            req.destroy();
            resolve(false);
        });
    });
}
async function ensureHudServerRunning(repoRoot, port = 4321) {
    const running = await isHudServerListening(port);
    if (running)
        return false;
    const cliEntry = node_path_1.default.resolve(__dirname, "cli.js");
    const child = (0, node_child_process_1.spawn)(process.execPath, ["--no-warnings", cliEntry, "serve", "--port", String(port)], {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore",
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 250));
    return true;
}
function cmdInit(repoRoot) {
    (0, db_1.getDb)(repoRoot);
    const resolvedHookRef = writeHookShim(repoRoot);
    console.log("CommitGate initialized");
    console.log("  database: commitgate.db (WAL mode)");
    console.log(`  hook:     .git/hooks/post-commit -> node ${resolvedHookRef}`);
}
async function cmdStart(args, repoRoot) {
    ensureHookInstalled(repoRoot);
    const hudAutoStarted = await ensureHudServerRunning(repoRoot, 4321);
    const { flags, positionals } = parseFlags(args);
    const active = (0, db_1.getActiveSession)(repoRoot);
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
        (0, db_1.markActiveSessionStatus)("SUPERSEDED", undefined, repoRoot);
    }
    const task = typeof flags.task === "string"
        ? flags.task
        : positionals[0] ?? "Fix login validation";
    const requireGlob = typeof flags.require === "string"
        ? flags.require
        : positionals[1] ?? "src/auth/**";
    const testCmd = typeof flags.test === "string"
        ? flags.test
        : positionals[2] ?? "npm test";
    const token = typeof flags.token === "string"
        ? flags.token
        : positionals[3] ?? "CG-001";
    const created = (0, db_1.createSession)({
        session_id: token,
        task,
        require_glob: requireGlob,
        test_cmd: testCmd,
    }, repoRoot);
    console.log("CommitGate session started\n");
    console.log(`session: ${created.session_id}`);
    console.log(`task:    ${created.task}`);
    console.log(`status:  ${created.status}`);
    console.log(`hud:     http://localhost:4321${hudAutoStarted ? " (auto-started)" : ""}`);
    console.log("rules:");
    console.log(`  - commit message must contain ${created.session_id}`);
    console.log(`  - must modify ${created.require_glob}`);
    console.log(`  - ${created.test_cmd} must pass`);
}
function cmdCancel(args, repoRoot) {
    const tokenArg = args.find((a) => !a.startsWith("--"));
    const active = (0, db_1.getActiveSession)(repoRoot);
    if (!active) {
        console.log("No active session. Awaiting focus block.");
        return;
    }
    if (tokenArg && tokenArg !== active.session_id) {
        console.log(`Active session is ${active.session_id} (not ${tokenArg}). Run: commitgate cancel ${active.session_id}`);
        process.exitCode = 1;
        return;
    }
    const canceled = (0, db_1.markActiveSessionStatus)("CANCELED", tokenArg, repoRoot);
    if (canceled) {
        console.log(`CommitGate session ${canceled.session_id} CANCELED.`);
    }
}
function cmdStatus(repoRoot) {
    const session = (0, db_1.getDisplaySession)(repoRoot);
    if (!session) {
        console.log("No active session. Awaiting focus block.");
        return;
    }
    const latestAttempt = (0, db_1.getLatestAttemptForSession)(session.session_id, repoRoot);
    if (latestAttempt && latestAttempt.rules_json) {
        const rules = JSON.parse(latestAttempt.rules_json);
        const report = (0, verifier_1.formatVerificationReport)({
            session,
            commitSha: latestAttempt.commit_sha,
            attemptNumber: latestAttempt.attempt_number,
            status: latestAttempt.status,
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
function cmdDemoReset(repoRoot) {
    const { execSync } = require("node:child_process");
    // Unwind any temporary CG-001 demo commits from HEAD so repeated demo runs work cleanly
    for (let i = 0; i < 10; i++) {
        try {
            const subject = execSync("git log -1 --pretty=%s", {
                cwd: repoRoot,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            }).trim();
            if (/^CG-001\b/i.test(subject)) {
                execSync("git reset --soft HEAD~1", {
                    cwd: repoRoot,
                    stdio: "ignore",
                });
            }
            else {
                break;
            }
        }
        catch {
            break;
        }
    }
    (0, db_1.resetDatabase)(repoRoot);
    try {
        execSync("git checkout HEAD -- src/auth/validate.ts notes.txt", {
            cwd: repoRoot,
            stdio: "ignore",
        });
    }
    catch {
        const validatePath = node_path_1.default.join(repoRoot, "src", "auth", "validate.ts");
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
        node_fs_1.default.writeFileSync(validatePath, initialValidate, "utf8");
        node_fs_1.default.writeFileSync(node_path_1.default.join(repoRoot, "notes.txt"), "# Scratch Notes\nInitial project notes.\n", "utf8");
    }
    console.log("CommitGate demo reset to Standby (IDLE).");
    console.log("  - commitgate.db cleared");
    console.log("  - temporary CG-001 demo commits unwound from HEAD");
    console.log("  - src/auth/validate.ts reset to initial failing test state");
    console.log("  - notes.txt reset");
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function cmdDemo(repoRoot) {
    const { execSync } = await Promise.resolve().then(() => __importStar(require("node:child_process")));
    ensureHookInstalled(repoRoot);
    await ensureHudServerRunning(repoRoot, 4321);
    console.log("=== [0:00] Step 1: Resetting to Standby (IDLE) ===");
    cmdDemoReset(repoRoot);
    await sleep(2500);
    console.log("\n=== [0:10] Step 2: Starting Focus Session CG-001 (PENDING) ===");
    await cmdStart([
        "--task",
        "Fix login validation",
        "--require",
        "src/auth/**",
        "--test",
        "npm test",
        "--token",
        "CG-001",
    ], repoRoot);
    await sleep(3500);
    console.log("\n=== [0:20] Step 3: Attempting Fake/Noise Commit on notes.txt (REJECTED) ===");
    node_fs_1.default.appendFileSync(node_path_1.default.join(repoRoot, "notes.txt"), "noise\n", "utf8");
    execSync('git add notes.txt && git commit -m "CG-001 done"', {
        cwd: repoRoot,
        stdio: "inherit",
    });
    await sleep(4500);
    console.log("\n=== [0:35] Step 4: Fixing src/auth/validate.ts & Committing (VERIFIED) ===");
    const validatePath = node_path_1.default.join(repoRoot, "src", "auth", "validate.ts");
    const fixedValidate = `/**
 * Demo target module for CommitGate proof-of-work verification.
 * Task: Fix login validation so valid credentials return true.
 */
export function validateLogin(email: string, password: string): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail.includes("@") || password.length < 8) {
    return false;
  }
  // Valid credentials pass verification:
  return true;
}
`;
    node_fs_1.default.writeFileSync(validatePath, fixedValidate, "utf8");
    execSync('git add src/auth/validate.ts && git commit -m "CG-001 Fix login validation"', {
        cwd: repoRoot,
        stdio: "inherit",
    });
}
async function main() {
    const repoRoot = process.cwd();
    const [, , subcommand, ...rest] = process.argv;
    switch (subcommand) {
        case "init":
            cmdInit(repoRoot);
            break;
        case "start":
            await cmdStart(rest, repoRoot);
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
        case "demo":
            await cmdDemo(repoRoot);
            break;
        case "serve": {
            const { flags } = parseFlags(rest);
            const port = typeof flags.port === "string" ? parseInt(flags.port, 10) : 4321;
            (0, server_1.startHudServer)(Number.isNaN(port) ? 4321 : port, repoRoot);
            break;
        }
        case "verify-commit":
            (0, hook_1.runPostCommitHook)(repoRoot);
            break;
        default:
            console.log("Usage: commitgate <start|status|cancel|demo|demo-reset|init|serve> [options]");
            console.log('Quick start: commitgate start "Fix login validation" "src/auth/**"');
            break;
    }
}
main();
