---
doc: spec
status: approved
---

# CommitGate — Technical Spec

## How This Works, In Plain Language
CommitGate is a local-first Node.js + TypeScript tool made of four tightly connected pieces that share a single SQLite database (`commitgate.db`) inside the repository:

1. **The CLI (`commitgate`):** Manages focus sessions (`start`, `status`, `cancel`, `init`, `serve`). When you start a session (`commitgate start --task ... --require ... --test ... --token CG-001`), it checks that no other session is already active, then writes the session and its deterministic verification rules into `commitgate.db` with status `PENDING`.
2. **The Cross-Platform Git Hook (`./commitgate/hook.js`):** Installed into `.git/hooks/post-commit` as a tiny shell shim that runs `node ./commitgate/hook.js`. Every time you run `git commit`, Git automatically invokes `hook.js`. If no session is active, it logs the commit as `UNTRACKED` and exits quietly without interrupting your workflow.
3. **The Deterministic Verifier Engine:** When `hook.js` detects an active session in `commitgate.db`, it inspects the latest commit (`HEAD`) using local Git commands and runs four strict checks in order:
   - Does the commit message contain the session token (`CG-001`)?
   - Do the changed files in `HEAD` match the required glob (`src/auth/**`)?
   - Do the matched files contain at least 1 line of non-whitespace code changes?
   - Does the configured test command (`npm test`) exit with code `0`?
   It writes the attempt record into `commitgate.db`, updates the session status (`VERIFIED` if all four pass, or keeps the session open while recording the latest attempt as `REJECTED`), and prints a structured pass/fail breakdown right in the terminal.
4. **The Local SSE HUD Server & 360px Monospace Widget:** A lightweight local HTTP server (`http://localhost:4321`) serves the compact monospace HTML HUD widget and keeps an open Server-Sent Events (`/events`) stream. Every 250ms, the server checks SQLite's `PRAGMA data_version` (and state digest); the instant any CLI command or Git commit modifies `commitgate.db`, the server pushes the updated state over SSE so the HUD card flips between `STANDBY`, `PENDING` (amber), `REJECTED` (red), and `VERIFIED` (green) in real time without polling from the browser or requiring network calls inside the Git hook.

## The Core Journey Through the System
PRD ref: `prd.md > The Core Journey`.

1. **Standby (`IDLE`):** The user starts the HUD server (`commitgate serve` or `npm run hud`) and opens `http://localhost:4321`. The server queries `commitgate.db`, sees no active session, and sends an initial SSE payload `{ state: "IDLE" }`. The 360px HUD card renders `"No active session. Awaiting focus block."`
2. **Session Start (`0:00–0:10`):** The user runs `commitgate start --task "Fix login validation" --require "src/auth/**" --test "npm test" --token "CG-001"`.
   - The CLI queries `sessions` for any row with `status = 'PENDING'`. Finding none, it inserts a new row (`session_id = 'CG-001'`, `status = 'PENDING'`, `attempt_count = 0`).
   - SQLite increments `PRAGMA data_version`. Within 250ms, the SSE server detects the change and pushes the `PENDING` session state to the browser. The HUD card turns amber (`#E5A54B`) and lists the 4 waiting rules.
3. **Fake Commit Attempt (`0:10–0:25`):** The user runs `echo "noise" >> notes.txt && git add notes.txt && git commit -m "CG-001 done"`.
   - Git finishes creating the commit and immediately executes `.git/hooks/post-commit`, which runs `node ./commitgate/hook.js`.
   - `hook.js` reads the active session (`CG-001`) from `commitgate.db` and inspects `HEAD`:
     - Rule 1 (`token`): `git log -1 --pretty=%B` contains `CG-001` → `PASS`.
     - Rule 2 (`required path`): `git diff-tree --no-commit-id --name-only -r HEAD` returns `notes.txt`, which does not match `src/auth/**` → `FAIL`.
     - Rule 3 (`meaningful code change`): `0` non-whitespace lines changed in matched required files → `FAIL`.
     - Rule 4 (`tests passed`): Runs `npm test` via `child_process.spawnSync`, which exits `1` → `FAIL` (captures last 5 lines of output).
   - `hook.js` inserts a `REJECTED` row into `commit_attempts`, increments `attempt_count` on `sessions`, and prints the formatted `CommitGate verification failed` report to stdout.
   - The SSE server detects the new SQLite write and pushes the `REJECTED` attempt payload to the HUD widget, which switches its left border and badge to red (`#E5484D`) and expands the failed rules.
4. **Real Work & Verified Commit (`0:25–1:00`):** The user fixes `src/auth/validate.ts`, verifies `npm test` passes, and runs `git commit -am "CG-001 fix login validation"`.
   - `hook.js` runs automatically again. All 4 deterministic rules evaluate to `PASS`.
   - `hook.js` generates a short deterministic `verification_id` (first 7 hex chars of SHA-256 over `session_id + commit_sha + timestamp`), marks `sessions.status = 'VERIFIED'`, records the `VERIFIED` attempt in `commit_attempts`, and prints `CommitGate verification passed` to the terminal.
   - The SSE server pushes the updated state; the HUD widget flips to green (`#3FB950` `VERIFIED`), showing `src/auth/validate.ts +X / -Y`, `npm test passed`, and `"Session closed. Work proved."`

## Stack
- **Runtime & Language:** [Node.js](https://nodejs.org/docs/latest/api/) (`v24.19.0` installed locally) + [TypeScript](https://www.typescriptlang.org/docs/) (executed via `tsx` or compiled to `./commitgate/` JS so `node ./commitgate/hook.js` runs with zero startup overhead).
  - *Rationale:* Matches the learner's preferred stack; compiling/bundling `hook.js` to plain JS ensures the Git `post-commit` hook executes instantaneously across Windows, macOS, and Linux.
- **SQLite Driver:** [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) (primary synchronous SQLite driver), with automatic fallback adapter to Node 24's built-in synchronous [`node:sqlite` (`DatabaseSync`)](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) if Windows lacks C++ `node-gyp` build tools for Node 24 ABI.
  - *Rationale:* Synchronous SQLite access keeps CLI commands and Git hooks deterministic, fast, and race-condition free.
- **HTTP & Server-Sent Events (SSE):** Node.js built-in [`node:http`](https://nodejs.org/docs/latest/api/http.html) + browser [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource).
  - *Rationale:* Zero external web framework needed to serve the single `hud.html` page and stream real-time JSON state updates over `text/event-stream`.
- **Glob Matching:** Node.js built-in `path.matchesGlob` (available in Node 22+/24) or [`picomatch`](https://github.com/micromatch/picomatch) for deterministic `--require "src/auth/**"` matching across Windows/POSIX slashes.
  - *Rationale:* Normalizing file paths to forward slashes (`/`) before glob matching guarantees identical behavior on Windows and Unix.

## Where It Runs and How Someone Tries It
- **Runtime Environment:** Runs 100% locally on Windows, macOS, or Linux with Node.js (`v24+`) and Git installed. No API keys, cloud accounts, or external network access required.
- **Exact Commands to Run and Record the 1-Minute Demo:**
  1. Install and initialize hooks + demo repo files:
     ```bash
     npm install
     npm run build
     node ./commitgate/cli.js init
     ```
  2. Start the local HUD server (in background or second terminal) and open `http://localhost:4321`:
     ```bash
     node ./commitgate/cli.js serve
     ```
  3. Run the 1-minute demo sequence in the main terminal while recording the terminal and `http://localhost:4321` side by side:
     ```bash
     # 1. Start session (HUD turns PENDING amber)
     node ./commitgate/cli.js start --task "Fix login validation" --require "src/auth/**" --test "npm test" --token "CG-001"

     # 2. Try fake commit (post-commit hook fires -> HUD turns REJECTED red)
     echo "noise" >> notes.txt
     git add notes.txt
     git commit -m "CG-001 done"

     # 3. Fix src/auth/validate.ts, run npm test, and commit (HUD turns VERIFIED green)
     git add src/auth/validate.ts
     git commit -m "CG-001 Fix login validation"
     ```
  *(Note: A `commitgate` bin alias and `npm run commitgate -- ...` script will also be configured in `package.json` for convenience.)*
- **Deployment:** Optional for hackathon submission (demo video + public GitHub repo are required). Because CommitGate operates on local Git hooks and a local SQLite database, local execution is the authentic runtime for the demo recording.

## Look and Feel
Implements `prd.md > Look and Feel` and `prd.md > Screens and Layout`.

- **Archetype:** Compact (`360px` wide) monospace terminal HUD / flight-recorder panel centered or docked cleanly on a dark `#0A0C10` canvas.
- **Typography:** `font-family: "JetBrains Mono", "SF Mono", ui-monospace, SFMono-Regular, Consolas, monospace;` for all session IDs, commit SHAs, file paths, rule rows, and test snippets.
- **Strict Color Tokens:**
  - Canvas Background: `#0A0C10`
  - Card Background: `#11151D`
  - Card & Row Border: `1px solid #232A36` (with `3px solid` left accent border reflecting active status color)
  - Primary Text: `#D7DCE5`
  - Muted Text: `#7C8698`
  - Status Colors: `#E5A54B` (`PENDING` amber), `#E5484D` (`REJECTED` red), `#3FB950` (`VERIFIED` green)
- **Visual Constraints:** Sharp `0px–2px` corners, dense `12px–13px` type scale, no gradients, no glassmorphism, no animations/confetti.

## Components

### 1. SQLite State Store (`src/db.ts`)
Implements `prd.md > States and Boundaries` and `prd.md > Features and Behavior > 1. Session Lifecycle & Guardrails`.
- Manages `commitgate.db` in WAL mode (`PRAGMA journal_mode = WAL;`) so concurrent reads from the SSE server never block writes from the CLI or `post-commit` hook.
- Exposes typed synchronous helpers: `getActiveSession()`, `getLatestStateSnapshot()`, `createSession()`, `cancelSession()`, `supersedeActiveSession()`, `recordCommitAttempt()`, and `getDataVersion()`.

### 2. CLI Controller (`src/cli.ts`)
Implements `prd.md > Screens and Layout` and `prd.md > Features and Behavior > 1. Session Lifecycle & Guardrails`.
- Parses commands:
  - `commitgate init`: Installs `.git/hooks/post-commit` calling `node ./commitgate/hook.js` and ensures `commitgate.db` schema is initialized.
  - `commitgate start --task <str> --require <glob> --test <cmd> --token <id> [--replace]`: Enforces the active-session guard (refusing to overwrite an active `PENDING` session unless `--replace` is passed, which marks the prior session `SUPERSEDED`).
  - `commitgate cancel [token]`: Marks the active session `CANCELED`.
  - `commitgate status`: Prints the current session and latest attempt state to the terminal.
  - `commitgate serve [--port 4321]`: Launches the local HTTP + SSE HUD server.

### 3. Git `post-commit` Hook & Deterministic Verifier (`src/hook.ts` & `src/verifier.ts`)
Implements `prd.md > Features and Behavior > 2. Automatic Git post-commit Hook & Deterministic Rule Engine`.
- Invoked via `node ./commitgate/hook.js` on every `git commit`.
- If no session has `status = 'PENDING'`, records an `UNTRACKED` commit event in `commitgate.db`, prints `CommitGate: no active session. Commit ignored.`, and exits `0`.
- If an active session exists, extracts commit metadata from Git (`git rev-parse --short HEAD`, `git log -1 --pretty=%B`, `git diff-tree --no-commit-id --name-only -r HEAD`, and `git show --format= --unified=0 HEAD -- <matchedFiles>`) and evaluates the 4 rules:
  1. **Token Match:** `commitMessage.includes(session.token)`
  2. **Required Path Match:** Normalizes changed file paths to POSIX `/` and tests against `session.require_glob`. Captures `changedFiles` and `matchedFiles` plus `git diff --numstat` (`+X / -Y`).
  3. **Meaningful Code Change:** Parses added/removed lines (`+` / `-` lines excluding `+++`/`---` headers) in `matchedFiles` and counts lines where `line.slice(1).trim().length > 0`. Passes if `nonWhitespaceLinesChanged > 0`.
  4. **Tests Passed:** Runs `session.test_cmd` via `spawnSync(..., { shell: true, encoding: 'utf8' })`. Passes if `status === 0`. Extracts the last 5 non-empty lines of combined `stdout`/`stderr` on failure.
- Updates `commitgate.db` and prints the exact `CommitGate verification failed` or `CommitGate verification passed` report specified in `prd.md`.

### 4. Local HTTP + SSE Server & Monospace HUD (`src/server.ts` & `src/public/index.html`)
Implements `prd.md > Features and Behavior > 3. Local HTML "Trusted Proxy" HUD Widget` and `prd.md > Look and Feel`.
- `GET /`: Serves the self-contained HUD HTML/CSS/JS page (`360px` card layout).
- `GET /api/state`: Returns the current JSON snapshot (`activeSession` + `latestAttempt`).
- `GET /events`: Opens an SSE stream (`Content-Type: text/event-stream`). Every 250ms, compares a lightweight state digest (`PRAGMA data_version` + latest session/attempt timestamp) and broadcasts a `data: <json>\n\n` event immediately when `commitgate.db` changes.

### 5. Demo Target & Test Suite (`src/auth/validate.ts`, `src/auth/validate.test.ts`, `notes.txt`)
Implements `prd.md > The Core Journey`.
- A small, real TypeScript/JS module (`validateLogin(email, password)`) with an initial intentional bug (causing `npm test` to fail with `Expected: true / Received: false` during the fake commit step) that the developer fixes during the `0:25–0:45` step so `npm test` exits `0`.

## Data Model
Stored in `./commitgate.db` (SQLite, excluded from Git tracking via `.gitignore` so DB binary changes don't dirty `git status` during the demo):

### Table 1: `sessions`
| Column | Type | Description |
|---|---|---|
| `session_id` | `TEXT PRIMARY KEY` | Token / session ID (e.g., `CG-001`) |
| `task` | `TEXT NOT NULL` | Task description (`Fix login validation`) |
| `require_glob` | `TEXT NOT NULL` | Required file path glob (`src/auth/**`) |
| `test_cmd` | `TEXT NOT NULL` | Shell command to verify tests (`npm test`) |
| `status` | `TEXT NOT NULL` | `PENDING` \| `VERIFIED` \| `CANCELED` \| `SUPERSEDED` |
| `attempt_count` | `INTEGER NOT NULL DEFAULT 0` | Number of commit attempts evaluated |
| `verification_id` | `TEXT` | Populated when `status = 'VERIFIED'` (e.g., `9f2c1a7`) |
| `created_at` | `TEXT NOT NULL` | ISO timestamp |
| `updated_at` | `TEXT NOT NULL` | ISO timestamp |

### Table 2: `commit_attempts`
| Column | Type | Description |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Sequential event ID |
| `session_id` | `TEXT` | Foreign key to `sessions.session_id` (`NULL` if `UNTRACKED`) |
| `attempt_number` | `INTEGER NOT NULL` | Attempt number within the session (`1`, `2`, ...) |
| `commit_sha` | `TEXT NOT NULL` | Short Git commit SHA (`abc1234`) |
| `commit_message` | `TEXT NOT NULL` | Commit message headline |
| `status` | `TEXT NOT NULL` | `REJECTED` \| `VERIFIED` \| `UNTRACKED` |
| `rules_json` | `TEXT` | JSON breakdown of the 4 rules (`token`, `requiredPath`, `meaningfulChange`, `testsPassed`) including `expected`, `changed`, `diffSummary`, `nonWhitespaceCount`, `exitCode`, and `testOutputSnippet` |
| `created_at` | `TEXT NOT NULL` | Local time / ISO timestamp of check |

## File Structure
```text
devpost_awesome_app/
├── commitgate/                 # Compiled JS output for instant CLI & Git hook execution
│   ├── cli.js                  # Entrypoint for `commitgate` CLI commands
│   └── hook.js                 # Entrypoint invoked by `.git/hooks/post-commit`
├── src/
│   ├── cli.ts                  # CLI command parser (`init`, `start`, `status`, `cancel`, `serve`)
│   ├── hook.ts                 # Git post-commit hook runner
│   ├── verifier.ts             # 4-rule deterministic verification engine
│   ├── db.ts                   # SQLite connection, schema init, and synchronous queries
│   ├── server.ts               # Local HTTP + SSE server watching SQLite changes
│   ├── public/
│   │   └── index.html          # 360px monospace HUD widget (#0A0C10 / #11151D theme)
│   └── auth/                   # Demo target files for the 1-minute proof-of-work recording
│       ├── validate.ts         # Login validation module edited during the demo
│       └── validate.test.ts    # Test suite run by `--test "npm test"`
├── notes.txt                   # Scratch file used for the 0:10–0:25 fake commit demo step
├── devpost/                    # Devpost Learn planning artifacts
│   ├── learner-profile.md      # Git-ignored learner profile
│   ├── scope.md                # Approved scope document
│   ├── scope.html              # Visual HTML companion for scope
│   ├── prd.md                  # Approved product requirements document
│   ├── prd.html                # Visual HTML companion for PRD
│   ├── spec.md                 # This technical specification
│   └── spec.html               # Visual HTML companion for spec
├── .gitignore                  # Ignores learner-profile.md, .env*, node_modules, commitgate.db*
├── package.json                # Scripts (`build`, `test`, `commitgate`, `hud`) & dependencies
└── tsconfig.json               # TypeScript configuration compiling `src/` -> `commitgate/`
```

## External Services and Dependencies
- **No external network APIs or cloud services.** All verification happens against the local Git repository and local SQLite file.
- **Local Dependencies:**
  - [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) (with automatic runtime fallback to Node 24 built-in [`node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) if native compilation is unavailable).
  - [`typescript`](https://www.typescriptlang.org/) & [`@types/node`](https://www.npmjs.com/package/@types/node) for compilation.

## Important Failure Modes
- **Windows Path Separators in Git Diff vs. Glob (`src\auth\validate.ts` vs. `src/auth/**`):**
  - *Fallback/Handling:* `verifier.ts` normalizes all paths returned by Git and user `--require` globs to forward slashes (`/`) before matching.
- **PowerShell `npx.ps1` / `npm.ps1` Execution Policy on Windows When Running `--test "npm test"`:**
  - *Fallback/Handling:* On Windows (`process.platform === 'win32'`), `verifier.ts` executes the test command through `cmd.exe /d /s /c "<test_cmd>"` (via `spawnSync(testCmd, { shell: true })`), which invokes `npm.cmd` cleanly without triggering PowerShell `.ps1` execution policy errors.
- **SQLite File Locked or Dirty Working Tree From `commitgate.db`:**
  - *Fallback/Handling:* `commitgate.db`, `commitgate.db-wal`, and `commitgate.db-shm` are added to `.gitignore` so database writes during `commitgate start` or `post-commit` never pollute `git status` or get committed into the repo.

## What Was Simplified and Why
- **SQLite State Polling in the SSE Server (Option A) instead of Inter-Process Socket RPC:** The SSE server checks SQLite state every 250ms and pushes SSE updates when changes occur, rather than requiring `hook.js` to make HTTP/socket calls. This guarantees `git commit` never hangs or errors if the HUD server isn't running.
- **Non-Whitespace Line Diff Count + Test Exit Code instead of Language-Specific AST Parsing:** Proves substantive code changes in `--require` paths without writing multi-language comment/AST parsers.
- **Compiled `./commitgate/hook.js` instead of `ts-node` inside Git Hooks:** Running compiled JS directly with `node ./commitgate/hook.js` makes the `post-commit` hook fast (~50ms overhead before tests) and avoids TypeScript loader issues inside Git's hook environment.

## Decisions and Open Issues
- **Learner Decisions:**
  - **Node.js + TypeScript + SQLite (`better-sqlite3`):** Chosen for fast, synchronous local CLI and Git hook execution.
  - **Local HTTP + Server-Sent Events (SSE) with Option A (SQLite `data_version` / state check):** Chosen so `hook.js` and CLI processes only write to `commitgate.db`, and the SSE server automatically detects changes and pushes live updates to the 360px HUD widget.
  - **Cross-Platform Hook Entrypoint (`node ./commitgate/hook.js`):** Chosen so `.git/hooks/post-commit` behaves identically across Windows, macOS, and Linux.
- **Discussed Technical Tradeoff / Investigation:**
  - Addressed how short-lived CLI/Git-hook processes trigger real-time updates in a separate long-running SSE server process (resolved via Option A: SQLite WAL + 250ms state check on `commitgate.db`), and noted the automatic fallback to Node 24's built-in synchronous `node:sqlite` (`DatabaseSync`) if `better-sqlite3` lacks a prebuilt binary on Windows Node `v24.19.0`.
- **Open Issues:** None blocking `5-build`.
