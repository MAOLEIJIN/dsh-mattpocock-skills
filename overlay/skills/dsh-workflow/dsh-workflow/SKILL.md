---
name: dsh-workflow
description: Map for using Matt Pocock's engineering skills inside DeepSeek Harness — which of the 36 skills the model may load itself, which are user-only, how the flows connect, and how they hand off to DSH's subagents, plan mode, goals and session commands. Load this before routing work through the mattpocock set, or when a Matt Pocock skill tells you to run something you cannot run.
---

# Matt Pocock's skills in DSH

This bundle ships Matt Pocock's engineering skills (`mattpocock/skills` 1.2.3, 35 skills) plus this map. The skills themselves are unchanged in substance; what this file adds is the part that differs between harnesses: **who is allowed to start a skill, and what a reference to another skill means here.**

## The one rule that changes behaviour

Upstream is written for a harness where the model can run `/name` as a command. In DSH that is false in two ways:

1. **`/name` is a user-facing slash command.** You cannot type it or execute it. A skill name in backticks is just a name: to act on it, call the `skill` tool with that exact name.
2. **User-only skills are hard-blocked for you.** DSH refuses to load any skill marked `disable-model-invocation: true`: `skill` returns `skill "<name>" is not available for model invocation`. That is not a policy you can talk your way around — the 20 user-only skills in this bundle cannot be loaded by you at all.

So when a flow needs a user-only skill, **name it and let the user invoke it** (or suggest they ask for it). Do not claim you ran it, and do not try to reproduce its 400 lines from memory: those skills are deliberately user-started because they open a fresh context window and keep the human driving.

If the user wants you to be able to load one of them, that is a configuration change, not a workaround: the plugin's `promote` list turns a user-only skill into a model-invocable one.

## Start here

- **`ask-matt`** — the router and flow map (user-only). It answers "which skill fits this?". Load `dsh-workflow` instead when the question is "how does this work *in DSH*".
- **`setup-matt-pocock-skills`** — the one prerequisite for the engineering flows (user-only): configures the issue tracker, triage labels and `CONTEXT.md`/ADR layout a repo needs. Three skills (`code-review`, `to-spec`, `to-tickets`, `wayfinder`, `triage`) depend on its output and now say so explicitly instead of telling you to run it.
- **[SKILLS.md](SKILLS.md)** — every skill with its invocation policy and what each one is for.
- **[DSH-MAPPING.md](DSH-MAPPING.md)** — upstream term → DSH equivalent, and the DSH features worth reaching for in each flow.

## How the flows land in DSH

The main flow (`grill-with-docs` → `to-spec` → `to-tickets` → `implement` → `code-review`) is intact, with these hand-offs rewritten:

| Flow step | Who runs it | What you do |
| --- | --- | --- |
| `grill-with-docs`, `grill-me`, `triage`, `wayfinder`, `implement`, `to-spec`, `to-tickets`, `handoff` | user-only | Name the skill when the moment arrives and let the user start it. Continue when they come back. |
| `grilling`, `domain-modeling`, `codebase-design`, `tdd`, `code-review`, `diagnosing-bugs`, `research`, `prototype`, `wizard`, `resolving-merge-conflicts`, `writing-for-agents`, `migrate-to-shoehorn`, `scaffold-exercises`, `setup-pre-commit` | you | Load with the `skill` tool and work the skill in this session. |
| Parallel review, research fan-out, design-it-twice | you | DSH's `subagent` tool (background, durable id, report back) or `workflow` for a real fan-out. See [DSH-MAPPING.md](DSH-MAPPING.md). |
| A fresh context window between tickets | user | Only the user starts a new session. Ask for it at the phase boundary the flow names. |
| `/compact` | user | The command exists in DSH; ask the user to run it, optionally with their instruction. |

Subagents keep the flow's "no context pollution" promise, and they are how several skills actually work (`code-review` runs Standards and Spec in parallel; `codebase-design`'s design-it-twice runs three or more). Give each subagent the brief the skill specifies, run them concurrently, and aggregate their reports yourself — the skill's own process stays the source of truth.

## Two things not to trust as written

- **`git-guardrails-claude-code`** installs a Claude Code hook that DSH never reads. Its body now says so at the top. For git safety in DSH, use a repo-level `pre-commit`/`pre-push` hook (`setup-pre-commit`) or DSH's permission settings — not a `.claude/settings.json` hook.
- **`claude-handoff`** described launching Claude Code's background CLI; its body now delegates with `subagent`/`subagent_fork` instead. The handoff *document* skill (`handoff`) is unaffected except that it now writes into the workspace rather than the OS temp directory, so a fresh session of yours can actually find the file.

Everything else is upstream text, with only its cross-skill references rewritten. `vendor/overlay/patches.json` in the plugin package lists every rewrite.
