import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import { RuleBreakdown, SessionRow } from "./db";

function toPosixPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Matches a normalized POSIX path against a glob pattern like `src/auth/**` or `src/*.ts`.
 */
export function matchesRequireGlob(filePath: string, pattern: string): boolean {
  const normFile = toPosixPath(filePath);
  const normPattern = toPosixPath(pattern);

  // Built-in path.matchesGlob is available in Node 22+/24
  if (typeof (path.posix as { matchesGlob?: (p: string, g: string) => boolean }).matchesGlob === "function") {
    if (normPattern.endsWith("/**")) {
      const prefix = normPattern.slice(0, -3);
      if (normFile === prefix || normFile.startsWith(prefix + "/")) {
        return true;
      }
    }
    return (path.posix as unknown as { matchesGlob: (p: string, g: string) => boolean }).matchesGlob(
      normFile,
      normPattern
    );
  }

  // Deterministic regex fallback for globs
  const regexStr =
    "^" +
    normPattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "<<<GLOBSTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<GLOBSTAR>>>/g, ".*") +
    "$";
  return new RegExp(regexStr).test(normFile);
}

export interface CommitVerificationResult {
  commitSha: string;
  commitMessage: string;
  passedAll: boolean;
  rules: RuleBreakdown;
}

export function evaluateLatestCommit(
  session: SessionRow,
  repoRoot: string = process.cwd()
): CommitVerificationResult {
  const commitSha = execSync("git rev-parse --short HEAD", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  const commitMessage = execSync("git log -1 --pretty=%B", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  // Rule 1: Commit message contains token
  const tokenPassed = commitMessage.includes(session.session_id);

  // Rule 2: Required path modified
  const rawFiles = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean)
    .map(toPosixPath);

  const matchedFiles = rawFiles.filter((file) =>
    matchesRequireGlob(file, session.require_glob)
  );
  const pathPassed = matchedFiles.length > 0;

  // Compute diff summary (+X / -Y) and non-whitespace lines changed for matched files
  let totalAdded = 0;
  let totalRemoved = 0;
  let nonWhitespaceLinesChanged = 0;

  if (matchedFiles.length > 0) {
    const quotedFiles = matchedFiles.map((f) => `"${f}"`).join(" ");
    const numstatOut = execSync(
      `git show --numstat --format= HEAD -- ${quotedFiles}`,
      { cwd: repoRoot, encoding: "utf8" }
    ).trim();

    for (const line of numstatOut.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const add = parseInt(parts[0], 10);
        const del = parseInt(parts[1], 10);
        if (!Number.isNaN(add)) totalAdded += add;
        if (!Number.isNaN(del)) totalRemoved += del;
      }
    }

    const unifiedDiff = execSync(
      `git show --format= --unified=0 HEAD -- ${quotedFiles}`,
      { cwd: repoRoot, encoding: "utf8" }
    );

    for (const line of unifiedDiff.split(/\r?\n/)) {
      if (
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---"))
      ) {
        const content = line.slice(1).trim();
        if (content.length > 0) {
          nonWhitespaceLinesChanged += 1;
        }
      }
    }
  }

  const primaryMatchedFile = matchedFiles[0] ?? "";
  const diffSummary =
    matchedFiles.length > 0
      ? `${primaryMatchedFile} (+${totalAdded} / -${totalRemoved})`
      : "none";

  // Rule 3: Meaningful code change (non-whitespace lines > 0 in required path)
  const meaningfulPassed = pathPassed && nonWhitespaceLinesChanged > 0;

  // Rule 4: Tests passed
  const testRun = spawnSync(session.test_cmd, {
    cwd: repoRoot,
    shell: true,
    encoding: "utf8",
  });

  const exitCode = testRun.status ?? 1;
  const testsPassed = exitCode === 0;
  const combinedOutput = `${testRun.stdout ?? ""}\n${testRun.stderr ?? ""}`
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  const outputSnippet = combinedOutput.slice(-5);

  const rules: RuleBreakdown = {
    tokenMatch: {
      passed: tokenPassed,
      token: session.session_id,
    },
    requiredPath: {
      passed: pathPassed,
      expected: session.require_glob,
      changedFiles: rawFiles,
      matchedFiles,
      diffSummary: `+${totalAdded} / -${totalRemoved}`,
    },
    meaningfulChange: {
      passed: meaningfulPassed,
      nonWhitespaceLinesChanged,
      reason: meaningfulPassed
        ? undefined
        : "no non-whitespace changes in required path",
    },
    testsPassed: {
      passed: testsPassed,
      command: session.test_cmd,
      exitCode,
      outputSnippet,
    },
  };

  const passedAll =
    tokenPassed && pathPassed && meaningfulPassed && testsPassed;

  return {
    commitSha,
    commitMessage,
    passedAll,
    rules,
  };
}

export function formatVerificationReport(params: {
  session: SessionRow;
  commitSha: string;
  attemptNumber: number;
  status: "REJECTED" | "VERIFIED";
  verificationId: string | null;
  rules: RuleBreakdown;
}): string {
  const { session, commitSha, attemptNumber, status, verificationId, rules } =
    params;
  const lines: string[] = [];

  if (status === "REJECTED") {
    lines.push("CommitGate verification failed");
    lines.push("");
    lines.push(`session: ${session.session_id}`);
    lines.push(`task:    ${session.task}`);
    lines.push(`commit:  ${commitSha}`);
    lines.push(`attempt: ${attemptNumber}`);
    lines.push(`status:  REJECTED`);
    lines.push("");
    lines.push("RULES");

    // Rule 1
    lines.push(
      `[${rules.tokenMatch.passed ? "PASS" : "FAIL"}] commit message contains token ${session.session_id}`
    );

    // Rule 2
    if (rules.requiredPath.passed) {
      lines.push(`[PASS] required path modified`);
      lines.push(`       file: ${rules.requiredPath.matchedFiles.join(", ")}`);
      lines.push(`       diff: ${rules.requiredPath.diffSummary}`);
    } else {
      lines.push(`[FAIL] required path modified`);
      lines.push(`       expected: ${rules.requiredPath.expected}`);
      lines.push(
        `       changed:  ${
          rules.requiredPath.changedFiles.length > 0
            ? rules.requiredPath.changedFiles.join(", ")
            : "(none)"
        }`
      );
    }

    // Rule 3
    if (rules.meaningfulChange.passed) {
      lines.push(`[PASS] meaningful code change`);
      lines.push(
        `       non-whitespace lines changed: ${rules.meaningfulChange.nonWhitespaceLinesChanged}`
      );
    } else {
      lines.push(`[FAIL] meaningful code change`);
      lines.push(`       reason:   ${rules.meaningfulChange.reason}`);
    }

    // Rule 4
    if (rules.testsPassed.passed) {
      lines.push(`[PASS] tests passed`);
      lines.push(`       command: ${rules.testsPassed.command}`);
      lines.push(`       exit: 0`);
    } else {
      lines.push(`[FAIL] tests passed`);
      lines.push(`       command:  ${rules.testsPassed.command}`);
      lines.push(`       exit:     ${rules.testsPassed.exitCode}`);
      if (rules.testsPassed.outputSnippet.length > 0) {
        lines.push(`       output:`);
        for (const outLine of rules.testsPassed.outputSnippet) {
          lines.push(`         ${outLine}`);
        }
      }
    }

    lines.push("");
    lines.push("state: commitgate.db updated");
    lines.push(`session ${session.session_id} remains PENDING`);
    lines.push(
      `next: fix required changes and commit again with ${session.session_id}`
    );
  } else {
    lines.push("CommitGate verification passed");
    lines.push("");
    lines.push(`session: ${session.session_id}`);
    lines.push(`task:    ${session.task}`);
    lines.push(`commit:  ${commitSha}`);
    lines.push(`attempt: ${attemptNumber}`);
    lines.push(`status:  VERIFIED`);
    lines.push("");
    lines.push("RULES");
    lines.push(
      `[PASS] commit message contains token ${session.session_id}`
    );
    lines.push(`[PASS] required path modified`);
    lines.push(`       file: ${rules.requiredPath.matchedFiles.join(", ")}`);
    lines.push(`       diff: ${rules.requiredPath.diffSummary}`);
    lines.push(`[PASS] meaningful code change`);
    lines.push(
      `       non-whitespace lines changed: ${rules.meaningfulChange.nonWhitespaceLinesChanged}`
    );
    lines.push(`[PASS] tests passed`);
    lines.push(`       command: ${rules.testsPassed.command}`);
    lines.push(`       exit: 0`);
    lines.push("");
    lines.push("state: commitgate.db updated");
    lines.push(`session ${session.session_id} is now VERIFIED`);
    lines.push(`proof: verification_id ${verificationId}`);
  }

  return lines.join("\n");
}
