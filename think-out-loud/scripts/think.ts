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
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
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

// --- Parse CLI args ---

const { values } = parseArgs({
  options: {
    state: { type: "string" },
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
