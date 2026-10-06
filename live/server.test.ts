import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RewriteError, type Display, type ThoughtAdapter } from "./adapter";
import { startServer } from "./server";

const display: Display = { title: "Check the stream", summary: "The connection is open.", steps: ["Watch for a note."], nextAction: "Send a note.", uncertainty: null };
const started: ReturnType<typeof startServer>[] = [];
const folders: string[] = [];

afterEach(async () => {
  for (const app of started.splice(0)) await app.stop();
  for (const directory of folders.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function appFor(adapter: ThoughtAdapter = { provider: "test", available: true, transform: async () => display }, stateFile?: string) {
  const directory = await mkdtemp(join(tmpdir(), "think-live-test-"));
  folders.push(directory);
  const app = startServer({ port: 0, stateFile: stateFile ?? join(directory, "state.json"), adapter, heartbeatMs: 10 });
  started.push(app);
  return app;
}

const body = (original = "The connection is open. Next, send a note.", sessionId = "main") => ({ original, sessionId, thoughtNumber: 1, totalThoughts: 2, nextThoughtNeeded: true });
const post = (url: string, value: unknown, headers: Record<string, string> = {}) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });

async function waitUntil(check: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for test state.");
    await Bun.sleep(5);
  }
}

describe("live thought API", () => {
  test("accepts a persisted source note immediately, streams state and serializes rewrites", async () => {
    const resolvers: ((result: Display) => void)[] = [];
    let calls = 0;
    const app = await appFor({ provider: "test", available: true, transform: async () => { calls++; return new Promise(resolve => resolvers.push(resolve)); } });
    const abort = new AbortController();
    const response = await fetch(`${app.url}/api/events`, { signal: abort.signal });
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: state");
    expect(first).toContain('"notes":[]');

    const accepted = await post(`${app.url}/api/notes`, { ...body(), id: "first" });
    expect(accepted.status).toBe(202);
    expect((await accepted.json()).note.status).toBe("transforming");
    expect((await Bun.file(app.stateFile).json()).notes[0].original).toBe(body().original);
    const streamed = new TextDecoder().decode((await reader.read()).value);
    expect(streamed).toContain('"id":"first"');
    expect(streamed).toContain('"status":"transforming"');

    await post(`${app.url}/api/notes`, { ...body("Second source note."), id: "second" });
    expect(calls).toBe(1);
    resolvers[0](display);
    await waitUntil(() => calls === 2);
    expect(app.snapshot("main").notes[0].status).toBe("ready");
    resolvers[1](display);
    await waitUntil(() => app.snapshot("main").notes[1].status === "ready");
    expect((await Bun.file(app.stateFile).json()).notes[1].display.title).toBe(display.title);
    abort.abort();
    await reader.cancel().catch(() => {});
  });

  test("note ids deduplicate safely and conflicting payloads return 409", async () => {
    let calls = 0;
    const app = await appFor({ provider: "test", available: true, transform: async () => { calls++; return display; } });
    const input = { ...body(), id: "stable-note" };
    const first = await post(`${app.url}/api/notes`, input);
    expect(first.status).toBe(202);
    await waitUntil(() => app.snapshot("main").notes[0].status === "ready");
    expect((await post(`${app.url}/api/notes`, input)).status).toBe(202);
    expect((await post(`${app.url}/api/notes`, { ...input, original: "A different source." })).status).toBe(409);
    expect(calls).toBe(1);
    expect(app.snapshot("main").notes).toHaveLength(1);
  });

  test("replies persist, are isolated by session, and include original grounding when consumed", async () => {
    const app = await appFor();
    await post(`${app.url}/api/notes`, { ...body(), id: "main-note", needsMoreThoughts: true });
    await post(`${app.url}/api/notes`, { ...body("Other source", "other"), id: "other-note" });
    const reply = await post(`${app.url}/api/notes/main-note/replies`, { text: "Please check reconnection first." });
    expect(reply.status).toBe(201);
    expect((await reply.json()).reply.deliveredAt).toBeUndefined();
    await post(`${app.url}/api/notes/other-note/replies`, { text: "Other session reply" });
    const state = await (await fetch(`${app.url}/api/state?session=main`)).json();
    expect(state.notes).toHaveLength(1);
    expect(state.feedback).toHaveLength(1);
    const consumed = await (await post(`${app.url}/api/feedback/consume`, { sessionId: "main" })).json();
    expect(consumed.feedback).toHaveLength(1);
    expect(consumed.feedback[0].text).toBe("Please check reconnection first.");
    expect(consumed.feedback[0].original).toBe(body().original);
    expect(consumed.feedback[0].thoughtNumber).toBe(1);
    expect(consumed.feedback[0].deliveredAt).toBeString();
    expect((await (await post(`${app.url}/api/feedback/consume`, { sessionId: "main" })).json()).feedback).toEqual([]);
    expect((await (await post(`${app.url}/api/feedback/consume`, { sessionId: "other" })).json()).feedback).toHaveLength(1);

    await app.stop();
    const restored = await appFor(undefined, app.stateFile);
    expect(restored.snapshot("main").feedback[0].deliveredAt).toBeString();
    expect(restored.snapshot("main").notes[0].original).toBe(body().original);
    expect(restored.snapshot("main").notes[0].needsMoreThoughts).toBe(true);
  });

  test("safe adapter errors keep the source note and allow an explicit retry", async () => {
    let failed = true;
    const app = await appFor({ provider: "test", available: true, transform: async () => { if (failed) throw new Error("secret-token-do-not-expose"); return display; } });
    await post(`${app.url}/api/notes`, { ...body(), id: "retry-note" });
    await waitUntil(() => app.snapshot("main").notes[0].status === "error");
    const note = app.snapshot("main").notes[0];
    expect(note.original).toBe(body().original);
    expect(note.error).not.toContain("secret-token");
    expect(note.display).toBeUndefined();
    failed = false;
    expect((await post(`${app.url}/api/notes/retry-note/retry`, {})).status).toBe(202);
    await waitUntil(() => app.snapshot("main").notes[0].status === "ready");
    expect(app.snapshot("main").notes[0].error).toBeUndefined();
    expect((await post(`${app.url}/api/notes/retry-note/retry`, {})).status).toBe(409);
  });

  test("restarts unfinished rewrites and refuses invalid state files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "think-live-restart-"));
    folders.push(directory);
    const stateFile = join(directory, "state.json");
    await Bun.write(stateFile, JSON.stringify({ version: 1, feedback: [], notes: [{ ...body(), id: "unfinished", createdAt: new Date().toISOString(), status: "transforming" }] }));
    const app = await appFor(undefined, stateFile);
    await waitUntil(() => app.snapshot("main").notes[0].status === "ready");
    expect(app.snapshot("main").notes).toHaveLength(1);
    const invalid = join(directory, "broken.json");
    await Bun.write(invalid, '{"version":1,"notes":"broken","feedback":[]}');
    expect(() => startServer({ port: 0, stateFile: invalid })).toThrow("Cannot load the live state file");
  });

  test("validates metadata, limits text, and blocks cross-origin mutations and remote hostnames", async () => {
    const app = await appFor();
    const cases = [
      { ...body(), thoughtNumber: 1.5 }, { ...body(), thoughtNumber: -1 },
      { ...body(), totalThoughts: 0 }, { ...body(), nextThoughtNeeded: "true" },
      { ...body(), original: " " }, { ...body(), original: "x".repeat(16_001) },
      { ...body(), sessionId: "../other" }, { ...body(), isRevision: true },
      { ...body(), needsMoreThoughts: "true" },
      { ...body(), branchId: "branch" }, { ...body(), branchFromThought: 1 },
    ];
    for (const input of cases) expect((await post(`${app.url}/api/notes`, input)).status).toBe(400);
    expect((await post(`${app.url}/api/notes`, body(), { Origin: "https://example.com" })).status).toBe(403);
    expect((await post(`${app.url}/api/notes`, body(), { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect((await fetch(`${app.url}/api/state`, { headers: { Host: "example.com" } })).status).toBe(403);
    expect((await post(`${app.url}/api/notes`, body(), { Origin: app.url })).status).toBe(202);
    expect((await post(`${app.url}/api/notes`, { ...body(), original: "x".repeat(50_000) })).status).toBe(413);
  });

  test("validates structured adapter results at the API boundary", async () => {
    const app = await appFor({ provider: "test", available: true, transform: async () => ({ title: "Wrong shape" } as Display) });
    await post(`${app.url}/api/notes`, body());
    await waitUntil(() => app.snapshot("main").notes[0].status === "error");
    expect(app.snapshot("main").notes[0].error).toContain("invalid response");
  });
});
