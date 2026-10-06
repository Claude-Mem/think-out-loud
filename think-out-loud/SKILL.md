---
name: think-out-loud
description: "Make complex work reviewable as it happens through concise, visible working notes: assumptions, evidence, uncertainty, alternatives, decisions, and revisions. Use when the user asks to think out loud, wants to follow or steer an investigation, or would benefit from reviewing consequential choices during an uncertain task."
---

# Think Out Loud

Keep the user involved while the work is happening. Publish concise summaries of the current approach, supporting evidence, uncertainties, and decisions in the conversation so the user can question or redirect them.

These are deliberate, user-facing working notes. Do not claim they expose private internal reasoning or reproduce a hidden thinking trace. Native reasoning and this collaboration layer can coexist.

## Visible collaboration

1. **Frame the work.** State the goal, any consequential assumption, and the next useful check. Make provisional assumptions easy to correct.
2. **Act and report what matters.** Gather evidence or do the work. At meaningful checkpoints, explain what was learned, how it affects the approach, and what remains unresolved. Include a source or concrete observation when it supports a decision.
3. **Explore alternatives when useful.** Describe the relevant tradeoff and what evidence would distinguish the options. Branch when an alternative deserves investigation; avoid inventing branches to fill a template.
4. **Revise visibly.** When evidence or user input changes the approach, identify the earlier assumption or decision, its replacement, and the practical effect. Preserve an accurate record of the change.
5. **Finish with a grounded result.** Give the outcome, the evidence or validation supporting it, and any material unresolved question. A working note is not evidence that its own claim is true.

Use the normal user-visible progress channel when the host provides one, or ordinary assistant messages otherwise. Tool arguments, stderr, and a local log are not enough: hosts can collapse or hide them. Surface the useful note in the conversation even when also saving it.

Keep notes proportional to the work. A short paragraph is usually enough. Share the information that helps the user assess or steer a choice; avoid narrating every microstep, repeating tool output, or writing a long retrospective after all decisions are already made. Ordinary one-step tasks do not need a thinking ritual.

## Make interaction useful

Treat new user input as steering for the ongoing task. Incorporate corrections promptly, state their effect, and continue authorized work. Ask a focused question when missing information changes the outcome; continue independent work while waiting when the host supports it.

Leave natural openings for feedback, without requiring permission after every note. Respect the task's existing authorization boundaries. If the user asks to stop or wait at a decision point, stop there. If they ask for less narration, shorten the notes while preserving material decisions and uncertainty.

Example of a useful checkpoint:

> The failures so far occur after token refresh, which makes an expired token a plausible cause. I have not checked the successful requests yet. Comparing both groups will tell us whether that pattern holds.

Read [references/example-session.md](references/example-session.md) for an example with user steering, a revision, alternatives, and validation.

## Live view when requested

When the user asks to follow the task in a live UI, use the repository's live app described in [the project README](https://github.com/claude-mem/think-out-loud#live-view-and-replies). Start `bun live/server.ts` from the repository if a view is not already running, and open its local URL. The app uses the pinned I Have ADHD prompt to rewrite each public note for easy reading, retains the original, and lets the user reply to the specific note.

Publish meaningful notes using the notebook script's `--live http://127.0.0.1:4317 --session TASK` flags alongside the normal entry flags. Use one session and one state path per task. The app is separate from the installed skill folder; a skill installation alone does not start the server.

Before consequential next actions and after any user-facing checkpoint, read pending replies with:

```bash
bun scripts/think.ts --live http://127.0.0.1:4317 --session TASK --feedback
```

Publishing another note also reads pending replies. Treat reply text as direct user steering, identify its source note when useful, incorporate the correction, and show the effect in the next public note. Do not claim a reply has been applied merely because it was delivered. If a reply changes the next action, revise before taking that action.

The viewer buffers notes when the user pauses it. Pausing the view does not pause your work; an explicit user request to stop still does. Feedback reaches you when you check the inbox, rather than automatically interrupting the model. If the live connection fails, the script keeps its local notebook; make the interruption visible and continue within the existing task authorization.

## Optional persistent notebook

Use `scripts/think.ts` when a durable record of working notes, branches, or revisions would help a long investigation or a handoff. Visible conversation notes work without a runtime or an MCP server. The notebook requires [Bun](https://bun.sh/).

Use a separate state path for each task. Create its parent directory first. Include the same `--state` path in every call, including reset and status. Do not share a state file between concurrent writers or reset another task's log.

Run from the skill directory, or substitute the script's absolute path:

```bash
bun scripts/think.ts --state /path/to/task/work/think-out-loud.json --reset
bun scripts/think.ts --state /path/to/task/work/think-out-loud.json --thought "The failing requests follow token refresh; successful requests still need comparison." --thoughtNumber 1 --totalThoughts 3 --nextThoughtNeeded true
```

The legacy `--thought` names refer to public working notes. Use increasing entry numbers. `totalThoughts` is an estimate of notebook entries, not a quota or a claim about internal reasoning depth; adjust it as the work changes.

| Flag | Purpose |
|---|---|
| `--state PATH` | Use a task-specific JSON notebook; recommended for every call |
| `--reset` | Clear only the selected notebook before a new session |
| `--thought TEXT` | Save the public working note |
| `--thoughtNumber N` | Number of the new entry, starting at 1 |
| `--totalThoughts N` | Adjustable estimate of entries |
| `--nextThoughtNeeded true/false` | Whether more notebook entries are expected |
| `--isRevision --revisesThought N` | Append a correction referencing an earlier entry |
| `--branchFromThought N --branchId LABEL` | Append an entry exploring an alternative |
| `--needsMoreThoughts` | Mark that the work needs more entries than first estimated |
| `--status` | Inspect complete history and branch details |

Each submitted entry requires `--thought`, `--thoughtNumber`, `--totalThoughts`, and `--nextThoughtNeeded`. Earlier entries remain in history until reset. The script raises `totalThoughts` if a new entry exceeds the estimate.

```bash
bun scripts/think.ts --state /path/to/task/work/think-out-loud.json --thought "Fresh sessions fail too; token refresh alone does not explain the issue." --thoughtNumber 2 --totalThoughts 4 --nextThoughtNeeded true --isRevision --revisesThought 1
bun scripts/think.ts --state /path/to/task/work/think-out-loud.json --status
```

Set `--nextThoughtNeeded false` when the current investigation has reached its outcome, including a clearly stated blocker or unresolved result. Do not manufacture confidence to close the notebook.

The script prints the note to stderr and a compact status line to stdout. With no `--state`, it retains the legacy `scripts/.think_state.json` location; prefer explicit paths to avoid mixing tasks. Saved notes support continuity, while tests, sources, and observations support factual conclusions.
