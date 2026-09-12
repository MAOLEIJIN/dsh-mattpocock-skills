# Upstream → DSH

The vocabulary translation the skills assume, and the DSH features worth reaching for in each flow.
Upstream is written for a harness whose conventions differ; the overlay rewrites the places where that
would have changed behaviour, and this file is the short version of the same map.

## Translation table

| Upstream says | In DSH |
| --- | --- |
| `` `/grilling` `` (a command you run) | the skill named `grilling` — load it with the `skill` tool |
| "run `/setup-matt-pocock-skills`" | that skill is **user-only**: ask the user to start it; you cannot load it |
| `/clear` | a fresh session — only the user starts one (`/clear` does not exist in DSH) |
| `/compact [instruction]` | the `/compact` command, run by the user; ask for it in those words |
| "a sub-agent" / "a background agent" | the `subagent` tool (background, durable id, report back) or `subagent_fork` to inherit this conversation |
| "spawn 3+ sub-agents in parallel" | several `subagent` calls in one message, or the `workflow` tool for a real fan-out with phases and structured results |
| "the receiving session opens a file" | a fresh DSH session whose cwd is the workspace — so handoff files belong in the repo, not `/tmp` |
| `CLAUDE.md` (first choice) | `AGENTS.md` is read first; `CLAUDE.md` is the fallback, and both still work |
| `.claude/settings.json` hooks | **not read by DSH.** Use repo git hooks (`setup-pre-commit`) or DSH's permission settings |
| "ask the user" | the `ask_user_question` tool when you want a structured choice; plain prose otherwise |
| TodoWrite-style checklists | the `todo_write` tool |
| "the issue tracker" | unchanged: `docs/agents/issue-tracker.md` in the repo, GitHub/GitLab via `gh`/`glab`, or local markdown under `.scratch/` |
| `CONTEXT.md`, `docs/adr/`, `.out-of-scope/`, `docs/agents/` | unchanged — these are repo conventions, not harness features |

## DSH features that fit these flows

- **`subagent`** — the workhorse. Runs in its own context window in this workspace and returns a report, which is exactly what `code-review` (two axes), `codebase-design`'s design-it-twice (three or more alternatives) and `research` (fan-out per ticket) ask for. Start them in one message so they run concurrently; each returns a durable id you can follow up with.
- **`workflow`** — when the fan-out is large or multi-stage (a research ticket per branch, a sweep over many files), it coordinates many subagents with phases instead of you hand-managing them.
- **`subagent_fork`** — inherits this conversation. Use it when the child must know what was already decided, which the flows otherwise pay for with a handoff document.
- **Plan mode** — `to-spec` and `wayfinder` produce a plan before anything is built; plan mode is how that conversation stays a proposal until the user approves it.
- **Goals** — a multi-session build from `to-tickets` is the shape a long-running goal is for: one objective, continued across turns, with progress that survives session boundaries.
- **Todo list** — `implement` walks tickets and red-green slices; `todo_write` is how that progress is visible instead of implied.
- **`ask_user_question`** — `grilling`, `triage`, `setup-matt-pocock-skills` and `to-questionnaire` are interview-shaped. A structured question with options beats a paragraph when the answer is a choice; keep prose for open questions.

## What deliberately does *not* change

- The skills' substance: what a good test is, the triage roles, the deepening vocabulary, the review axes.
- Repo conventions: `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`, `docs/agents/`, `.scratch/`, `.out-of-scope/`.
- The flow order and the phase-boundary tree, including which moves are cheap and which are lossy.
- Upstream's choice to keep 20 skills user-started. DSH makes that a hard gate rather than a convention, which is why the rewrite list exists at all.
