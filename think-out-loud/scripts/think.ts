#!/usr/bin/env bun
/**
 * think-out-loud visible working notes.
 *
 * Keeps working notes, revisions, and branches as persistent state across invocations.
 * Returns progress after each entry so the work can be reviewed as it happens.
 * Use --state PATH for a per-task JSON log; create its parent directory first.
 * Without --state, the legacy script-relative .think_state.json is used.
 *
 * Usage:
 *   # Submit a visible working note
 *   bun think.ts --state /path/to/task/notes.json --thought "working note here" --thoughtNumber 1 --totalThoughts 5 --nextThoughtNeeded true
 *
 *   # Submit a revision
 *   bun think.ts --state /path/to/task/notes.json --thought "revised" --thoughtNumber 3 --totalThoughts 5 --nextThoughtNeeded true --isRevision --revisesThought 1
 *
 *   # Submit a branch
 *   bun think.ts --state /path/to/task/notes.json --thought "alt path" --thoughtNumber 4 --totalThoughts 7 --nextThoughtNeeded true --branchFromThought 2 --branchId alt-approach
 *
 *   # View current state
 *   bun think.ts --state /path/to/task/notes.json --status
 *
 *   # Reset the selected task log
 *   bun think.ts --state /path/to/task/notes.json --reset
 *
 *   # Publish a note to the local live UI; consume user replies before publishing
 *   bun think.ts --state /path/to/task/notes.json --live http://127.0.0.1:4317 --session task-name --thought "working note here" --thoughtNumber 1 --totalThoughts 5 --nextThoughtNeeded true
 *
 *   # Read replies independently without changing the notebook
 *   bun think.ts --live http://127.0.0.1:4317 --session task-name --feedback
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "util";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ThoughtData {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
}

interface State {
  thoughtHistory: ThoughtData[];
  branches: Record<string, ThoughtData[]>;
}

function loadState(): State {
  if (existsSync(STATE_FILE)) {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  }
  return { thoughtHistory: [], branches: {} };
}

function saveState(state: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function formatThought(t: ThoughtData): string {
  let header: string;

  if (t.isRevision && t.revisesThought != null) {
    header = `🔄 Revision ${t.thoughtNumber}/${t.totalThoughts} (revising thought ${t.revisesThought})`;
  } else if (t.branchFromThought != null && t.branchId != null) {
    header = `🌿 Branch ${t.thoughtNumber}/${t.totalThoughts} (from thought ${t.branchFromThought}, ID: ${t.branchId})`;
  } else {
    header = `💭 Thought ${t.thoughtNumber}/${t.totalThoughts}`;
  }

  return `${header}\n${t.thought}`;
}

function makeStatusResponse(state: State) {
  const branchIds = Object.keys(state.branches);
  const historyLength = state.thoughtHistory.length;

  if (historyLength === 0) {
    return {
      thoughtNumber: 0,
      totalThoughts: 0,
      nextThoughtNeeded: true,
      branches: branchIds,
      thoughtHistoryLength: historyLength,
    };
  }

  const latest = state.thoughtHistory[historyLength - 1];
  return {
    thoughtNumber: latest.thoughtNumber,
    totalThoughts: latest.totalThoughts,
    nextThoughtNeeded: latest.nextThoughtNeeded,
    branches: branchIds,
    thoughtHistoryLength: historyLength,
  };
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function liveURL(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("--live must be an HTTP(S) URL on localhost or 127.0.0.1");
  }
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.username || url.password) {
    fail("--live must be an HTTP(S) URL on localhost or 127.0.0.1 without credentials");
  }
  return url;
}

async function liveRequest(url: URL, path: string, body: unknown): Promise<any> {
  const response = await fetch(new URL(path, url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`server returned HTTP ${response.status}`);
  return response.json();
}

async function consumeFeedback(url: URL, sessionId: string, showEmpty = false): Promise<void> {
  const result = await liveRequest(url, "/api/feedback/consume", { sessionId });
  if (!result || !Array.isArray(result.feedback) || result.feedback.some((reply: any) =>
    !reply || typeof reply.id !== "string" || typeof reply.noteId !== "string" ||
    typeof reply.text !== "string" || reply.sessionId !== sessionId)) {
    throw new Error("server returned an invalid feedback response");
  }
  if (showEmpty || result.feedback.length > 0) {
    console.log("User feedback for this task");
    console.log(JSON.stringify(result, null, 2));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Parse CLI args ---

const { values } = parseArgs({
  options: {
    state: { type: "string" },
    live: { type: "string" },
    session: { type: "string", default: "main" },
    feedback: { type: "boolean", default: false },
    thought: { type: "string" },
    thoughtNumber: { type: "string" },
    totalThoughts: { type: "string" },
    nextThoughtNeeded: { type: "string" },
    isRevision: { type: "boolean", default: false },
    revisesThought: { type: "string" },
    branchFromThought: { type: "string" },
    branchId: { type: "string" },
    needsMoreThoughts: { type: "boolean", default: false },
    status: { type: "boolean", default: false },
    reset: { type: "boolean", default: false },
  },
  strict: true,
});

const STATE_FILE = values.state ?? join(__dirname, ".think_state.json");

// --- Commands ---

if (values.reset) {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
  console.log(JSON.stringify({ status: "reset", message: "Thinking session cleared" }, null, 2));
  process.exit(0);
}

if (values.feedback && !values.status) {
  if (!values.live) fail("--feedback requires --live");
  const url = liveURL(values.live);
  if (!values.session.trim()) fail("--session must not be empty");
  try {
    await consumeFeedback(url, values.session, true);
  } catch (error) {
    fail(`Live feedback could not be checked: ${errorMessage(error)}`);
  }
  process.exit(0);
}

const state = loadState();

if (values.status) {
  const response = {
    ...makeStatusResponse(state),
    fullHistory: state.thoughtHistory,
    branchDetails: state.branches,
  };
  console.log(JSON.stringify(response, null, 2));
  process.exit(0);
}

const live = values.live ? liveURL(values.live) : undefined;
if (live && !values.session.trim()) fail("--session must not be empty");

// --- Validate required fields ---

if (!values.thought) fail("--thought is required");
if (!values.thoughtNumber) fail("--thoughtNumber is required");
if (!values.totalThoughts) fail("--totalThoughts is required");
if (!values.nextThoughtNeeded) fail("--nextThoughtNeeded is required");

const thoughtNumber = parseInt(values.thoughtNumber, 10);
let totalThoughts = parseInt(values.totalThoughts, 10);
const nextThoughtNeeded = values.nextThoughtNeeded.toLowerCase() === "true";

if (isNaN(thoughtNumber) || thoughtNumber < 1) fail("--thoughtNumber must be an integer >= 1");
if (isNaN(totalThoughts) || totalThoughts < 1) fail("--totalThoughts must be an integer >= 1");

// Auto-adjust
if (thoughtNumber > totalThoughts) {
  totalThoughts = thoughtNumber;
}

const thoughtData: ThoughtData = {
  thought: values.thought,
  thoughtNumber,
  totalThoughts,
  nextThoughtNeeded,
};

if (values.isRevision) {
  if (!values.revisesThought) fail("--revisesThought is required when --isRevision is set");
  const revisesThought = parseInt(values.revisesThought, 10);
  if (isNaN(revisesThought) || revisesThought < 1) fail("--revisesThought must be an integer >= 1");
  thoughtData.isRevision = true;
  thoughtData.revisesThought = revisesThought;
}

if (values.branchFromThought != null) {
  if (!values.branchId) fail("--branchId is required when --branchFromThought is set");
  const branchFrom = parseInt(values.branchFromThought, 10);
  if (isNaN(branchFrom) || branchFrom < 1) fail("--branchFromThought must be an integer >= 1");
  thoughtData.branchFromThought = branchFrom;
  thoughtData.branchId = values.branchId;
}

if (values.needsMoreThoughts) {
  thoughtData.needsMoreThoughts = true;
}

// --- Append to history (never delete, only append) ---

state.thoughtHistory.push(thoughtData);

// --- Track branches ---

if (thoughtData.branchFromThought != null && thoughtData.branchId != null) {
  if (!state.branches[thoughtData.branchId]) {
    state.branches[thoughtData.branchId] = [];
  }
  state.branches[thoughtData.branchId].push(thoughtData);
}

saveState(state);

// Visible working note → stderr
console.error(formatThought(thoughtData));

// Compact progress → stdout
const status = makeStatusResponse(state);
const branchList = status.branches.length > 0 ? ` branches=${status.branches.join(",")}` : "";
console.log(`[${status.thoughtNumber}/${status.totalThoughts}] history=${status.thoughtHistoryLength}${branchList} next=${status.nextThoughtNeeded}`);

if (live) {
  try {
    await consumeFeedback(live, values.session);
  } catch (error) {
    console.error(`Warning: Live feedback could not be checked: ${errorMessage(error)}. The note is saved locally.`);
  }
  try {
    const { thought, ...metadata } = thoughtData;
    const id = randomUUID();
    const result = await liveRequest(live, "/api/notes", {
      id,
      sessionId: values.session,
      original: thought,
      ...metadata,
    });
    if (!result?.note || result.note.id !== id) {
      throw new Error("server returned an invalid note response");
    }
    const link = new URL("/", live);
    link.searchParams.set("session", values.session);
    console.error(`Live note: ${link.href}`);
  } catch (error) {
    console.error(`Warning: Public feed unreachable: ${errorMessage(error)}. The note is saved locally.`);
  }
}
