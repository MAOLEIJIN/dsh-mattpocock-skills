'use strict'

/**
 * The DSH adaptation layer.
 *
 * `skills/` stays a byte-for-byte copy of upstream, so `vendor-skills.mjs
 * --check` can always prove the baseline is pristine. Everything that makes the
 * bundle behave in DeepSeek Harness lives here, as exact literal replacements
 * applied in memory: upstream writes `/name` as a command the model can run,
 * while in DSH a `/name` is a user-facing slash command and a
 * `disable-model-invocation: true` skill cannot be loaded by the model at all.
 *
 * Each rule declares how many occurrences it expects. A mismatch is a hard
 * failure rather than a silent half-application, so an upstream reword surfaces
 * at startup instead of quietly shipping routing prose that no longer works.
 */

const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

const { scanSkills } = require('./skills.js')
const { PACKAGE_ROOT } = require('./paths.js')

/** Overlay manifest carried in the package. */
const DEFAULT_OVERLAY_FILE = join(PACKAGE_ROOT, 'overlay', 'patches.json')

/** Directory holding skills contributed by the adaptation layer. */
const OVERLAY_SKILLS_DIR = join(PACKAGE_ROOT, 'overlay', 'skills')

/** One rule failed to apply: the file or its anchor text moved. */
class OverlayError extends Error {
  /**
   * @param {string} message human-readable reason naming the file and rule.
   * @param {{ code?: string, file?: string, rule?: object }} [details] context.
   */
  constructor(message, details = {}) {
    super(message)
    this.name = 'OverlayError'
    this.code = details.code ?? 'OVERLAY_RULE_FAILED'
    if (details.file !== undefined) this.file = details.file
    if (details.rule !== undefined) this.rule = details.rule
  }
}

/** Overlay file failed to parse or is structurally wrong. */
class OverlayManifestError extends OverlayError {
  /**
   * @param {string} message reason.
   * @param {{ code?: string }} [details] context.
   */
  constructor(message, details = {}) {
    super(message, { code: details.code ?? 'OVERLAY_MANIFEST_INVALID', ...details })
    this.name = 'OverlayManifestError'
  }
}

/**
 * Count the literal occurrences of one anchor in a body.
 * @param {string} body text to search.
 * @param {string} find literal anchor.
 * @returns {number} occurrence count.
 */
function countOccurrences(body, find) {
  if (find === '') return 0
  let count = 0
  let index = body.indexOf(find)
  while (index !== -1) {
    count += 1
    index = body.indexOf(find, index + find.length)
  }
  return count
}

/**
 * Validate one rule's shape.
 * @param {unknown} rule raw rule from the manifest.
 * @param {number} index position in the rules list, for error messages.
 * @returns {object} the validated rule.
 * @throws {OverlayManifestError} when a field is missing or mistyped.
 */
function validateRule(rule, index) {
  const where = `overlay rule #${index + 1}`
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) {
    throw new OverlayManifestError(`${where} must be an object`)
  }
  if (typeof rule.file !== 'string' || rule.file === '') {
    throw new OverlayManifestError(`${where} needs a "file"`)
  }
  if (typeof rule.find !== 'string' || rule.find === '') {
    throw new OverlayManifestError(`${where} (${rule.file}) needs a non-empty "find"`)
  }
  const replacement = rule.replace
  if (typeof replacement !== 'string' && !Array.isArray(replacement)) {
    throw new OverlayManifestError(`${where} (${rule.file}) needs "replace" as a string or string list`)
  }
  if (Array.isArray(replacement) && replacement.some((line) => typeof line !== 'string')) {
    throw new OverlayManifestError(`${where} (${rule.file}) has a non-string line in "replace"`)
  }
  if (!Number.isInteger(rule.expect) || rule.expect < 1) {
    throw new OverlayManifestError(`${where} (${rule.file}) needs a positive integer "expect"`)
  }
  return rule
}

/**
 * Validate the whole manifest and group its rules by target file.
 * @param {unknown} manifest parsed JSON.
 * @returns {{ schema: string, upstream: object, byFile: Map<string, object[]>, slash: Map<string, object[]>, skills: object[] }} validated overlay.
 * @throws {OverlayManifestError} when the manifest is structurally wrong.
 */
function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new OverlayManifestError('the overlay manifest must be a JSON object')
  }
  if (!Array.isArray(manifest.rules)) throw new OverlayManifestError('the overlay manifest needs a "rules" array')
  const byFile = new Map()
  manifest.rules.forEach((raw, index) => {
    const rule = validateRule(raw, index)
    const rules = byFile.get(rule.file)
    if (rules === undefined) byFile.set(rule.file, [rule])
    else rules.push(rule)
  })
  return {
    schema: typeof manifest.schema === 'string' ? manifest.schema : 'dsh-mattpocock-skills/overlay@1',
    upstream: manifest.upstream ?? {},
    byFile,
    slash: validateSlashTable(manifest.slashInvocations),
    skills: Array.isArray(manifest.skills) ? manifest.skills : [],
  }
}

/**
 * Validate the manifest's mechanical slash normalisation table.
 * @param {unknown} table raw `slashInvocations` value.
 * @returns {Map<string, object[]>} rules grouped by file.
 * @throws {OverlayManifestError} when the table is structurally wrong.
 */
function validateSlashTable(table) {
  const byFile = new Map()
  if (table === undefined) return byFile
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    throw new OverlayManifestError('"slashInvocations" must be an object')
  }
  const files = table.files ?? {}
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    throw new OverlayManifestError('"slashInvocations.files" must be an object')
  }
  for (const [file, rules] of Object.entries(files)) {
    if (!Array.isArray(rules)) throw new OverlayManifestError(`slashInvocations["${file}"] must be an array`)
    byFile.set(
      file,
      rules.map((raw, index) => {
        const rule = validateRule({ ...raw, file }, index)
        if (!/^\*\*`\/|\`\//.test(rule.find)) {
          throw new OverlayManifestError(
            `slashInvocations["${file}"] rule #${index + 1} must match a \`/name\` token (optionally bolded)`,
          )
        }
        return rule
      }),
    )
  }
  return byFile
}

/**
 * Read and validate the overlay manifest from disk.
 * @param {string} [file] manifest path; defaults to the packaged one.
 * @returns {Promise<object>} validated overlay.
 */
async function loadOverlay(file = DEFAULT_OVERLAY_FILE) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return validateManifest({ schema: 'dsh-mattpocock-skills/overlay@1', rules: [] })
    }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new OverlayManifestError(`overlay manifest ${file} is not valid JSON: ${error.message}`)
  }
  return validateManifest(parsed)
}

/**
 * Apply every rule targeting one file to its body.
 * @param {string} file bundle-relative file path, used to select rules.
 * @param {string} body file text.
 * @param {Map<string, object[]>} byFile validated rules grouped by file.
 * @returns {string} the adapted text.
 * @throws {OverlayError} when an anchor's occurrence count differs from `expect`.
 */
function applyRules(file, body, byFile) {
  const rules = byFile.get(file)
  if (rules === undefined) return body
  let adapted = body
  for (const rule of rules) {
    const found = countOccurrences(adapted, rule.find)
    if (found !== rule.expect) {
      const reason =
        found === 0
          ? 'anchor not found (upstream reworded or the file moved)'
          : `anchor found ${found} time(s), expected ${rule.expect}`
      throw new OverlayError(`overlay rule for ${file} failed: ${reason}${noteSuffix(rule)}`, {
        code: found === 0 ? 'OVERLAY_ANCHOR_MISSING' : 'OVERLAY_ANCHOR_AMBIGUOUS',
        file,
        rule,
      })
    }
    const replacement = Array.isArray(rule.replace) ? rule.replace.join('\n') : rule.replace
    adapted = adapted.split(rule.find).join(replacement)
  }
  return adapted
}

/**
 * Render a rule's optional note into an error message.
 * @param {object} rule overlay rule.
 * @returns {string} suffix beginning with ` — `, or an empty string.
 */
function noteSuffix(rule) {
  return typeof rule.note === 'string' && rule.note !== '' ? ` — ${rule.note}` : ''
}

/**
 * Scan the overlay's own skill tree, tagged with its own source bucket.
 * @param {{ rank?: number }} [options] candidate rank to stamp.
 * @returns {Promise<{ records: object[], problems: object[] }>} overlay skills.
 */
async function scanOverlaySkills(options = {}) {
  if (options.skip === true) return { records: [], problems: [] }
  const result = await scanSkills(OVERLAY_SKILLS_DIR, { rank: options.rank ?? 0 })
  return { records: result.records, problems: result.problems }
}

/**
 * Merge the hand-written rules with the mechanical slash normalisation so both
 * halves are validated, counted, and applied through one path. Hand-written
 * rules run first: they rewrite the prose that the mechanical pass would only
 * de-command.
 * @param {Map<string, object[]>} byFile hand-written rules by file.
 * @param {Map<string, object[]>} slash mechanical rules by file.
 * @returns {Map<string, object[]>} the merged rule table.
 */
function mergeRuleTables(byFile, slash) {
  const merged = new Map()
  for (const [file, rules] of byFile) merged.set(file, [...rules])
  for (const [file, rules] of slash) {
    const existing = merged.get(file)
    if (existing === undefined) merged.set(file, [...rules])
    else existing.push(...rules)
  }
  return merged
}

/**
 * Build the runtime view of the overlay: adapted rule lookup, the skills the
 * overlay contributes, and the file paths it targets.
 *
 * Every rule is verified against the packaged tree while the overlay is built,
 * so a reworded upstream file fails the load loudly instead of surfacing as
 * half-adapted prose later.
 * @param {{ file?: string, skillsRoot?: string }} [options] manifest location and tree to verify against.
 * @returns {Promise<object>} runtime overlay with `apply(file, body)`.
 */
async function createOverlay(options = {}) {
  const manifest = await loadOverlay(options.file)
  const rules = mergeRuleTables(manifest.byFile, manifest.slash)
  const skillsRoot = options.skillsRoot ?? join(PACKAGE_ROOT, 'skills')
  for (const [file, fileRules] of rules) {
    let body
    try {
      body = await readFile(join(skillsRoot, file), 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new OverlayError(`overlay targets ${file}, which is not in the bundle`, {
          code: 'OVERLAY_TARGET_MISSING',
          file,
        })
      }
      throw error
    }
    applyRules(file, body, new Map([[file, fileRules]]))
  }
  return {
    schema: manifest.schema,
    upstream: manifest.upstream,
    byFile: rules,
    /** Files the overlay rewrites, bundle-relative and sorted. */
    adaptedFiles: [...rules.keys()].sort(),
    /** Number of individual replacements across all files. */
    ruleCount: [...rules.values()].reduce((total, fileRules) => total + fileRules.length, 0),
    /**
     * Adapt one bundle-relative file body.
     * @param {string} file bundle-relative path.
     * @param {string} body file text.
     * @returns {string} adapted text.
     */
    apply(file, body) {
      return applyRules(file, body, rules)
    },
  }
}

module.exports = {
  DEFAULT_OVERLAY_FILE,
  OVERLAY_SKILLS_DIR,
  OverlayError,
  OverlayManifestError,
  applyRules,
  countOccurrences,
  createOverlay,
  loadOverlay,
  mergeRuleTables,
  scanOverlaySkills,
  validateManifest,
}
