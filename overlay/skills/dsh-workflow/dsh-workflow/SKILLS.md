# The skill catalog

Generated from `vendor/skills.manifest.json` by `node vendor/vendor-skills.mjs`. Do not edit by hand.

**Who can start it** — `you` means the model may load it with the `skill` tool. **user** means
`disable-model-invocation: true`: DSH refuses to load it from the model side, so it is started by
the user (slash command or by asking), and the work then runs in their session.

| Skill | Who can start it | Category | What it is for |
| --- | --- | --- | --- |
| `dsh-workflow` | you | overlay | This map: invocation rules, flows, and DSH equivalents. |
| `ask-matt` | **user** | engineering | Ask which skill or flow fits your situation. |
| `claude-handoff` | **user** | in-progress | Hand the current conversation off to a fresh background agent that picks up the work immediately. |
| `code-review` | you | engineering | Review the changes since a fixed point along the Standards and Spec axes. |
| `codebase-design` | you | engineering | Shared vocabulary for designing deep modules. |
| `diagnosing-bugs` | you | engineering | Diagnosis loop for hard bugs and performance regressions. |
| `domain-modeling` | you | engineering | Build and sharpen a project's domain model. |
| `git-guardrails-claude-code` | you | misc | Claude Code git hooks — **inactive in DSH**; see the warning at the top of the skill. |
| `grill-me` | **user** | productivity | Grill the user relentlessly, statelessly. |
| `grill-with-docs` | **user** | engineering | Interview that sharpens a plan and writes ADRs and glossary entries as it goes. |
| `grilling` | you | productivity | The interview primitive the grill skills build on. |
| `handoff` | **user** | productivity | Compact the conversation into a handoff document for another agent. |
| `implement` | **user** | engineering | Build a piece of work from a spec or a set of tickets. |
| `improve-codebase-architecture` | **user** | engineering | Survey the codebase for deepening opportunities, then plan them. |
| `loop-me` | **user** | in-progress | Design a workflow loop. |
| `migrate-to-shoehorn` | you | misc | Replace `as` assertions in tests with @total-typescript/shoehorn. |
| `prototype` | you | engineering | Throwaway code that answers one design question. |
| `research` | you | engineering | Investigate a question against primary sources and leave a cited Markdown file. |
| `resolving-merge-conflicts` | you | engineering | Resolve an in-progress merge or rebase conflict hunk by hunk. |
| `scaffold-exercises` | you | misc | Create exercise directory structures that pass the course linter. |
| `setup-matt-pocock-skills` | **user** | engineering | Configure a repo for the engineering flows: tracker, triage labels, domain doc layout. |
| `setup-pre-commit` | you | misc | Husky + lint-staged pre-commit hooks with type checking and tests. |
| `setup-ts-deep-modules` | **user** | in-progress | Set up a TypeScript repo for deep modules and boundary linting. |
| `tdd` | you | engineering | The red → green loop, and what makes a test worth keeping. |
| `teach` | **user** | productivity | Teach the user a concept over multiple sessions. |
| `to-questionnaire` | **user** | productivity | Write someone else a questionnaire when the blocker is in their head. |
| `to-spec` | **user** | engineering | Turn a thread into a spec. |
| `to-tickets` | **user** | engineering | Split a spec into tracer-bullet tickets with blocking edges. |
| `triage` | **user** | engineering | Move issues and external PRs through triage roles into agent-ready briefs. |
| `wait-what` | **user** | productivity | Re-pitch a message that did not land. |
| `wayfinder` | **user** | engineering | Chart a shared map of decision tickets for an effort too big for one session. |
| `wizard` | you | engineering | Generate an interactive bash wizard for steps only a human can take. |
| `writing-beats` | **user** | in-progress | Writing beats. |
| `writing-for-agents` | you | productivity | Writing documents agents consume: skills, AGENTS.md, pointed-at docs. |
| `writing-fragments` | **user** | in-progress | Writing fragments. |
| `writing-shape` | **user** | in-progress | Writing shape. |

## Notes on the catalog

- The `in-progress` category is what upstream ships unfinished; treat those descriptions as provisional.
- `argument-hint` values in the upstream frontmatter (`teach`, `handoff`, `loop-me`, `claude-handoff`) are Claude Code metadata. DSH ignores the key, so the hint appears only in the plugin's diagnostics — pass the same information as an argument in the message instead.
- `agents/openai.yaml` files next to the skills are Codex CLI display metadata. Nothing in DSH reads them.
- Upstream descriptions do the routing. This table is the same data, shortened, plus the one column upstream has no equivalent for: who is allowed to start each skill.
