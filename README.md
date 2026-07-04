[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/thedotmack-sequential-thinking-skill-badge.png)](https://mseep.ai/app/thedotmack-sequential-thinking-skill)

<p align="center">
  <h1 align="center">sequential-thinking-skill</h1>
  <p align="center">
    Sequential thinking for Claude Code — no MCP server required.
    <br />
    <strong>Branch. Revise. Adapt. Think deeper.</strong>
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> &middot;
    <a href="#features">Features</a> &middot;
    <a href="#how-it-works">How It Works</a> &middot;
    <a href="#comparison">MCP vs sequential-thinking-skill</a>
  </p>
  <p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
    <img src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Claude_Code-skill-7C3AED.svg" alt="Claude Code Skill" />
  </p>
</p>

---

A **Claude Code skill** that replicates the [Sequential Thinking MCP server](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking) with full feature parity. No MCP infrastructure needed — just copy a folder and go.

Claude gains structured, multi-step reasoning with **branching**, **revision**, and **dynamic depth adjustment**, all tracked by a lightweight TypeScript state machine that persists to disk.

## Demo

Here's what structured thinking looks like in action:

```
💭 Thought 1/5
First, I need to clarify what type of auction we're dealing with.
I'll assume sealed-bid first-price unless told otherwise.
[1/5] history=1 next=true

🔄 Revision 3/5 (revising thought 1)
Wait — I assumed one format, but the question is generic.
I should cover multiple auction types. Changing approach.
[3/5] history=3 next=true

🌿 Branch 4/7 (from thought 2, ID: vickrey)
In a Vickrey auction, the dominant strategy is to bid your true
valuation regardless of the number of players. Exploring this path.
[4/7] history=4 branches=vickrey next=true
```

Each thought is a deliberate step — Claude can **revise** when assumptions are wrong, **branch** to explore alternatives, and **extend** when problems are deeper than expected.

## Features

- **Sequential numbered thoughts** — structured chain-of-thought with formatted output
- **Revisions** — reconsider and correct previous thoughts without losing the original
- **Branching** — explore alternative paths from any thought, tracked by branch ID
- **Dynamic depth** — adjust `totalThoughts` up or down as the problem unfolds
- **Hypothesis/verification loops** — generate and verify solutions iteratively
- **Persistent state** — history survives across invocations via JSON on disk
- **Full state inspection** — dump complete thought history and branch details at any point

## Quick Start

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [`tsx`](https://github.com/privatenumber/tsx) — available via `npx tsx` (no global install needed)

### Install

```bash
npx skills add https://github.com/thedotmack/sequential-thinking-skill --skill sequential-thinking
```

Or manually:

```bash
git clone https://github.com/thedotmack/sequential-thinking-skill.git
cp -r sequential-thinking-skill/sequential-thinking ~/.claude/skills/
```

That's it. The skill auto-activates when Claude detects problems that benefit from structured reasoning.

You can also trigger it explicitly with phrases like: *"think through this step by step"*, *"break this down"*, *"use sequential thinking"*.

## How It Works

The skill is powered by `think.ts`, a TypeScript state machine that:

1. Maintains an **append-only thought history** on disk (`.think_state.json`)
2. Tracks **branches** as named collections of thoughts forking from any point
3. Returns a **compact status line** to stdout after each thought (`[3/7] history=3 next=true`)
4. Renders **formatted thought headers** to stderr for visual feedback

Claude invokes it via `tsx scripts/think.ts` with CLI flags for each thought. The SKILL.md file instructs Claude on the protocol — when to branch, revise, extend, and terminate.

### Commands

| Command | Description |
|---------|-------------|
| `--reset` | Clear state for a new thinking session |
| `--thought "..." --thoughtNumber N --totalThoughts M --nextThoughtNeeded true/false` | Submit a thought |
| `--isRevision --revisesThought N` | Mark as revision of thought N |
| `--branchFromThought N --branchId "label"` | Branch from thought N |
| `--needsMoreThoughts` | Signal that more thoughts are needed |
| `--status` | Dump full state (history + branches) |

### Output

Every thought prints a header and content to stderr, plus a compact status line to stdout:

```
💭 Thought 4/7
In a Vickrey auction, the dominant strategy is...
[4/7] history=4 branches=vickrey,english next=true
```

The `--status` command returns full JSON with `fullHistory` and `branchDetails`.

## Comparison

How does sequential-thinking-skill compare to the official MCP server?

| | Sequential Thinking MCP | sequential-thinking-skill |
|---|---|---|
| **Setup** | Configure MCP server in `claude_desktop_config.json` | Copy a folder to `~/.claude/skills/` |
| **Runtime** | Requires running MCP server process | Standalone TypeScript script |
| **Dependencies** | `@modelcontextprotocol/sdk`, `zod` | `tsx` only |
| **State persistence** | In-memory (lost on restart) | JSON on disk (survives restarts) |
| **Features** | Thoughts, branches, revisions | Identical feature set |
| **State inspection** | Via MCP tool call | `--status` flag |
| **Integration** | MCP protocol | Claude Code skill protocol |

## Project Structure

```
sequential-thinking-skill/
├── sequential-thinking/
│   ├── SKILL.md                       # Skill definition and protocol
│   ├── scripts/
│   │   └── think.ts                   # TypeScript state machine
│   └── references/
│       └── example-session.md         # Worked example with all features
├── README.md
├── LICENSE
└── .gitignore
```

## License

[MIT](LICENSE)
