# think-out-loud

**Thinking should be a conversation you can join.**

A skill for active thinking out loud: visible assumptions, evidence, uncertainty, alternatives, decisions, and revisions while the work happens. Read it, question it, interrupt it, and steer it.

Inspired by the [Sequential Thinking MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking), and by the frustration of losing useful visibility when a coding assistant hides its thinking display.

## What it feels like

**Assistant:** The failures so far happen after token refresh. An expired token is a plausible cause; I still need to compare successful requests.

**You:** It also happens immediately after a fresh login.

**Assistant:** That changes the hypothesis. Token refresh alone cannot explain it. I’ll compare fresh sessions too and check whether the requests reach the server.

**Assistant:** Fresh-session failures stop before the network request; the captured trace points to client validation. I’ll check that validation path and test the reported inputs.

The useful part is the opportunity to change the investigation before the answer is finished. See the [worked example](think-out-loud/references/example-session.md).

## Install

```bash
npx skills add https://github.com/claude-mem/think-out-loud --skill think-out-loud
```

Or install manually for Claude Code:

```bash
git clone https://github.com/claude-mem/think-out-loud.git
mkdir -p ~/.claude/skills
cp -R think-out-loud/think-out-loud ~/.claude/skills/
```

For Codex, copy the same skill folder into `~/.codex/skills/`.

Ask: **“Use think-out-loud while investigating this. Show me the assumptions and decision points so I can steer.”** In Claude Code you can invoke `/think-out-loud`; in Codex, use `$think-out-loud`.

The skill instructions work without an MCP server or a runtime. The optional notebook script requires [Bun](https://bun.sh/).

## What the skill does

- Publishes short working notes directly in the conversation.
- Connects observations to the decisions they affect.
- Makes uncertain assumptions and useful alternatives reviewable.
- Incorporates user corrections while the task is in progress.
- Records revisions and branches when a persistent notebook is useful.
- Finishes with the result, validation, and material open questions.

These notes are written for collaboration. They do not expose private internal reasoning or guarantee that a transcript faithfully represents the model's internal process. Showing a note does not establish its truth; the work still needs sources, observations, or tests.

## Why this name, now?

This project began as `sequential-thinking-skill`. Its first focus was reproducing the MCP's numbered entries, revisions, branches, and adjustable estimates with a local script.

The rebrand puts the human interaction first. Native reasoning can do more inside the model, while product interfaces can show less of the process. A useful collaboration skill makes consequential choices visible in the conversation, where a person can respond.

The history supports a more precise story than “Sequential Thinking was forgotten.” The official MCP remains maintained. In December 2025, Anthropic updated its separate think-tool article to recommend native extended thinking for most cases. That helps explain why a separate scratchpad may feel less necessary; it does not establish that this particular MCP was built into models or that its adoption declined. [Anthropic's update](https://www.anthropic.com/engineering/claude-think-tool), [official MCP repository](https://github.com/modelcontextprotocol/servers).

Read [HISTORY.md](HISTORY.md) for the sourced timeline, changes to thinking displays, and the limits of the “forgotten” explanation.

## Optional notebook

The inherited `think.ts` script keeps a JSON history of public working notes. Use a different state file for each task, with an existing parent directory:

```bash
mkdir -p work
bun think-out-loud/scripts/think.ts --state work/investigation.json --reset
bun think-out-loud/scripts/think.ts --state work/investigation.json --thought "Fresh sessions fail before the request reaches the server; checking client validation next." --thoughtNumber 1 --totalThoughts 3 --nextThoughtNeeded true
bun think-out-loud/scripts/think.ts --state work/investigation.json --status
```

The notebook retains the original flags for revisions, branches, and extending the estimate. See [SKILL.md](think-out-loud/SKILL.md) for the commands. Tool output can be collapsed by the host, so the skill also puts useful notes directly in the chat.

| Capability | Sequential Thinking MCP | think-out-loud |
|---|---|---|
| Interaction | Model submits structured tool entries | Assistant publishes working notes for user review and steering |
| Revisions and branches | Tool fields record them | Conversation can show them; optional script records them |
| Storage | Reference server keeps in-memory state | Optional JSON notebook persists between invocations |
| Setup | MCP client and server | Skill folder; Bun only for the optional notebook |
| Visibility | Depends on how the host displays tool arguments and logs | Skill asks for notes in the user-visible conversation |

## Existing users

Install `think-out-loud` using the new URL. If you manually installed the old `sequential-thinking` folder, remove that copy once you have moved any notebook you want to keep; leaving both installed can create duplicate guidance. Existing script flags and the default `.think_state.json` behavior remain supported.

## License

[MIT](LICENSE). The original Git history and license are retained.
