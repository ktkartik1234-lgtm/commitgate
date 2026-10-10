---
doc: scope
status: approved
---

# CommitGate

A local CLI (`commitgate`), Git-hook verification engine, and minimalist HTML "Trusted Proxy" status widget that prove real developer work happened using deterministic rules and SQLite state—eliminating self-reported progress and vibes-based AI checks.

## The Unique Kernel
Deterministic, zero-trust Git commit verification triggered automatically by a local `post-commit` hook, persisted in SQLite, and surfaced live in a minimalist local status widget. Pass/fail decisions are strictly rule-based (commit existence, session ID match, hook SHA record, expected files touched, non-noise diff, and passing test exit code)—never decided by user willpower or an LLM hallucination.

## Who It's For
A developer who spends long hours at their laptop (up to 15 hours/day) battling passive consumption and context switching, who wants invisible, non-negotiable accountability tied to verifiable code output rather than another self-reported to-do list or willpower-based blocker.

## The Core Loop
1. **Start Session:** The developer starts a focused work session in the CLI, defining one clear task and its deterministic verification rules; the session is saved in SQLite as `PENDING` with a unique session ID.
2. **Watch State (Terminal + Local HTML Companion Widget):** A minimalist, distraction-free local status widget (and/or terminal status pane) reads from SQLite alongside the developer's editor, displaying the active session ID, status (`PENDING` in orange), and explicit verification rules.
3. **Commit Code:** The developer works in their local repo and creates a Git commit referencing the session ID.
4. **Automatic Hook & Verification:** A local Git `post-commit` hook immediately captures the commit SHA, logs the event to SQLite, and runs the deterministic verifier against the session rules.
5. **State Transition:**
   - If the commit is lazy or incomplete (e.g., noise/comment change, wrong file path, or failing tests), the verifier rejects it, prints the exact rule failure, and updates SQLite—flipping the status widget to `REJECTED` (red).
   - Once a commit touches the expected code and passes the rules (including test execution), SQLite transitions the session to `VERIFIED`—flipping the status widget to green (`VERIFIED`) and marking the task complete.

## Inspiration & Identity
- **References:** Local Git hooks (`pre-commit`/`post-commit`), the VS Code API, Cold Turkey (strict, non-negotiable blocking/enforcement mechanics), and Obsidian (local-first, structured state).
- **Mood & Tone:** Crisp, terminal-native, high-signal, and zero-fluff. The local HTML widget acts as a calm, authoritative "Trusted Proxy" companion right next to the code, with unmistakable state transitions (`PENDING` orange → `REJECTED` red → `VERIFIED` green).

## Why This Matters to the Learner
"I often sit at my laptop for 15 hours a day but fall into a trap of passive consumption... I want to engineer invisible accountability software that intercepts the underlying psychological triggers of distraction, fundamentally shifting the user from a passive consumer to an active builder." Having both the CLI/Git-hook backend and the minimalist local HTML companion widget proves the hard engineering architecture and the behavioral/psychological focus layer in one cohesive MVP.

## What "Working" Looks Like
In a 1-minute side-by-side demo inside a small demo repo (terminal/code on one side, live SQLite status pane / minimalist HTML widget on the other):
- **0:00–0:10 (Start):** Start a session via the CLI. The status widget displays the session ID, explicit verification rules, and `PENDING` status (orange).
- **0:10–0:25 (The "Oh, That's Cool" Moment — Catching a Fake Commit):** Attempt to cheat the loop with a meaningless/noise commit. The Git `post-commit` hook fires automatically, catches that the commit violates the session rules, prints the failure breakdown, and flips the status widget to `REJECTED` (red).
- **0:25–0:45 (Real Work):** Edit the expected source file, run tests so they pass, and commit with the session ID.
- **0:45–1:00 (Verified):** The `post-commit` hook runs automatically again, passes every deterministic rule check, and flips the live status widget to green (`VERIFIED`).

## The POC Boundary
Strictly the local end-to-end verification loop and minimalist companion widget:
- CLI commands to initialize hooks, start a session with deterministic rules, and launch/view the status monitor backed by SQLite.
- Minimalist, distraction-free local HTML companion widget (plus terminal status output) that reads SQLite state and live-displays the session status (`PENDING` → `REJECTED` → `VERIFIED`) and rule breakdown.
- Local Git `post-commit` hook that automatically captures commit SHAs and triggers verification.
- Deterministic verifier checking commit existence, session ID in commit message, hook SHA registration, expected file/directory paths, non-empty/non-noise diff, and optional test command exit code.
- Small sample repo/target file + test setup so the 1-minute demo (fake commit rejected → real commit verified) runs out of the box.

## Later
- LLM-based coaching, feedback, or explanations layered *after* deterministic pass/fail.
- Browser extension for tab blocking/unlocking or YouTube active-recall ("pause and prove what you learned").
- Email / job-application "Trusted Proxy" background inbox monitor.
- Long-running multi-agent orchestration and multi-week semantic memory.
- VS Code API integrations and non-Git file watchers.

## Explicitly Cut
- **Vibes-based LLM pass/fail judgment:** Cut because an LLM can hallucinate or be prompt-injected; verification must be 100% deterministic.
- **Cloud sync, user accounts, and multi-page web apps:** Cut to keep the proof of concept 100% local-first, distraction-free, and achievable in 2–4 hours.
