import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createClaudeAdapter, parseDisplay, RewriteError, type Display, type RewriteInput, type ThoughtAdapter } from "./adapter";

export interface Note extends RewriteInput {
  id: string;
  sessionId: string;
  createdAt: string;
  status: "transforming" | "ready" | "error";
  display?: Display;
  error?: string;
}

export interface Reply {
  id: string;
  noteId: string;
  sessionId: string;
  text: string;
  createdAt: string;
  deliveredAt?: string;
}

interface State {
  version: 1;
  notes: Note[];
  feedback: Reply[];
}

class RequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const maxBodyBytes = 40_000;
const maxPending = 100;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

function identifier(value: unknown, field: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new RequestError(`${field} must be 1–80 letters, numbers, periods, underscores or hyphens.`);
  }
  return value;
}

function stringField(value: unknown, field: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new RequestError(`${field} must be nonempty text, at most ${limit} characters.`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1_000_000) {
    throw new RequestError(`${field} must be an integer from 1 to 1000000.`);
  }
  return value as number;
}

function validateInput(value: unknown): RewriteInput & { sessionId: string; id?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("Expected a JSON object.");
  const input = value as Record<string, unknown>;
  if (typeof input.nextThoughtNeeded !== "boolean") throw new RequestError("nextThoughtNeeded must be true or false.");
  const note: RewriteInput & { sessionId: string; id?: string } = {
    original: stringField(input.original, "original", 16_000),
    sessionId: identifier(input.sessionId ?? "main", "sessionId"),
    thoughtNumber: positiveInteger(input.thoughtNumber, "thoughtNumber"),
    totalThoughts: positiveInteger(input.totalThoughts, "totalThoughts"),
    nextThoughtNeeded: input.nextThoughtNeeded,
  };
  if (note.thoughtNumber > note.totalThoughts) throw new RequestError("totalThoughts must be at least thoughtNumber.");
  if (input.id !== undefined) note.id = identifier(input.id, "id");
  if (input.isRevision !== undefined) {
    if (typeof input.isRevision !== "boolean") throw new RequestError("isRevision must be true or false.");
    note.isRevision = input.isRevision;
  }
  if (input.needsMoreThoughts !== undefined) {
    if (typeof input.needsMoreThoughts !== "boolean") throw new RequestError("needsMoreThoughts must be true or false.");
    note.needsMoreThoughts = input.needsMoreThoughts;
  }
  if (input.revisesThought !== undefined) note.revisesThought = positiveInteger(input.revisesThought, "revisesThought");
  if (note.isRevision && note.revisesThought === undefined) throw new RequestError("A revision must include revisesThought.");
  if (input.branchId !== undefined) note.branchId = identifier(input.branchId, "branchId");
  if (input.branchFromThought !== undefined) note.branchFromThought = positiveInteger(input.branchFromThought, "branchFromThought");
  if ((note.branchId === undefined) !== (note.branchFromThought === undefined)) {
    throw new RequestError("A branch must include both branchId and branchFromThought.");
  }
  return note;
}

async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RequestError("Use Content-Type: application/json.", 415);
  }
  if (Number(request.headers.get("content-length")) > maxBodyBytes) throw new RequestError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Expected a JSON body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel();
        throw new RequestError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new RequestError("Expected valid JSON."); }
}

function loadState(path: string): State {
  if (!existsSync(path)) return { version: 1, notes: [], feedback: [] };
  try {
    const saved = JSON.parse(readFileSync(path, "utf8"));
    if (saved.version !== 1 || !Array.isArray(saved.notes) || !Array.isArray(saved.feedback)) throw new Error();
    const notes: Note[] = saved.notes.map((note: any) => {
      const input = validateInput(note);
      if (!input.id || !["ready", "error", "transforming"].includes(note.status) || !Number.isFinite(Date.parse(note.createdAt))) throw new Error();
      if (note.status === "ready" && !note.display) throw new Error();
      return {
        ...input, id: input.id, createdAt: note.createdAt, status: note.status,
        ...(note.display ? { display: parseDisplay(note.display) } : {}),
        ...(note.error ? { error: stringField(note.error, "error", 1000) } : {}),
      };
    });
    if (new Set(notes.map(note => note.id)).size !== notes.length) throw new Error();
    const feedback: Reply[] = saved.feedback.map((reply: any) => {
      const noteId = identifier(reply.noteId, "noteId");
      const sessionId = identifier(reply.sessionId, "sessionId");
      if (!notes.some(note => note.id === noteId && note.sessionId === sessionId) || !Number.isFinite(Date.parse(reply.createdAt))) throw new Error();
      if (reply.deliveredAt !== undefined && !Number.isFinite(Date.parse(reply.deliveredAt))) throw new Error();
      return {
        id: identifier(reply.id, "id"), noteId, sessionId,
        text: stringField(reply.text, "text", 8000), createdAt: reply.createdAt,
        ...(reply.deliveredAt ? { deliveredAt: reply.deliveredAt } : {}),
      };
    });
    return { version: 1, notes, feedback };
  } catch {
    throw new Error("Cannot load the live state file. Preserve it and select a new state file or restore valid JSON.");
  }
}

export function startServer(options: {
  port?: number;
  stateFile?: string;
  publicDir?: string;
  adapter?: ThoughtAdapter;
  heartbeatMs?: number;
} = {}) {
  const repoRoot = resolve(import.meta.dir, "..");
  const stateFile = options.stateFile ?? process.env.THINK_OUT_LOUD_STATE ?? join(repoRoot, ".local/live-state.json");
  const publicDir = options.publicDir ?? join(import.meta.dir, "public");
  const adapter = options.adapter ?? createClaudeAdapter({ repoRoot });
  const state = loadState(stateFile);
  const clients = new Map<ReadableStreamDefaultController<Uint8Array>, string>();
  const encoder = new TextEncoder();
  const queue: string[] = [];
  const queued = new Set<string>();
  let active = false;
  let stopped = false;

  function persist() {
    mkdirSync(dirname(stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, stateFile);
  }

  function snapshot(sessionId: string) {
    return {
      notes: state.notes.filter(note => note.sessionId === sessionId),
      feedback: state.feedback.filter(reply => reply.sessionId === sessionId),
      adapter: { provider: adapter.provider, available: adapter.available },
    };
  }

  function broadcast(sessionId: string) {
    const message = encoder.encode(`event: state\ndata: ${JSON.stringify(snapshot(sessionId))}\n\n`);
    for (const [client, session] of clients) {
      if (session !== sessionId) continue;
      try { client.enqueue(message); } catch { clients.delete(client); }
    }
  }

  async function drain() {
    if (active || stopped) return;
    active = true;
    try {
      while (queue.length && !stopped) {
        const id = queue.shift()!;
        const note = state.notes.find(note => note.id === id)!;
        try {
          note.display = parseDisplay(await adapter.transform(note));
          note.status = "ready";
          delete note.error;
        } catch (error) {
          note.status = "error";
          delete note.display;
          note.error = error instanceof RewriteError ? error.message : "The rewrite could not complete. The original note is available below. Retry to try again.";
        }
        queued.delete(id);
        try { persist(); }
        catch {
          // Keep the accepted source note on disk and report that its new result was not saved.
          note.status = "error";
          delete note.display;
          note.error = "The rewrite result could not be saved. Check the local state file permissions, then retry. The original note is available below.";
        }
        broadcast(note.sessionId);
      }
    } finally {
      active = false;
    }
  }

  function enqueue(note: Note) {
    if (queued.has(note.id)) return;
    queued.add(note.id);
    queue.push(note.id);
    void drain();
  }

  const securityHeaders = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: securityHeaders });

  function guard(request: Request, url: URL) {
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new RequestError("This service accepts localhost requests only.", 403);
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new RequestError("Use this app's local page to send requests.", 403);
      }
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? Number(process.env.PORT ?? 4317),
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      try {
        guard(request, url);
        const sessionId = identifier(url.searchParams.get("session") ?? "main", "session");
        if (request.method === "GET" && url.pathname === "/api/health") {
          return json({ ok: true, adapter: { provider: adapter.provider, available: adapter.available } });
        }
        if (request.method === "GET" && url.pathname === "/api/state") return json(snapshot(sessionId));
        if (request.method === "GET" && url.pathname === "/api/events") {
          let controller: ReadableStreamDefaultController<Uint8Array>;
          const stream = new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
              clients.set(value, sessionId);
              value.enqueue(encoder.encode(`retry: 1500\nevent: state\ndata: ${JSON.stringify(snapshot(sessionId))}\n\n`));
            },
            cancel() { clients.delete(controller); },
          });
          request.signal.addEventListener("abort", () => {
            clients.delete(controller);
            try { controller.close(); } catch { /* already closed */ }
          }, { once: true });
          return new Response(stream, { headers: { ...securityHeaders, "Content-Type": "text/event-stream", "Connection": "keep-alive", "X-Accel-Buffering": "no" } });
        }
        if (request.method === "POST" && url.pathname === "/api/notes") {
          const input = validateInput(await jsonBody(request));
          if (input.id) {
            const existing = state.notes.find(note => note.id === input.id);
            if (existing) {
              const comparable = validateInput(existing);
              if (JSON.stringify(comparable) !== JSON.stringify(input)) throw new RequestError("That id belongs to a different note.", 409);
              return json({ note: existing }, 202);
            }
          }
          if (queued.size >= maxPending) throw new RequestError("The rewrite queue is full. Wait for a note to finish, then retry.", 429);
          const note: Note = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: new Date().toISOString(), status: "transforming" };
          state.notes.push(note);
          try { persist(); } catch { state.notes.pop(); throw new RequestError("The note could not be saved. Check local state file permissions.", 500); }
          broadcast(note.sessionId);
          // Start after constructing the response so the accepted state is stable.
          const response = json({ note }, 202);
          enqueue(note);
          return response;
        }
        const noteRoute = url.pathname.match(/^\/api\/notes\/([^/]+)\/(replies|retry)$/);
        if (request.method === "POST" && noteRoute) {
          const noteId = identifier(noteRoute[1], "noteId");
          const note = state.notes.find(note => note.id === noteId);
          if (!note) throw new RequestError("Note not found.", 404);
          if (noteRoute[2] === "retry") {
            if (note.status !== "error") throw new RequestError("Only failed rewrites can be retried.", 409);
            if (queued.size >= maxPending) throw new RequestError("The rewrite queue is full. Wait for a note to finish, then retry.", 429);
            const previousError = note.error;
            note.status = "transforming";
            delete note.error;
            try { persist(); } catch { note.status = "error"; note.error = previousError; throw new RequestError("The retry could not be saved.", 500); }
            broadcast(note.sessionId);
            const response = json({ note }, 202);
            enqueue(note);
            return response;
          }
          const input = await jsonBody(request) as any;
          const text = stringField(input?.text, "text", 8000);
          const reply: Reply = { id: crypto.randomUUID(), noteId: note.id, sessionId: note.sessionId, text, createdAt: new Date().toISOString() };
          state.feedback.push(reply);
          try { persist(); } catch { state.feedback.pop(); throw new RequestError("The reply could not be saved.", 500); }
          broadcast(note.sessionId);
          return json({ reply }, 201);
        }
        if (request.method === "POST" && url.pathname === "/api/feedback/consume") {
          const input = await jsonBody(request) as any;
          const session = identifier(input?.sessionId ?? "main", "sessionId");
          const pending = state.feedback.filter(reply => reply.sessionId === session && !reply.deliveredAt);
          const deliveredAt = new Date().toISOString();
          for (const reply of pending) reply.deliveredAt = deliveredAt;
          try { persist(); } catch {
            for (const reply of pending) delete reply.deliveredAt;
            throw new RequestError("The replies could not be marked as delivered. Retry to retrieve them.", 500);
          }
          if (pending.length) broadcast(session);
          return json({ feedback: pending.map(reply => {
            const note = state.notes.find(note => note.id === reply.noteId)!;
            return { ...reply, original: note.original, thoughtNumber: note.thoughtNumber, totalThoughts: note.totalThoughts };
          }) });
        }
        if (request.method === "GET" || request.method === "HEAD") {
          const files: Record<string, { path: string; type: string }> = {
            "/": { path: "index.html", type: "text/html; charset=utf-8" },
            "/index.html": { path: "index.html", type: "text/html; charset=utf-8" },
            "/app.js": { path: "app.js", type: "text/javascript; charset=utf-8" },
            "/styles.css": { path: "styles.css", type: "text/css; charset=utf-8" },
          };
          const selected = files[url.pathname];
          if (selected) {
            const file = Bun.file(join(publicDir, selected.path));
            if (await file.exists()) return new Response(request.method === "HEAD" ? null : file, { headers: { ...securityHeaders, "Content-Type": selected.type } });
          }
        }
        return json({ error: "Not found." }, 404);
      } catch (error) {
        if (error instanceof RequestError) return json({ error: error.message }, error.status);
        return json({ error: "The request could not complete. Please retry." }, 500);
      }
    },
  });

  const heartbeat = setInterval(() => {
    for (const [client] of clients) {
      try { client.enqueue(encoder.encode(": heartbeat\n\n")); } catch { clients.delete(client); }
    }
  }, options.heartbeatMs ?? 15_000);
  heartbeat.unref();
  for (const note of state.notes) if (note.status === "transforming") enqueue(note);

  return {
    server,
    url: `http://127.0.0.1:${server.port}`,
    stateFile,
    snapshot,
    async stop() {
      stopped = true;
      clearInterval(heartbeat);
      for (const [client] of clients) {
        try { client.close(); } catch { /* already closed */ }
      }
      clients.clear();
      await server.stop(true);
    },
  };
}

if (import.meta.main) {
  try {
    const app = startServer();
    console.log(`Think out loud is live at ${app.url}`);
    const close = async () => { await app.stop(); process.exit(0); };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Could not start the local thought stream.");
    process.exit(1);
  }
}
