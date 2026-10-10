import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  getDisplaySession,
  getLatestAttemptForSession,
  getStateDigest,
  RuleBreakdown,
} from "./db";

export interface HudSnapshot {
  hudState: "IDLE" | "PENDING" | "REJECTED" | "VERIFIED";
  session: ReturnType<typeof getDisplaySession>;
  latestAttempt: {
    id: number;
    attempt_number: number;
    commit_sha: string;
    commit_message: string;
    status: string;
    created_at: string;
    rules: RuleBreakdown | null;
  } | null;
}

export function buildHudSnapshot(repoRoot: string = process.cwd()): HudSnapshot {
  const session = getDisplaySession(repoRoot);
  if (!session) {
    return {
      hudState: "IDLE",
      session: null,
      latestAttempt: null,
    };
  }

  const rawAttempt = getLatestAttemptForSession(session.session_id, repoRoot);
  const parsedRules =
    rawAttempt && rawAttempt.rules_json
      ? (JSON.parse(rawAttempt.rules_json) as RuleBreakdown)
      : null;

  let hudState: "IDLE" | "PENDING" | "REJECTED" | "VERIFIED" = "PENDING";
  if (session.status === "VERIFIED") {
    hudState = "VERIFIED";
  } else if (rawAttempt && rawAttempt.status === "REJECTED") {
    hudState = "REJECTED";
  } else {
    hudState = "PENDING";
  }

  return {
    hudState,
    session,
    latestAttempt: rawAttempt
      ? {
          id: rawAttempt.id,
          attempt_number: rawAttempt.attempt_number,
          commit_sha: rawAttempt.commit_sha,
          commit_message: rawAttempt.commit_message,
          status: rawAttempt.status,
          created_at: rawAttempt.created_at,
          rules: parsedRules,
        }
      : null,
  };
}

export function startHudServer(
  port: number = 4321,
  repoRoot: string = process.cwd()
): http.Server {
  const clients = new Set<http.ServerResponse>();
  let lastDigest = getStateDigest(repoRoot);

  const pollTimer = setInterval(() => {
    try {
      const currentDigest = getStateDigest(repoRoot);
      if (currentDigest !== lastDigest) {
        lastDigest = currentDigest;
        const payload = `data: ${JSON.stringify(buildHudSnapshot(repoRoot))}\n\n`;
        for (const client of clients) {
          client.write(payload);
        }
      }
    } catch {
      // Ignore transient SQLite read contention
    }
  }, 250);

  pollTimer.unref();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/api/state") {
      const snapshot = buildHudSnapshot(repoRoot);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(snapshot));
      return;
    }

    if (url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(buildHudSnapshot(repoRoot))}\n\n`);
      clients.add(res);
      req.on("close", () => {
        clients.delete(res);
      });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const htmlPath = path.join(repoRoot, "src", "public", "index.html");
      const html = fs.readFileSync(htmlPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`CommitGate HUD server listening on http://localhost:${port}`);
    console.log("  SSE stream: http://localhost:" + port + "/events");
    console.log("  SQLite watch: PRAGMA data_version (250ms)");
  });

  return server;
}
