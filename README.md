# dsh-mattpocock-skills

[Matt Pocock's engineering skills](https://github.com/mattpocock/skills), packaged for DeepSeek Harness with a verified DSH adaptation overlay and automated upstream synchronization.

## What this package provides

- All 37 skills currently present upstream, plus the `dsh-workflow` guide.
- A read-only `ctx.skills` provider with lazy loading and invocation-policy preservation.
- DSH adaptations applied in memory while vendored upstream files remain byte-identical.
- Exact-match validation: changed upstream wording fails instead of silently producing a partial adaptation.
- Cross-platform synchronization, generated manifests, tests, and scheduled update pull requests.

This project combines work from [NmouZh/dsh-mattpocock-skills](https://github.com/NmouZh/dsh-mattpocock-skills) and [auggie246/dsh-mattpocock-skills](https://github.com/auggie246/dsh-mattpocock-skills). The original skills are MIT licensed and authored by Matt Pocock. See [LICENSE](LICENSE) and [vendor/VENDOR.md](vendor/VENDOR.md).

## Install

### DSH Web

```powershell
npx --yes @deepseek-ai/dsh plugin --profile web add @maoleijin/dsh-mattpocock-skills
```

Restart `dsh web`, refresh the page, and open a new session. Verify with:

```powershell
npx --yes @deepseek-ai/dsh --profile web --dump-config | Select-String "mattpocock"
```

### DSH Desktop

DSH Desktop exclusively manages its profile through three catalog-oriented pages: plugin configuration, installed plugins, and the plugin market. It does not expose an arbitrary npm-package input. After this package is accepted into the configured market catalog, open **Plugin Market**, search for the package below, inspect the preview, and confirm installation:

```text
@maoleijin/dsh-mattpocock-skills
```

Completely quit and reopen DSH Desktop, then start a new session. Until the market entry is indexed, use the Web profile; publishing to npm alone does not make a package appear in Desktop's market.

See [docs/installation.md](docs/installation.md) or run [scripts/install-web.bat](scripts/install-web.bat) on Windows.

## Use

Start with:

```text
/dsh-workflow
/setup-matt-pocock-skills
```

Common user-started flows include `/ask-matt`, `/grill-with-docs`, `/to-spec`, `/to-tickets`, `/implement`, and `/wayfinder`. Model-invocable disciplines include `tdd`, `code-review`, `diagnosing-bugs`, `domain-modeling`, `codebase-design`, and `research`.

## Synchronize upstream

With an upstream checkout next to this repository:

```powershell
npm ci
npm run sync:local
npm test
```

Or let the synchronizer clone the configured upstream into a temporary directory:

```powershell
npm run sync
npm test
```

Set `MATTPOCOCK_SKILLS_REPOSITORY` to use another Git remote. Scheduled synchronization opens a pull request only after overlay and provider validation succeeds.

## Validate

```powershell
npm ci
npm run check
npm test
```

If upstream rewrites text targeted by the DSH overlay, validation reports the exact stale rule. Update `overlay/patches.json`, regenerate the mechanical rules, and rerun the suite.
