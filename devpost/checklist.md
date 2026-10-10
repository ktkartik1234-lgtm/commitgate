---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast

## Slices

- [ ] **1. Start a focus session and verify commits end-to-end via the Git `post-commit` hook**
  Becomes usable: You can initialize CommitGate (`commitgate init`), start a session (`commitgate start --task "Fix login validation" --require "src/auth/**" --test "npm test" --token "CG-001"`), make a fake commit (`notes.txt`) that the `post-commit` hook automatically catches and marks `REJECTED` in SQLite, and make a real commit (`src/auth/validate.ts`) that passes all 4 deterministic rules and flips the session to `VERIFIED` in SQLite.
  Why now: Puts `scope.md > The Unique Kernel` (automatic `post-commit` hook + SQLite persistence + 4-rule deterministic verifier) first, proving the highest-risk cross-platform Git hook and test runner integration immediately.
  PRD ref: `prd.md > The Core Journey` (steps 2–5), `prd.md > Features and Behavior > 1. Session Lifecycle & Guardrails`, `prd.md > Features and Behavior > 2. Automatic Git post-commit Hook & Deterministic Rule Engine`
  Spec ref: `spec.md > Components > 1. SQLite State Store (src/db.ts)`, `spec.md > Components > 2. CLI Controller (src/cli.ts)`, `spec.md > Components > 3. Git post-commit Hook & Deterministic Verifier (src/hook.ts & src/verifier.ts)`, `spec.md > Components > 5. Demo Target & Test Suite (src/auth/validate.ts, src/auth/validate.test.ts, notes.txt)`, `spec.md > Data Model`, `spec.md > File Structure`
  Build: Bootstrap `package.json` and `tsconfig.json`, implement the SQLite state store (`src/db.ts`), the 4-rule deterministic verifier (`src/verifier.ts`), the Git `post-commit` hook entrypoint (`src/hook.ts` → `commitgate/hook.js`), the core CLI commands (`init`, `start`, `status`), and the demo target (`src/auth/validate.ts`, `src/auth/validate.test.ts`, `notes.txt`).
  Verify (mechanical): Compile TypeScript to `./commitgate/`, run `node ./commitgate/cli.js init` and `start`, create a commit touching `notes.txt` and verify stdout shows `CommitGate verification failed` with `status: REJECTED` and the 3 failed rules, then fix `src/auth/validate.ts`, commit with `CG-001`, and verify stdout shows `CommitGate verification passed` with `status: VERIFIED` and a `verification_id`.
  Learner check: Run `commitgate status` and inspect the terminal output for the rejected and verified commits to confirm the 4-rule breakdown matches your expected format.
  Commit: `Implement CLI session start, post-commit hook, and 4-rule SQLite verifier`

- [ ] **2. Protect active sessions and ignore untracked idle commits**
  Becomes usable: Committing when no session is active prints `CommitGate: no active session. Commit ignored.` without blocking Git (recording `UNTRACKED` in SQLite), and running `commitgate start` while a session is already `PENDING` refuses to overwrite it unless `--replace` or `commitgate cancel <token>` is used, plus `commitgate demo-reset` resets the demo target files cleanly for recording.
  Why now: Completes the CLI state-protection guardrails and non-intrusive Git hook boundaries before layering the live HUD over the state machine.
  PRD ref: `prd.md > Features and Behavior > 1. Session Lifecycle & Guardrails`, `prd.md > States and Boundaries`
  Spec ref: `spec.md > Components > 2. CLI Controller (src/cli.ts)`, `spec.md > Components > 3. Git post-commit Hook & Deterministic Verifier (src/hook.ts & src/verifier.ts)`
  Build: Add the active-session overwrite guard, `--replace` (`SUPERSEDED`), `commitgate cancel <token>` (`CANCELED`), and `commitgate demo-reset` to `src/cli.ts` and `src/db.ts`, and verify idle commit handling (`UNTRACKED`) in `src/hook.ts`.
  Verify (mechanical): Start session `CG-001`, run `commitgate start` again without `--replace` and confirm it refuses with the active session notice; run `commitgate cancel CG-001`, make a commit with no active session, and confirm `CommitGate: no active session. Commit ignored.` is printed and logged as `UNTRACKED`.
  Learner check: Try starting a duplicate session and canceling it in the terminal, and confirm the guard message and `cancel` / `--replace` flow behave as expected.
  Commit: `Add session overwrite guardrails, cancel/replace commands, and idle hook handling`

- [ ] **3. Live 360px Monospace HTML "Trusted Proxy" HUD Widget over SSE**
  Becomes usable: Running `commitgate serve` opens `http://localhost:4321`, displaying the compact 360px monospace HUD card (`#0A0C10` / `#11151D` flight-recorder theme) that automatically transitions in real time via Server-Sent Events (watching SQLite `PRAGMA data_version`) from `STANDBY` → `PENDING` (amber `#E5A54B`) → `REJECTED` (red `#E5484D` with expanded rule failures and 5-line test output) → `VERIFIED` (green `#3FB950` with diff summary).
  Why now: Connects the proven SQLite + Git-hook backend to the visual behavioral focus layer so the side-by-side 1-minute demo works end to end.
  PRD ref: `prd.md > The Core Journey` (steps 1–5), `prd.md > Screens and Layout`, `prd.md > Look and Feel`, `prd.md > Features and Behavior > 3. Local HTML "Trusted Proxy" HUD Widget`
  Spec ref: `spec.md > Look and Feel`, `spec.md > Components > 4. Local HTTP + SSE Server & Monospace HUD (src/server.ts & src/public/index.html)`
  Build: Implement `src/server.ts` (`GET /`, `GET /api/state`, `GET /events` SSE stream checking SQLite `PRAGMA data_version` / state digest every 250ms) and `src/public/index.html` with the `#0A0C10`/`#11151D` palette, `JetBrains Mono` typography, and 360px card layout for `IDLE`, `PENDING`, `REJECTED`, and `VERIFIED`.
  Verify (mechanical): Start `node ./commitgate/cli.js serve`, verify `/api/state` and `/events` stream real-time JSON updates across `IDLE` → `PENDING` → `REJECTED` → `VERIFIED`, and confirm the HTML HUD renders all required fields.
  Learner check: Open `http://localhost:4321` next to your terminal, run through the 1-minute demo flow (`start` → fake commit on `notes.txt` → real commit on `src/auth/validate.ts`), and watch the HUD flip live from Standby → Amber `PENDING` → Red `REJECTED` → Green `VERIFIED`.
  Commit: `Add local HTTP/SSE server and 360px monospace HUD widget`

## Hands-on Checkpoints

- [ ] Early usable behavior explored — after Slice 1 (core CLI + `post-commit` hook + 4-rule SQLite verifier)
- [ ] Final kick-the-tires exploration and feedback completed — after Slice 3 (full CLI + Git hook + live SSE 360px HUD)

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: [what actually happened; real document/test/code references; unfinished work if interrupted]
Route and stops: [actual paths and symbols; guided stops completed, or reference-only route]
Edit outcome: [tried/kept/reverted/declined/not applicable; verification if changed]
Reflection: [offered/answered/declined/already covered — personal answer belongs only in the ignored profile]
Activity mode: [live app and editor, explicit static fallback, focused alternative, prior practice, or recap]

## Revisions
