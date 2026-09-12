'use strict'

/**
 * `ctx.skills` provider for the vendored mattpocock skill bundle.
 *
 * The provider is read-only: it never writes to the bundle, and it reports the
 * upstream invocation policy verbatim, so a promoted (model-invocable) skill
 * stays promoted and a `disable-model-invocation: true` skill stays
 * user-invocable only.
 *
 * Two trees feed the catalog: the pristine upstream copy under `skills/` and
 * the DSH adaptation layer under `overlay/skills/`. Bodies from the first are
 * adapted in memory by `overlay/patches.json`, so the baseline stays provably
 * untouched on disk while the text the model reads is the DSH-correct one.
 */

const { readFile } = require('node:fs/promises')
const { relative, sep } = require('node:path')

const { splitFrontmatter } = require('./frontmatter.js')
const { OVERLAY_SKILLS_DIR, createOverlay, scanOverlaySkills } = require('./overlay.js')
const { PACKAGED_SKILLS_ROOT } = require('./paths.js')
const { resolveSkillsRoot, scanSkills } = require('./skills.js')

/** Provider label reported on every candidate; also the runtime provider name. */
const PROVIDER_NAME = 'mattpocock-skills'

/** Origin bucket stamped on every skill this provider serves. */
const SOURCE = 'bundled'

/**
 * Appended to every skill body the overlay rewrote. It carries the two facts
 * the rewritten prose assumes: `/name` is not something the model runs, and the
 * `skill` tool refuses anything marked `disable-model-invocation: true`.
 */
const DSH_NOTE = [
  '',
  '---',
  '',
  '> **Packaged for DeepSeek Harness (DSH), adapted from the original.** Skill names below are',
  '> referenced by name, not as shell-style commands. Load a model-invocable skill with the `skill`',
  '> tool; DSH refuses to load a skill marked `disable-model-invocation: true` from the model side',
  '> entirely, so when a name is called **user-only** the user has to invoke it (or ask for it), and',
  '> the work continues in their session. User-driven session commands (`/compact`, and starting a',
  '> fresh session) stay with the user. See the `dsh-workflow` skill for the whole map.',
].join('\n')

/**
 * Create the registry-facing provider for one resolved bundle.
 * @param {{ skillRoot?: string, defaultRoot?: string, rank?: number, promote?: string[], enabled?: boolean, overlayFile?: string, skipOverlay?: boolean, env?: NodeJS.ProcessEnv, logger?: object }} [options] provider configuration.
 * @returns {object} a provider with the `SkillProvider` contract plus `diagnose()`.
 */
function createSkillBundleProvider(options = {}) {
  const rank = options.rank ?? 0
  const enabled = options.enabled !== false
  const promote = new Set(options.promote ?? [])
  const resolved = resolveSkillsRoot({
    skillRoot: options.skillRoot,
    defaultRoot: options.defaultRoot ?? PACKAGED_SKILLS_ROOT,
    env: options.env,
  })
  const rootError = enabled ? undefined : new Error(`the mattpocock skill bundle is disabled in settings`)
  let overlay
  let overlaySkills = []
  let records = new Map()
  let problems = []
  let scanned = 0
  let scannedOnce = false

  /**
   * Re-read the bundle and replace the in-memory catalog.
   * @returns {Promise<{ records: object[], problems: object[] }>} the fresh catalog.
   */
  async function refresh() {
    if (rootError !== undefined) return { records: [], problems: [] }
    overlay ??= await createOverlay(options.overlayFile === undefined ? {} : { file: options.overlayFile })
    const result = await scanSkills(resolved.path, { rank })
    const own = result.records.map((record) => ({ ...record, origin: 'upstream' }))
    let overlayProblems = []
    if (options.skipOverlay === true) overlaySkills = []
    else {
      const extra = await scanOverlaySkills({ rank })
      overlaySkills = extra.records.map((record) => ({ ...record, origin: 'overlay' }))
      overlayProblems = extra.problems
    }
    const catalog = new Map()
    const duplicates = []
    for (const record of [...own, ...overlaySkills]) {
      const owner = catalog.get(record.name)
      if (owner !== undefined) {
        duplicates.push({
          name: record.name,
          skillDir: record.skillDir,
          code: 'SKILL_NAME_DUPLICATE',
          message: `skill "${record.name}" is also defined by ${owner.skillDir}; keeping the first definition`,
        })
        continue
      }
      catalog.set(record.name, promote.has(record.name) ? promoted(record) : record)
    }
    records = catalog
    problems = [...result.problems, ...overlayProblems, ...duplicates]
    scanned = result.scanned
    if (!scannedOnce) {
      scannedOnce = true
      logSummary()
    }
    return { records: [...records.values()], problems }
  }

  /**
   * Relative bundle path of one record's file, the key the overlay rules use.
   * @param {object} record vendored skill record.
   * @returns {string} POSIX-style path relative to the tree the record came from.
   */
  function bundlePath(record) {
    const relativePath = relative(rootFor(record), record.file).split(sep).join('/')
    return relativePath
  }

  /**
   * The tree a record was discovered in.
   * @param {object} record vendored skill record.
   * @returns {string} absolute skills root.
   */
  function rootFor(record) {
    return record.origin === 'overlay' ? OVERLAY_SKILLS_DIR : resolved.path
  }

  /**
   * Adapt one skill body: overlay rules first, then the DSH contract note for
   * skills whose text was rewritten.
   * @param {object} record vendored skill record.
   * @param {string} body raw file text.
   * @returns {string} the body the model should read.
   */
  function adaptBody(record, body) {
    const parsed = splitFrontmatter(body).body
    if (record.origin === 'overlay') return parsed
    const file = bundlePath(record)
    if (!overlay.adaptedFiles.includes(file)) return parsed
    return `${overlay.apply(file, parsed)}${DSH_NOTE}`
  }

  /**
   * Resolve the effective policy for a skill listed in `promote`.
   * @param {object} record vendored skill record.
   * @returns {object} the record with both surfaces enabled.
   */
  function promoted(record) {
    return { ...record, promoted: true, invocation: { modelInvocable: true, userInvocable: true } }
  }

  /** Report one readable summary line for the host log. */
  function logSummary() {
    const logger = options.logger
    if (logger === undefined) return
    const all = [...records.values()]
    const modelFacing = all.filter((record) => record.invocation.modelInvocable).length
    const adapted = all.filter((record) => overlay.adaptedFiles.includes(safeBundlePath(record))).length
    logger.info(
      `${PROVIDER_NAME}: ${records.size} skill(s) from ${resolved.path} (${resolved.kind}) + ` +
        `${overlaySkills.length} from the DSH overlay; ` +
        `${modelFacing} model-invocable, ${records.size - modelFacing} user-invocable only, ` +
        `${adapted} adapted by ${overlay.ruleCount} rule(s)`,
    )
    for (const problem of problems) logger.warn(`${PROVIDER_NAME}: ignored ${problem.skillDir}: ${problem.message}`)
    if (rootError !== undefined) logger.warn(`${PROVIDER_NAME}: ${rootError.message}`)
  }

  /**
   * Bundle path of one record, tolerating a record that is no longer on disk.
   * @param {object} record vendored skill record.
   * @returns {string} bundle-relative path, or an empty string when the file is outside both trees.
   */
  function safeBundlePath(record) {
    const path = bundlePath(record)
    return path.startsWith('..') ? '' : path
  }

  return {
    name: PROVIDER_NAME,

    /**
     * Apply the adaptation rules to one bundle-relative file body.
     *
     * Discovery adapts the skill files it serves; the process documents beside
     * them (`PHASE-BOUNDARIES.md`, `DESIGN-IT-TWICE.md`, report templates) are
     * read by the model through the skill's resource base, so this exposes the
     * same rewrite to tooling and tests.
     * @param {string} file bundle-relative path.
     * @param {string} body file text.
     * @returns {string} the adapted text.
     */
    overlayApply(file, body) {
      return overlay === undefined ? body : overlay.apply(file, body)
    },

    /**
     * List every vendored skill for the current lookup.
     * @returns {Promise<object[]>} candidate summaries carrying rank and locator.
     */
    async list() {
      await refresh()
      return [...records.values()].map(toCandidate)
    },

    /**
     * Load one skill body and upgrade its body-relative resource base.
     * @param {object} candidate candidate previously returned by `list()`.
     * @returns {Promise<object | undefined>} the full definition, or undefined when it disappeared.
     */
    async get(candidate) {
      const name = typeof candidate?.name === 'string' ? candidate.name : candidate?.locator?.name
      const record = name === undefined ? undefined : records.get(name)
      if (record === undefined) return undefined
      let body
      try {
        body = await readFile(record.file, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return undefined
        throw error
      }
      return {
        name: record.name,
        description: record.description,
        ...(record.whenToUse === undefined ? {} : { whenToUse: record.whenToUse }),
        invocation: record.invocation,
        source: SOURCE,
        provider: PROVIDER_NAME,
        resourceBase: { kind: 'directory', path: record.skillDir },
        path: record.file,
        metadata: record.metadata,
        content: adaptBody(record, body),
      }
    },

    /**
     * Describe the catalog and the adaptation layer for a settings panel, a
     * diagnostic log, or a test.
     * @returns {{ root: string, rootKind: string, provider: string, scanned: number, enabled: boolean, skills: object[], problems: object[], overlay: object }} snapshot.
     */
    diagnose() {
      return {
        provider: PROVIDER_NAME,
        root: resolved.path,
        rootKind: resolved.kind,
        enabled,
        scanned,
        error: rootError === undefined ? undefined : rootError.message,
        overlay: {
          schema: overlay?.schema,
          ruleCount: overlay?.ruleCount ?? 0,
          adaptedFiles: overlay?.adaptedFiles ?? [],
          skills: overlaySkills.map((record) => record.name).sort(),
        },
        skills: [...records.values()].map((record) => ({
          name: record.name,
          description: record.description,
          argumentHint: record.argumentHint,
          invocation: record.invocation,
          promoted: record.promoted === true,
          origin: record.origin,
          adapted: overlay !== undefined && overlay.adaptedFiles.includes(safeBundlePath(record)),
          directory: record.skillDir,
        })),
        problems,
      }
    },
  }

  /**
   * Project one vendored record into a registry candidate.
   * @param {object} record vendored skill record.
   * @returns {object} candidate with rank and an opaque locator.
   */
  function toCandidate(record) {
    return {
      name: record.name,
      description: record.description,
      ...(record.whenToUse === undefined ? {} : { whenToUse: record.whenToUse }),
      invocation: record.invocation,
      source: SOURCE,
      provider: PROVIDER_NAME,
      rank: record.rank,
      locator: { kind: 'file', name: record.name, path: record.file, directory: record.skillDir },
      path: record.file,
      resourceBase: { kind: 'directory', path: record.skillDir },
      metadata: record.metadata,
    }
  }
}

module.exports = { PROVIDER_NAME, SOURCE, createSkillBundleProvider }
