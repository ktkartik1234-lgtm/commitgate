#!/usr/bin/env node
import { execSync } from "node:child_process";
import {
  getActiveSession,
  recordUntrackedCommit,
  recordVerificationAttempt,
} from "./db";
import { evaluateLatestCommit, formatVerificationReport } from "./verifier";

export function runPostCommitHook(repoRoot: string = process.cwd()): void {
  const activeSession = getActiveSession(repoRoot);

  if (!activeSession) {
    try {
      const commitSha = execSync("git rev-parse --short HEAD", {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
      const commitMessage = execSync("git log -1 --pretty=%s", {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
      recordUntrackedCommit(commitSha, commitMessage, repoRoot);
    } catch {
      // Ignore if Git metadata is unavailable
    }
    console.log("CommitGate: no active session. Commit ignored.");
    return;
  }

  const evaluation = evaluateLatestCommit(activeSession, repoRoot);
  const recorded = recordVerificationAttempt(
    {
      session: activeSession,
      commitSha: evaluation.commitSha,
      commitMessage: evaluation.commitMessage,
      passedAll: evaluation.passedAll,
      rules: evaluation.rules,
    },
    repoRoot
  );

  const report = formatVerificationReport({
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
