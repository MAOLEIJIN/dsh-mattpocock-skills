'use strict'

/**
 * Vendored skill discovery for the mattpocock skill bundle.
 *
 * The package ships the upstream tree as `skills/<category>/<name>/`, so a
 * skill is one directory holding `SKILL.md` plus its support files. Discovery
 * reads frontmatter only; bodies stay on disk until `get()` asks for one.
 */

const { createHash } = require('node:crypto')
const { readFile, readdir, stat } = require('node:fs/promises')
const { isAbsolute, join, resolve } = require('node:path')

const {
  SkillParseError,
  isKebabCaseName,
  readInvocation,
  readString,
  splitFrontmatter,
} = require('./frontmatter.js')
const { loadYaml } = require('./yaml.js')

const { parse: parseYaml } = loadYaml()

/** Directory name that holds one skill, and the file that defines it. */
const SKILL_FILE = 'SKILL.md'

/** Loaded once per host process; `mtimeMs` guards reuse across in-place edits. */
const cache = new Map()

/** A vendored skill that violates the DSH skill contract. */
class InvalidSkillError extends SkillParseError {
  /**
   * @param {string} message reason, including the offending path and field.
   * @param {{ code?: string, skillDir?: string, file?: string, field?: string }} [details] context.
   */
  constructor(message, details = {}) {
    super(message, details)
    this.name = 'InvalidSkillError'
    if (details.skillDir !== undefined) this.skillDir = details.skillDir
    if (details.file !== undefined) this.file = details.file
  }
}

/**
 * Resolve the directory a bundle should read skills from: an explicit
 * `skillRoot` override first, then the packaged `skills/` tree, then the
 * `DSH_MATTPOCOCK_SKILLS_ROOT` environment override.
 * @param {{ skillRoot?: string, defaultRoot?: string, env?: NodeJS.ProcessEnv }} [options] resolution inputs.
 * @returns {{ path: string, kind: 'configured' | 'packaged' | 'environment' }} resolved root.
 * @throws {Error} when an override is not an absolute path.
 */
function resolveSkillsRoot(options = {}) {
  const env = options.env ?? process.env
  const candidates = [
    { value: options.skillRoot, kind: 'configured' },
    { value: options.defaultRoot, kind: 'packaged' },
    { value: env.DSH_MATTPOCOCK_SKILLS_ROOT, kind: 'environment' },
  ]
  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null || candidate.value === '') continue
    if (!isAbsolute(candidate.value)) {
      throw new Error(
        `skillRoot must be an absolute path; received ${JSON.stringify(candidate.value)} (${candidate.kind})`,
      )
    }
    return { path: resolve(candidate.value), kind: candidate.kind }
  }
  throw Error('no skills root is available: pass skillRoot or set DSH_MATTPOCOCK_SKILLS_ROOT')
}

/**
 * Compute the mutation key that invalidates one cached skill record.
 * @param {import('node:fs').Stats} stats `stat` result for the skill file.
 * @returns {string} cache key combining size and mtime.
 */
function mutationKey(stats) {
  return `${stats.size}:${stats.mtimeMs}`
}

/**
 * Compute the cache key for one skill record: absolute path plus the rank the
 * record is stamped with, so records can be reused across providers without one
 * overwriting the other's candidate rank.
 * @param {string} file absolute path to `SKILL.md`.
 * @param {number} rank precedence rank reported in candidates.
 * @returns {string} cache key.
 */
function cacheId(file, rank) {
  return `${rank}\u0000${file}`
}

/**
 * Read and parse one `SKILL.md` into a vendored record.
 * @param {string} file absolute path to `SKILL.md`.
 * @param {string} skillDir absolute path to the owning directory.
 * @param {number} expectedRank precedence rank reported in candidates.
 * @returns {Promise<object>} the skill record.
 * @throws {InvalidSkillError} when the file breaks the skill contract.
 */
async function readSkillRecord(file, skillDir, expectedRank) {
  const stats = await stat(file)
  const key = mutationKey(stats)
  const id = cacheId(file, expectedRank)
  const hit = cache.get(id)
  if (hit !== undefined && hit.key === key) return hit.record

  const raw = await readFile(file, 'utf8')
  let parts
  try {
    parts = splitFrontmatter(raw)
  } catch (error) {
    throw invalid(error, file, skillDir)
  }

  let data
  try {
    data = parseYaml(parts.yaml)
  } catch (error) {
    throw new InvalidSkillError(`invalid YAML frontmatter in ${file}: ${error.message}`, {
      code: 'SKILL_FRONTMATTER_INVALID_YAML',
      file,
      skillDir,
    })
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new InvalidSkillError(`frontmatter in ${file} must be a YAML mapping`, {
      code: 'SKILL_FRONTMATTER_NOT_A_MAPPING',
      file,
      skillDir,
    })
  }

  let name
  let description
  let invocation
  try {
    name = readString(data, 'name')
    description = readString(data, 'description')
    if (name === undefined) failMissing(file, skillDir, 'name')
    if (description === undefined) failMissing(file, skillDir, 'description')
    if (!isKebabCaseName(name)) {
      throw new InvalidSkillError(
        `frontmatter field "name" in ${file} is not kebab-case: ${JSON.stringify(name)}`,
        { code: 'SKILL_NAME_INVALID', file, skillDir, field: 'name' },
      )
    }
    invocation = readInvocation(data)
  } catch (error) {
    throw invalid(error, file, skillDir)
  }

  const record = {
    name,
    description,
    whenToUse: readOptionalString(data, 'whenToUse', file, skillDir),
    argumentHint: readOptionalString(data, 'argument-hint', file, skillDir),
    invocation,
    rank: expectedRank,
    file,
    skillDir,
    body: parts.body,
    metadata: { upstream: 'mattpocock/skills' },
    key,
  }
  cache.set(id, { key, record })
  return record
}

/**
 * Read one optional string field, tolerating the Claude Code extras that carry
 * no DSH meaning (`argument-hint`) while still rejecting wrong types.
 * @param {Record<string, unknown>} data parsed frontmatter.
 * @param {string} key field name.
 * @param {string} file absolute skill file for error context.
 * @param {string} skillDir absolute skill directory for error context.
 * @returns {string | undefined} the value, or undefined when absent.
 */
function readOptionalString(data, key, file, skillDir) {
  try {
    return readString(data, key)
  } catch (error) {
    throw invalid(error, file, skillDir)
  }
}

/**
 * Raise a missing-field error for one skill.
 * @param {string} file absolute skill file.
 * @param {string} skillDir absolute skill directory.
 * @param {string} field missing field name.
 * @returns {never} always throws.
 */
function failMissing(file, skillDir, field) {
  throw new InvalidSkillError(
    `frontmatter in ${file} requires a non-empty "${field}" field`,
    { code: 'SKILL_FIELD_MISSING', file, skillDir, field },
  )
}

/**
 * Attach file and directory context to a parse failure.
 * @param {unknown} error underlying error.
 * @param {string} file absolute skill file.
 * @param {string} skillDir absolute skill directory.
 * @returns {InvalidSkillError} the contextual error.
 */
function invalid(error, file, skillDir) {
  if (error instanceof InvalidSkillError) return error
  return new InvalidSkillError(error instanceof Error ? error.message : String(error), {
    code: error instanceof SkillParseError ? error.code : 'SKILL_PARSE_FAILED',
    file,
    skillDir,
  })
}

/**
 * Discover every valid skill under one bundle root.
 * @param {string} root absolute skills root (`…/skills`).
 * @param {{ rank?: number }} [options] candidate rank to stamp on each record.
 * @returns {Promise<{ records: object[], problems: object[], scanned: number }>} sorted records, diagnostics, and the number of `<category>/<skill>` directories examined.
 */
async function scanSkills(root, options = {}) {
  const rank = options.rank ?? 0
  const records = []
  const problems = []
  let scanned = 0

  for (const category of await listDirectories(root)) {
    const categoryPath = join(root, category.name)
    for (const skill of await listDirectories(categoryPath)) {
      if (skill.name.startsWith('.')) continue
      scanned += 1
      const skillDir = join(categoryPath, skill.name)
      const file = join(skillDir, SKILL_FILE)
      try {
        const record = await readSkillRecord(file, skillDir, rank)
        records.push(record)
      } catch (error) {
        if (isAbsent(error)) continue
        problems.push({
          name: skill.name,
          category: category.name,
          skillDir,
          code: error.code ?? 'SKILL_PARSE_FAILED',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  records.sort((left, right) => left.name.localeCompare(right.name))
  return { records, problems, scanned }
}

/**
 * List immediate subdirectories of one path, sorted by name.
 * @param {string} path directory to read.
 * @returns {Promise<{ name: string, path: string }[]>} subdirectories; empty when absent.
 */
async function listDirectories(path) {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (isAbsent(error)) return []
    throw error
  }
  const directories = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    directories.push({ name: entry.name, path: join(path, entry.name) })
  }
  directories.sort((left, right) => left.name.localeCompare(right.name))
  return directories
}

/**
 * Return whether an error means "the path does not exist".
 * @param {unknown} error error to classify.
 * @returns {boolean} whether the path was absent.
 */
function isAbsent(error) {
  const code = error?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Drop every cached skill record. The runtime calls this on catalog
 * invalidation so an edited bundle is re-read instead of replayed.
 * @returns {void}
 */
function clearSkillCache() {
  cache.clear()
}

/**
 * Build the stable diagnostic label used for one skill record.
 * @param {object} record vendored skill record.
 * @returns {string} label including the bundle-relative directory.
 */
function describeRecord(record) {
  return `${record.name} (${record.skillDir})`
}

module.exports = {
  InvalidSkillError,
  SKILL_FILE,
  clearSkillCache,
  describeRecord,
  resolveSkillsRoot,
  scanSkills,
  skillFingerprint,
}

/**
 * Fingerprint a skill directory's `SKILL.md` for the vendoring manifest.
 * @param {string} file absolute path to `SKILL.md`.
 * @returns {Promise<{ sha256: string, bytes: number }>} content digest and size.
 */
async function skillFingerprint(file) {
  const raw = await readFile(file)
  return { sha256: createHash('sha256').update(raw).digest('hex'), bytes: raw.byteLength }
}
