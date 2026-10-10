# CommitGate (`commitgate`)

Deterministic Git-hook proof-of-work verifier and compact monospace HTML "Trusted Proxy" HUD widget backed by SQLite.

## Zero-Install Quick Start (Node.js 22.5+ / 24+)

Pre-compiled binaries in `./commitgate/` and Node's built-in `node:sqlite` driver allow CommitGate to run immediately after `git clone`—**no `npm install`, manual hook init, or second terminal required**:

```bash
# Automatically installs .git/hooks/post-commit, starts the HUD server on
# http://localhost:4321 in the background, and runs the 1-minute demo:
node --no-warnings ./commitgate/cli.js demo
```

Or start a focus session with positional shorthand (defaults to `src/auth/**`, `npm test`, and `CG-001`):

```bash
node --no-warnings ./commitgate/cli.js start "Fix login validation"
```

## Manual Step-by-Step Walkthrough

1. **(Optional) Reset demo state to Standby (`IDLE`):**
   ```bash
   node --no-warnings ./commitgate/cli.js demo-reset
   ```

2. **Start a Focus Session (`0:00–0:10` — auto-starts HUD at `http://localhost:4321` & turns Amber `PENDING`):**
   ```bash
   # Shorthand:
   node --no-warnings ./commitgate/cli.js start "Fix login validation" "src/auth/**"

   # Or explicit flags:
   node --no-warnings ./commitgate/cli.js start \
     --task "Fix login validation" \
     --require "src/auth/**" \
     --test "npm test" \
     --token "CG-001"
   ```

3. **Attempt a Lazy / Fake Commit (`0:10–0:25` — HUD turns Red `REJECTED`):**
   ```bash
   echo "noise" >> notes.txt
   git add notes.txt
   git commit -m "CG-001 done"
   ```

4. **Do the Real Work (`0:25–1:00` — HUD turns Green `VERIFIED`):**
   Update `src/auth/validate.ts` so `validateLogin` returns `true` for valid credentials, run `npm test`, and commit:
   ```bash
   git add src/auth/validate.ts
   git commit -m "CG-001 Fix login validation"
   ```

## Planning Artifacts (`devpost/`)
- [`devpost/scope.md`](devpost/scope.md) & [`devpost/scope.html`](devpost/scope.html)
- [`devpost/prd.md`](devpost/prd.md) & [`devpost/prd.html`](devpost/prd.html)
- [`devpost/spec.md`](devpost/spec.md) & [`devpost/spec.html`](devpost/spec.html)
- [`devpost/checklist.md`](devpost/checklist.md)
