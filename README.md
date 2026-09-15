# dsh-mattpocock-skills

Continuously synchronized [Matt Pocock skills](https://github.com/mattpocock/skills) for DeepSeek Harness, with a strict, separately maintained DSH adaptation overlay.

This project combines two community approaches:

- [NmouZh/dsh-mattpocock-skills](https://github.com/NmouZh/dsh-mattpocock-skills): packaged provider, invocation-policy mapping, tested semantic overlay, and drift detection.
- [auggie246/dsh-mattpocock-skills](https://github.com/auggie246/dsh-mattpocock-skills): keep upstream as the source of truth and reapply a narrow DSH overlay after every update.

The vendored `skills/` tree remains byte-identical to upstream. DSH-specific changes are applied in memory from `overlay/patches.json`; stale anchors fail validation instead of silently producing a partially adapted package.

## Repository layout used by the maintainer

```text
E:\personal-maoleijin\mattpocock-skills                 MAOLEIJIN/skills fork
E:\personal-maoleijin\dsh-mattpocock-skills            merged DSH plugin
E:\personal-maoleijin\dsh-mattpocock-skills-sync-source
E:\personal-maoleijin\dsh-mattpocock-skills-overlay-source
```

Update the local upstream fork, then regenerate and verify the DSH package:

```powershell
git -C ..\mattpocock-skills fetch upstream
git -C ..\mattpocock-skills merge --ff-only upstream/main
git -C ..\mattpocock-skills push origin main
npm run sync:local
npm test
```

`npm run sync` instead clones `MAOLEIJIN/skills` into a temporary directory. The scheduled GitHub workflow uses that mode and opens a pull request only after the overlay and provider tests pass.

[Matt Pocock 的 agent skills](https://github.com/mattpocock/skills)（上游 **1.2.3**，全部 **35 个技能**）打包成的 DeepSeek Harness 插件，**外加一层 DSH 适配**：

- 技能正文随包分发，插件通过 `ctx.skills` 注册一个**只读 provider**，整套作为**一个插件行**安装、升级、卸载，不再往用户技能根目录里散落几十份拷贝；
- 上游文件**逐字节保留**（`vendor-skills.mjs --check` 可验证），DSH 相关的改写全部放在独立的**适配层**里（`overlay/patches.json`，49 条精确替换，加载时在内存中应用）；
- 额外提供一个模型可调用的指南技能 **`dsh-workflow`**，讲清这套技能在 DSH 里怎么跑：哪些技能模型能自己加载、哪些只能由用户发起、流程之间怎么交接、以及怎么对接 DSH 的子代理 / 计划模式 / 会话命令。

目录里实际可用的技能是 **36 个** = 上游 35 个 + `dsh-workflow`。

## 为什么需要适配层

上游是写给 Claude Code 的：那里的 `` `/name` `` 是**模型可以执行的命令**。DSH 里不是：

| 差异 | DSH 的实际行为 |
| --- | --- |
| `/name` | 是**用户**的斜杠命令；模型不能执行，只能用 `skill` 工具按名字加载技能 |
| `disable-model-invocation: true`（本包 20 个技能） | `skill` 工具**直接报错**：`skill "<name>" is not available for model invocation`，模型完全打不开 |
| `/clear` | DSH 没有这个命令，等价物是"用户开一个新会话" |
| `/compact` | DSH 有，但由用户运行 |
| `.claude/settings.json` 的 hooks | DSH **不读**，照做等于没有防护 |
| `argument-hint` frontmatter | DSH 忽略该键（只进插件的诊断信息） |
| `agents/openai.yaml` | Codex CLI 的展示元数据，DSH 不读 |

所以适配层做三类事：**把"叫技能"的说法改对**（模型能加载的写成按名加载，只能用户发起的明确写"请用户来跑"）、**修掉 DSH 里会失败或做错事的指令**（`git-guardrails-claude-code` 的 Claude Code hook、`claude-handoff` 的 `claude --bg` CLI、`handoff` 写进 OS 临时目录、`CLAUDE.md` 优先于 `AGENTS.md`）、**补一份 DSH 视角的总纲**（`dsh-workflow`）。

## 结构

```
dsh-mattpocock-skills/
├── cordis.patch.yml          # bundle 补丁层：向 profile 根插入一行
├── skills/                   # 上游 35 个技能，逐字节拷贝（唯一写入者是 vendor 脚本）
├── overlay/
│   ├── patches.json          # 49 条适配规则（精确 find/replace + 期望命中次数）+ 新增技能清单
│   └── skills/dsh-workflow/  # 指南技能：SKILL.md + SKILLS.md（目录表）+ DSH-MAPPING.md（词汇对照）
├── src/
│   ├── index.js              # cordis 插件入口：注册 provider、暴露诊断、启动自检
│   ├── provider.js           # SkillProvider：list/get/diagnose，含适配与"新增技能"合并
│   ├── overlay.js            # 适配层：载入规则、校验锚点、应用改写
│   ├── skills.js             # 技能树扫描 + frontmatter 解析 + 缓存
│   ├── frontmatter.js        # frontmatter / 调用策略解析（对齐 dsh-skill-filesystem）
│   ├── paths.js / yaml.js    # 包内路径、yaml 依赖解析
├── vendor/                   # vendor-skills.mjs（同步上游）、overlay-report.mjs（锚点体检）、
│                             # skills.manifest.json（逐技能 sha256）、VENDOR.md（生成报告）
├── tools/archive-duplicates.mjs
└── test/bundle.test.js, test/verify-profile.cjs
```

## 安装

已装在 `web` profile（`link:` 安装，改源码即生效，但**新增 bundle 必须重启宿主**）：

```jsonc
// /root/.dsh/profiles/web/package.json
"dependencies": { "dsh-mattpocock-skills": "link:/root/dsh-mattpocock-skills/dsh-mattpocock-skills" },
"dsh": { "profile": { "bundles": [ /* … */ "dsh-mattpocock-skills" ] } }
```

从 GitHub 安装（仓库：<https://github.com/NmouZh/dsh-mattpocock-skills>）：

```bash
git clone https://github.com/NmouZh/dsh-mattpocock-skills.git ~/dsh-mattpocock-skills
cd /root/.dsh/profiles/web
pnpm add "dsh-mattpocock-skills@link:$HOME/dsh-mattpocock-skills"
# 再把 "dsh-mattpocock-skills" 加进 package.json 的 dsh.profile.bundles，最后重启宿主
```

> `dsh.profile.bundles` 里必须是 **Node 能解析的包名**，不能写 `link:`/`file:` 前缀；`link:` 只出现在 `dependencies`。
> 用 `link:` 指向 clone 而不是 `pnpm add <git 地址>`：后者会打包拷贝一份，之后 `git pull` 不会反映到 profile 里。

## 配置

在 profile 的 `cordis.patch.yml` 里按 `id: mattpocock-skills` 覆盖（`patchReload: live`，**改配置不用重启**）：

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `enabled` | `true` | `false` 时该 provider 返回空清单（等同停用整包） |
| `rank` | `450` | 同名技能去重优先级，**数字越小越优先**。内置 `filesystem` 档位：project-dsh 100 / project-agents 200 / custom 300 / user-dsh 400 / user-agents 500 / bundled 600 |
| `promote` | `[]` | 把**只能用户发起**的技能提升为模型可调用（这是唯一"让模型能加载 `implement`"的正规做法） |
| `skillRoot` | 包内 `skills/` | 改读外部目录（绝对路径），例如直接指向上游 checkout |

```yaml
- id: mattpocock-skills
  config:
    promote: [implement, to-spec]   # 让模型也能加载这两个（会占用提示词预算，谨慎开）
```

**关于 `promote` 的取舍**：20 个"仅用户"技能是上游有意的设计（它们在**新会话**里启动、由人驱动）。提升它们会让这 20 份描述进入每次请求的技能目录，因此默认不开。`dsh-workflow` 里写明了每个技能的归属，模型会据此告诉你"这个需要你来起"。

## 适配层怎么维护

适配层由两半组成，都在 `overlay/patches.json` 里，都是**精确 find/replace + 期望命中次数**：

- **`rules`（手写，58 条）**：需要"改意思"的地方——把"去跑 `/setup-matt-pocock-skills`"改成"请用户来跑"、`/clear` 改成"让用户开新会话"、`CLAUDE.md` 优先改成 `AGENTS.md` 优先、`git-guardrails` 顶部加 DSH 警告、`claude-handoff` 改成 `subagent` 委托、`handoff` 改写到工作区内等。
- **`slashInvocations`（机械生成，27 条）**：只需要"去斜杠"的地方——`the \`/handoff\` is narrow` → `the \`handoff\` is narrow`，表格里的 `**\`/compact\`**` → `**Compact**`（不是技能，是用户发起的会话动作）。由 `vendor/gen-slash-rules.mjs` 依据**手写规则之后**的文本生成，两边不会抢同一段文字。

```bash
node vendor/gen-slash-rules.mjs          # 改了手写规则后重新生成机械那半
node vendor/gen-slash-rules.mjs --check  # 校验机械那半是否过期

node vendor/overlay-report.mjs           # 逐条体检：锚点还在吗、命中次数对吗
node vendor/overlay-report.mjs --only claude-handoff

node vendor/vendor-skills.mjs --check    # 上游漂移 + 清单新鲜度 + 适配层可应用 + 目录表完整
```

规则在插件**加载时**校验：锚点对不上（上游改写了那句话）会直接让 provider 报错，而不是"改一半"悄悄上线。命中次数用 `expect` 固定，避免一句话被改写后误伤多处。

新增一条适配：在 `rules` 里加 `{ file, find, replace, expect, note }`（`find` 必须是当前磁盘上的**精确原文**，含空格与标点），跑 `overlay-report.mjs` 确认 `found == expect`，再跑一次 `gen-slash-rules.mjs`。

新增一个配套技能：放进 `overlay/skills/<name>/<name>/SKILL.md`（与上游 `<category>/<name>/` 同构），它会和上游技能一起出现在目录里。

## 日志与诊断

宿主日志里会有一行摘要，例如：

```
mattpocock-skills: registered (rank 450, enabled true, promote none)
mattpocock-skills: 36 skill(s) from …/skills (packaged) + 1 from the DSH overlay; 16 model-invocable, 20 user-invocable only, 16 adapted by 49 rule(s)
```

`ctx.mattpocockSkills.provider.diagnose()` 返回只读快照：每个技能的调用策略、`origin`（上游 / 适配层）、`adapted` 标记、适配层规则数与目标文件、以及被跳过的坏技能。若发现同名技能被别的 provider 遮住，也会在日志里给出警告。

## 自检

```bash
cd /root/.dsh/profiles/web          # 让 @deepseek-ai/* 能被解析
node /root/dsh-mattpocock-skills/dsh-mattpocock-skills/test/bundle.test.js       # 15 项：契约 + 适配层 + 真实注册表集成
node /root/dsh-mattpocock-skills/dsh-mattpocock-skills/test/verify-profile.cjs   # 组合树里确有该 bundle 行
node /root/dsh-mattpocock-skills/dsh-mattpocock-skills/vendor/vendor-skills.mjs --check
```

## 升级上游

```bash
node vendor/vendor-skills.mjs --from /path/to/skills-<new-version>
node vendor/overlay-report.mjs          # 上游若改写了被适配的句子，这里会亮出来
# 修好规则 → 同步 package.json 的 version → 重启宿主
```

`vendor-skills.mjs` 是 `skills/` 与 `vendor/` 的唯一写入者：只收录带 `SKILL.md` 的目录，并强制 kebab-case 的 `name`、非空 `description`、非空正文，违规直接失败而不是产出坏包。

## 旧拷贝归档

`~/.agents/skills` 里曾经有 35 份旧版本拷贝，会**压过**插件（agent preset 的作用域层比全局层更近，rank 数字在那里不起作用）。已归档到 `~/.agents/skills.backup-<时间戳>/`（附 `ARCHIVE.md` 恢复说明）；`tools/archive-duplicates.mjs [--dry-run]` 处理同类情况。

## 卸载

```bash
cd /root/.dsh/profiles/web
pnpm remove dsh-mattpocock-skills      # 再从 package.json 的 bundles 移除该行，重启宿主
```

`link:` 安装只是软链，卸载不会动到 checkout；技能随包分发，用户技能目录不留残留。
