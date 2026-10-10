#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPostCommitHook = runPostCommitHook;
const node_child_process_1 = require("node:child_process");
const db_1 = require("./db");
const verifier_1 = require("./verifier");
function runPostCommitHook(repoRoot = process.cwd()) {
    const activeSession = (0, db_1.getActiveSession)(repoRoot);
    if (!activeSession) {
        try {
            const commitSha = (0, node_child_process_1.execSync)("git rev-parse --short HEAD", {
                cwd: repoRoot,
                encoding: "utf8",
            }).trim();
            const commitMessage = (0, node_child_process_1.execSync)("git log -1 --pretty=%s", {
                cwd: repoRoot,
                encoding: "utf8",
            }).trim();
            (0, db_1.recordUntrackedCommit)(commitSha, commitMessage, repoRoot);
        }
        catch {
            // Ignore if Git metadata is unavailable
        }
        console.log("CommitGate: no active session. Commit ignored.");
        return;
    }
    const evaluation = (0, verifier_1.evaluateLatestCommit)(activeSession, repoRoot);
    const recorded = (0, db_1.recordVerificationAttempt)({
        session: activeSession,
        commitSha: evaluation.commitSha,
        commitMessage: evaluation.commitMessage,
        passedAll: evaluation.passedAll,
        rules: evaluation.rules,
    }, repoRoot);
    const report = (0, verifier_1.formatVerificationReport)({
        session: activeSession,
        commitSha: evaluation.commitSha,
        attemptNumber: recorded.attemptNumber,
        status: recorded.status,
        verificationId: recorded.verificationId,
        rules: evaluation.rules,
    });
    console.log("\n" + report + "\n");
}
if (require.main === module) {
    runPostCommitHook();
}
