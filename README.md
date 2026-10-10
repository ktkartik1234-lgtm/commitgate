# CommitGate (`commitgate`)

Deterministic Git-hook proof-of-work verifier and compact monospace HTML "Trusted Proxy" HUD widget backed by SQLite.

## Quick Start

```bash
npm install
npm run build
node --no-warnings ./commitgate/cli.js init
```

## Running the 1-Minute Proof-of-Work Demo

1. **Start the local HUD server** (and open `http://localhost:4321` alongside your terminal):
   ```bash
   npm run hud
   ```

2. **(Optional) Reset demo state to Standby (`IDLE`):**
   ```bash
   node --no-warnings ./commitgate/cli.js demo-reset
   ```

3. **Start a Focus Session (`0:00–0:10` — HUD turns Amber `PENDING`):**
   ```bash
   node --no-warnings ./commitgate/cli.js start \
     --task "Fix login validation" \
     --require "src/auth/**" \
     --test "npm test" \
     --token "CG-001"
   ```

4. **Attempt a Lazy / Fake Commit (`0:10–0:25` — HUD turns Red `REJECTED`):**
   ```bash
   echo "noise" >> notes.txt
   git add notes.txt
   git commit -m "CG-001 done"
   ```

5. **Do the Real Work (`0:25–1:00` — HUD turns Green `VERIFIED`):**
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
