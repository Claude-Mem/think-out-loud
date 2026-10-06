# How thinking became native and visibility became optional

Research checked October 6, 2026. This history separates documented changes from explanations we can only infer.

## Four different things called “thinking”

| Layer | What it means |
|---|---|
| Model reasoning | Internal computation and, for some models, private reasoning tokens |
| Provider output | Raw thinking text, a generated summary, or no visible thinking text, depending on the model and API |
| Product display | Whether an app shows, collapses, or omits the returned text |
| Collaborative working notes | Explanations deliberately written in the conversation so a person can assess and steer the work |

`think-out-loud` works at the fourth layer. Hiding a display does not by itself establish that the model reasoned less. A skill cannot guarantee access to private internals.

## Timeline

| Date | What changed | Primary source |
|---|---|---|
| September 12, 2024 | OpenAI explained its decision to keep o1's raw chain of thought private. | [Learning to reason with LLMs](https://openai.com/index/learning-to-reason-with-llms/) |
| November 25, 2024 | Anthropic launched MCP as a protocol for connecting assistants to external systems. | [MCP announcement](https://www.anthropic.com/news/model-context-protocol) |
| November 27, 2024 | Pietro Schirano added the Sequential Thinking reference server. Numbered entries, revisions, branches, and adjustable totals were already in its original design. | [Original commit](https://github.com/modelcontextprotocol/servers/commit/9d88abff0d96e13870692f24d119cec00e70ae13) |
| February 24, 2025 | Anthropic released Claude 3.7's raw visible extended thinking as a research preview, with caveats about safety and faithfulness. | [Visible extended thinking](https://www.anthropic.com/news/visible-extended-thinking) |
| March 20, 2025 | Anthropic published a separate `think` tool: a scratchpad for reconsidering information during tool workflows. | [Think-tool article](https://www.anthropic.com/engineering/claude-think-tool) |
| April 16, 2025 | OpenAI's o3/o4-mini release described reasoning summaries and reasoning with tool use. | [o3 and o4-mini](https://openai.com/index/introducing-o3-and-o4-mini/) |
| May 22, 2025 | Claude 4 introduced thinking summaries produced by a smaller model and thinking interleaved with tool calls. | [Claude 4 announcement](https://www.anthropic.com/news/claude-4) |
| September 29–30, 2025 | Claude Code users reported losing useful thinking visibility in v2.0 and asked to restore easier access. These are firsthand user reports. | [Issue #8371](https://github.com/anthropics/claude-code/issues/8371), [issue #8477](https://github.com/anthropics/claude-code/issues/8477) |
| December 15, 2025 | Anthropic updated the think-tool article to recommend native extended thinking instead of a dedicated think tool in most cases, citing integration and performance. | [Dated editorial update](https://www.anthropic.com/engineering/claude-think-tool) |
| April 1, 2026 | Claude Code v2.1.89 documented that interactive sessions no longer generate thinking summaries by default; `showThinkingSummaries: true` opts in. | [Release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.89) |
| April 6, 2026 | Boris Cherny distinguished UI summary redaction from model thinking allocation, explaining the latency benefit and separately identifying adaptive-thinking and effort-default changes. | [Firsthand response](https://news.ycombinator.com/item?id=47664442) |
| August 31, 2026 | The official MCP repository released Sequential Thinking again. It remains in the active reference-server list. | [Release](https://github.com/modelcontextprotocol/servers/releases/tag/2026.8.31), [repository](https://github.com/modelcontextprotocol/servers) |

## Why vendors hide or summarize thinking

The reasons vary. OpenAI's o1 explanation cites keeping raw reasoning available for monitoring, allowing that reasoning to remain unconstrained, user experience, and competitive considerations. This was a deliberate output decision, not the removal of reasoning. [OpenAI's explanation](https://openai.com/index/learning-to-reason-with-llms/)

Anthropic initially treated raw visibility as a research opportunity, while acknowledging that the text might not reveal all influences on behavior. Claude 4 later condensed longer thinking with a smaller summarizing model. The April 2026 Claude Code response describes reducing the latency of generated summaries. These are separate changes to model output and product presentation. [Research-preview caveats](https://www.anthropic.com/news/visible-extended-thinking), [Claude 4 summaries](https://www.anthropic.com/news/claude-4), [Claude Code response](https://news.ycombinator.com/item?id=47664442)

The user complaints identify a distinct cost: reduced visibility made it harder to understand and redirect an assistant during a task. That is evidence of a collaboration problem, not a controlled measurement of model quality. [Firsthand steering complaint](https://github.com/anthropics/claude-code/issues/8477)

## What Sequential Thinking actually does

The model supplies the text. The reference server stores entries and branch metadata, adjusts the estimated total when needed, optionally formats logs, and returns progress counters. It does not run a separate reasoning model, search alternatives algorithmically, verify the truth of entries, or expose hidden model state. The host determines whether tool arguments and logs are visible. [Current implementation](https://github.com/modelcontextprotocol/servers/blob/main/src/sequentialthinking/lib.ts)

The project evolved through logging controls, validation, tests, and SDK updates. It has not been retired. Its original branching and revision design also means “sequential” was never limited to a straight line of steps. [Source history](https://github.com/modelcontextprotocol/servers/commits/main/src/sequentialthinking/index.ts), [original design](https://github.com/modelcontextprotocol/servers/commit/9d88abff0d96e13870692f24d119cec00e70ae13)

## Was it forgotten because reasoning became built in?

**The strongest evidence supports reduced need for a separate scratchpad, not disappearance of this MCP.** Anthropic's December 2025 recommendation directly favors native extended thinking in most cases. Interleaved thinking also brought an important function of external scratchpads into the model's tool workflow. [Native-thinking recommendation](https://www.anthropic.com/engineering/claude-think-tool), [interleaved tool use](https://www.anthropic.com/news/claude-4)

Other possible contributors are installation friction, registry discoverability, extra calls, and context overhead. These remain explanations to investigate. A historical registry complaint and a contributor's schema-size measurement document particular friction points; neither establishes an adoption decline or proves why people stopped discussing the tool. [Registry report](https://github.com/modelcontextprotocol/servers/issues/2820), [schema measurement](https://github.com/modelcontextprotocol/modelcontextprotocol/discussions/2812)

We found no adoption time series proving that Sequential Thinking was broadly forgotten, and no evidence that labs embedded this specific MCP server into their models. Related ideas, including intermediate steps and exploring alternatives, predate MCP. [Chain-of-Thought paper](https://arxiv.org/abs/2201.11903), [Tree of Thoughts paper](https://arxiv.org/abs/2305.10601)

## What this means for think-out-loud

The purpose is an explicit collaboration surface: useful working notes before decisions are complete. A person can review assumptions, challenge evidence, correct the direction, and see the resulting revision. That purpose remains valuable alongside native reasoning, regardless of whether a provider returns thinking summaries.
