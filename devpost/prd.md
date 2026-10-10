---
doc: prd
status: approved
---

# CommitGate — Product Requirements

CommitGate (`commitgate`) is a local CLI, Git `post-commit` verification engine, and compact monospace HTML "Trusted Proxy" HUD widget for developers who want deterministic, zero-trust proof-of-work backed by SQLite rather than self-reported to-do lists or vibes-based AI validation.
Source: `scope.md > The Unique Kernel`, `scope.md > Who It's For`.

## The Core Journey
Source: `scope.md > The Core Loop`, `scope.md > What "Working" Looks Like`.

1. **Standby (Idle State):** The developer opens their local demo repository alongside the CommitGate HTML status widget. Before a focus block begins, the widget rests in an unobtrusive dark state reading: `"No active session. Awaiting focus block."`
2. **Start a Focus Session (`0:00–0:10`):** In the terminal, the developer starts a session with explicit deterministic rules:
   ```bash
   commitgate start \
     --task "Fix login validation" \
     --require "src/auth/**" \
     --test "npm test" \
     --token "CG-001"
   ```
   The CLI saves the session in `commitgate.db` as `PENDING` and prints the active rules. The HTML widget immediately switches to an amber (`#E5A54B`) `PENDING` badge, displaying the Session ID (`CG-001`), Task Name (`Fix login validation`), the 4-item rule checklist, and `"Listening for Git commit... Status: PENDING."`
3. **Attempt a Lazy / Fake Commit (`0:10–0:25`):** The developer attempts to cheat the loop with an unrelated noise change:
   ```bash
   echo "noise" >> notes.txt
   git add notes.txt
   git commit -m "CG-001 done"
   ```
   The Git `post-commit` hook fires automatically, records the attempt (`attempt: 1`), evaluates the deterministic rules, and prints a specific failure report (`[PASS] commit message contains token CG-001`, `[FAIL] required path modified`, `[FAIL] meaningful code change`, `[FAIL] tests passed`). The HTML widget updates to `REJECTED` (`#E5484D` red badge and left border), showing `"REJECTED — proof not accepted"`, the failed rule breakdown (`Expected: src/auth/** / Changed: notes.txt` and last 5 lines of failed test output), and `"Fix the failed rules and commit again."` Meanwhile, session `CG-001` remains open in SQLite awaiting a valid commit.
4. **Do the Real Work (`0:25–0:45`):** The developer updates `src/auth/validate.ts` with real validation logic, runs `npm test` to confirm tests pass, and commits with `"CG-001 Fix login validation"`.
5. **Automatic Verification & Closure (`0:45–1:00`):** The `post-commit` hook runs again. All four rules pass (`token`, `required path modified`, `meaningful code change`, `tests passed`). The terminal outputs `CommitGate verification passed` with a `verification_id`, and the HTML widget transitions to green (`#3FB950` `VERIFIED`), showing the diff summary (`src/auth/validate.ts +8 / -2`), `npm test passed`, and `"Session closed. Work proved."`

## Screens and Layout
Source: `scope.md > The Core Loop`, `scope.md > The POC Boundary`.

CommitGate has two interaction surfaces that operate side by side:

1. **Terminal CLI (`commitgate`) & Git Hook Output:**
   - Command-line interface for initializing the repo hook (`commitgate init`), starting a session (`commitgate start`), checking status (`commitgate status`), and canceling an active session (`commitgate cancel <token>`).
   - Automatic structured report printed directly in the terminal whenever `git commit` triggers the `post-commit` hook.
2. **Local HTML "Trusted Proxy" HUD Widget:**
   - A single, compact card (`320–380px` wide) designed to sit unobtrusively next to the code editor or terminal:
     ```text
     ┌────────────────────────────────────┐
     │ CommitGate        CG-001 | PENDING │
     │ Fix login validation               │
     ├────────────────────────────────────┤
     │ commit: abc1234                    │
     │ attempt: 2                         │
     │ last check: 14:02:11               │
     ├────────────────────────────────────┤
     │ [PASS] token in commit message     │
     │ [FAIL] required path modified      │
     │ [FAIL] meaningful code change      │
     │ [FAIL] tests passed                │
     ├────────────────────────────────────┤
     │ Fix required changes and commit    │
     │ again.                             │
     └────────────────────────────────────┘
     ```
   - Always displays (when a session is active): Project name (`CommitGate`), Session ID (`CG-001`), Task name, Current status badge (`PENDING`, `REJECTED`, or `VERIFIED`), Short commit SHA (once a commit attempt occurs), Attempt count, Timestamp of last check, Rule checklist, and a contextual footer line.

## Look and Feel
Source: `scope.md > Inspiration & Identity`.

- **Aesthetic & Archetype:** Compact monospace terminal HUD / flight recorder / mission-control panel. Calm, local, private proof-of-work monitor.
- **Typography:**
  - Primary font: `JetBrains Mono, SF Mono, ui-monospace, monospace` for session ID, commit SHA, file paths, rule results, and test output.
  - Clean sans-serif permitted only for tiny secondary labels if needed.
- **Color Palette (Dark, Dense, Local):**
  - Background: `#0A0C10`
  - Card background: `#11151D`
  - Border: `#232A36`
  - Primary text: `#D7DCE5`
  - Muted text: `#7C8698`
  - Status — Pending: `#E5A54B` (Amber)
  - Status — Rejected: `#E5484D` (Red)
  - Status — Verified: `#3FB950` (Green)
- **Strict Visual Non-Goals:** No gradients, no glassmorphism, no large rounded consumer-app cards, and no celebratory confetti on verification.

## Features and Behavior

### 1. Session Lifecycle & Guardrails (`commitgate start` & `commitgate cancel`)
Source: `scope.md > The Core Loop`.

- Starting a session requires `--task`, `--require`, `--test`, and `--token` (or auto-generates a token if omitted, though `--token "CG-001"` is explicitly supported).
- **Acceptance Criteria:**
  - [ ] Running `commitgate start --task "Fix login validation" --require "src/auth/**" --test "npm test" --token "CG-001"` creates an active session in `commitgate.db` with status `PENDING` and attempt count `0`.
  - [ ] If an active session already exists, running `commitgate start` without `--replace` refuses to overwrite it, prints the current active session details (`session`, `task`, `status`, `rules`), and shows the exact commands to cancel (`commitgate cancel <token>`) or replace (`commitgate start --replace`).
  - [ ] Running `commitgate start --replace ...` marks the prior active session as `SUPERSEDED` (or `CANCELED` via `commitgate cancel <token>`) in `commitgate.db` before creating the new session.

### 2. Automatic Git `post-commit` Hook & Deterministic Rule Engine
Source: `scope.md > The Unique Kernel`, `scope.md > The Core Loop`.

- When `git commit` runs in the repository, the local `post-commit` hook automatically invokes CommitGate verification against the active session.
- Four deterministic rules are evaluated in order:
  1. **Commit message contains token:** Commit message includes the session token (e.g., `CG-001`).
  2. **Required path modified:** At least one changed file in the commit matches the `--require` glob (e.g., `src/auth/**`).
  3. **Meaningful code change:** At least one matched file in `--require` contains non-whitespace added/modified lines (`non-whitespace lines changed > 0`).
  4. **Tests passed:** Running the `--test` shell command (e.g., `npm test`) exits with code `0`.
- **Acceptance Criteria:**
  - [ ] Every commit during an active session increments the session's `attempt` counter and records the short commit SHA, timestamp, per-rule pass/fail breakdown, diff stats, and test exit code/output in `commitgate.db`.
  - [ ] On a failed attempt, the terminal prints `CommitGate verification failed` with `session`, `task`, `commit`, `attempt`, `status: REJECTED`, each rule's `[PASS]`/`[FAIL]` status with concrete reason (`expected` vs. `changed` path, `no non-whitespace changes in required path`, or `exit` code + last 5 lines of test output), and notes that the session remains open for the next commit.
  - [ ] On a passing attempt, the terminal prints `CommitGate verification passed` with `status: VERIFIED`, per-rule details (`file`, `diff: +X / -Y`, `non-whitespace lines changed`, `exit: 0`), updates the session to `VERIFIED` in `commitgate.db`, and prints a deterministic `verification_id`.

### 3. Local HTML "Trusted Proxy" HUD Widget
Source: `scope.md > The Core Loop`, `scope.md > What "Working" Looks Like`.

- A local browser view that reflects the latest state in `commitgate.db` without manual page reloads.
- **Acceptance Criteria:**
  - [ ] **Idle / Standby State:** When no session is active, renders a dark card reading `"No active session. Awaiting focus block."`
  - [ ] **Pending State:** When a session starts (before any commit attempt), displays an `#E5A54B` amber status badge (`PENDING`), the Session ID, Task Name, the 4 verification rules waiting to be checked, and `"Listening for Git commit... Status: PENDING."`
  - [ ] **Rejected State:** When the latest commit attempt fails, displays a `#E5484D` red left border and `REJECTED` badge, `"REJECTED — proof not accepted"`, short commit SHA, attempt count, timestamp, failed rules expanded automatically (`Expected` vs. `Changed` paths and last 5 lines of failed test output in monospace), and footer `"Fix the failed rules and commit again."`
  - [ ] **Verified State:** When a commit passes all rules, displays a `#3FB950` green `VERIFIED` badge, `"VERIFIED — proof-of-work accepted"`, short commit SHA, all rules green, diff summary (`+X / -Y`), test pass confirmation, and footer `"Session closed. Work proved."`

## States and Boundaries
Source: `scope.md > The POC Boundary`.

- **Idle / Standby (No Active Session):** Displayed on first launch or after a session is canceled. Normal Git commits are never blocked; if a user commits while no session is active, the `post-commit` hook prints `CommitGate: no active session. Commit ignored.` and logs the commit as `UNTRACKED` in SQLite while the widget remains Idle.
- **Active — Pending (`PENDING`):** Session created in SQLite (`attempt: 0`), awaiting the first commit with the session token.
- **Active — Attempt Rejected (`REJECTED` attempt on open session):** The latest commit attempt failed one or more deterministic rules. The widget and terminal prominently display `REJECTED` for that commit attempt while the session itself stays open in SQLite so the developer can fix the code and commit again with the same token.
- **Closed — Verified (`VERIFIED`):** All four deterministic rules passed on a commit. The session is permanently marked `VERIFIED` with a `verification_id`. Subsequent commits after verification are treated as having no active session (`CommitGate: no active session. Commit ignored.`) until a new session is started.
- **Closed — Canceled / Superseded (`CANCELED` / `SUPERSEDED`):** Explicitly terminated via `commitgate cancel <token>` or `commitgate start --replace`. Preserved in SQLite history.
- **Persistence Boundary:** All session state, rules, and commit attempts persist locally in `commitgate.db` (SQLite) across terminal restarts and browser refreshes.

## Product Decisions
- **Deterministic 4-Rule Verification Over LLM Judgment:** Pass/fail is strictly computed from token presence, `--require` glob match, non-whitespace diff lines in matched files, and `--test` exit code `0`. LLMs never decide whether work counts.
- **Non-Whitespace Diff + Passing Tests Instead of Language-Specific Comment Parsing:** Full comment-only detection was explicitly deferred because comment syntax varies by language; requiring non-whitespace diff lines inside `--require` paths plus a passing test suite catches lazy/fake commits reliably in the MVP.
- **Non-Blocking `post-commit` Hook When Idle:** Normal Git workflows must never break when the user is not in a CommitGate focus session (`CommitGate: no active session. Commit ignored.`).
- **Explicit Session Replacement (`--replace` / `cancel`):** Running `commitgate start` while a session is active refuses to silently overwrite state, protecting SQLite audit history.
- **Attempt Rejection Keeps Session Open:** A `REJECTED` commit surfaces red in the HUD and terminal with specific failure diagnostics, while keeping the session active for the next commit attempt until `VERIFIED` or `CANCELED`.

## What We're Building
1. `commitgate` CLI (`init`, `start`, `status`, `cancel`, `verify-commit` hook runner, and local widget server/launcher).
2. Local SQLite database (`commitgate.db`) storing sessions, rules, and commit verification attempts.
3. Git `post-commit` hook installer and runner that formats the exact `REJECTED` / `VERIFIED` / `no active session` terminal reports.
4. Compact (`320–380px`) monospace HTML "Trusted Proxy" HUD widget (`#0A0C10` / `#11151D` theme) with live updates across `IDLE`, `PENDING`, `REJECTED`, and `VERIFIED`.
5. Self-contained demo workspace (`src/auth/validate.ts` + `src/auth/validate.test.ts` + `notes.txt`) so the 1-minute demo script runs cleanly out of the box.

## Deferred From the POC
- **Language-aware AST / comment-only diff detection:** Deferred because non-whitespace path diffs + passing test execution already catch fake commits without language-specific parsers.
- **Commits with missing token during an active session:** If a commit during an active session omits the token `CG-001`, the verifier records the attempt as `REJECTED` with `[FAIL] commit message contains token CG-001` so the developer gets immediate feedback rather than silent ignoring.

## Possible Later Enhancements
- LLM-generated post-verification feedback or coaching summaries layered after deterministic pass/fail.
- Browser extension that blocks non-essential tabs while a CommitGate session is `PENDING`/`REJECTED` and unlocks them on `VERIFIED`.
- YouTube tutorial active-recall checkpoint ("pause every 15m and prove what you learned").
- Email/recruiter "Trusted Proxy" background monitor.

## Non-Goals
- **Vibes-based AI grading of code diffs:** Violates the zero-trust deterministic kernel.
- **Cloud accounts, remote databases, or multi-page dashboards:** Violates the local-first, private, distraction-free HUD design.
- **Celebratory gamification (confetti, streaks, badges):** Violates the calm flight-recorder / mission-control tone.

## Open Questions
- None blocking `4-spec`. Technical choices (SQLite library, glob matching package, how the HTML widget polls or streams SQLite updates) will be decided in `4-spec`.
