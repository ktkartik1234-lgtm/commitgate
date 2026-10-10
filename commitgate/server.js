"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHudSnapshot = buildHudSnapshot;
exports.startHudServer = startHudServer;
const node_http_1 = __importDefault(require("node:http"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const db_1 = require("./db");
function buildHudSnapshot(repoRoot = process.cwd()) {
    const session = (0, db_1.getDisplaySession)(repoRoot);
    if (!session) {
        return {
            hudState: "IDLE",
            session: null,
            latestAttempt: null,
        };
    }
    const rawAttempt = (0, db_1.getLatestAttemptForSession)(session.session_id, repoRoot);
    const parsedRules = rawAttempt && rawAttempt.rules_json
        ? JSON.parse(rawAttempt.rules_json)
        : null;
    let hudState = "PENDING";
    if (session.status === "VERIFIED") {
        hudState = "VERIFIED";
    }
    else if (rawAttempt && rawAttempt.status === "REJECTED") {
        hudState = "REJECTED";
    }
    else {
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
function startHudServer(port = 4321, repoRoot = process.cwd()) {
    const clients = new Set();
    let lastDigest = (0, db_1.getStateDigest)(repoRoot);
    const pollTimer = setInterval(() => {
        try {
            const currentDigest = (0, db_1.getStateDigest)(repoRoot);
            if (currentDigest !== lastDigest) {
                lastDigest = currentDigest;
                const payload = `data: ${JSON.stringify(buildHudSnapshot(repoRoot))}\n\n`;
                for (const client of clients) {
                    client.write(payload);
                }
            }
        }
        catch {
            // Ignore transient SQLite read contention
        }
    }, 250);
    pollTimer.unref();
    const server = node_http_1.default.createServer((req, res) => {
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
            const htmlPath = node_path_1.default.join(repoRoot, "src", "public", "index.html");
            const html = node_fs_1.default.readFileSync(htmlPath, "utf8");
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
