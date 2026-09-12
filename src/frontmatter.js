'use strict'

/**
 * Skill frontmatter reader for the vendored mattpocock skill bundle.
 *
 * The vendored files are YAML frontmatter plus a Markdown body. Parsing lives
 * in one place so the runtime provider and the vendoring script cannot drift:
 * both must agree on which files are valid skills.
 */

const DELIMITER = '---'

/** Skill frontmatter failed to parse, or violated the DSH skill grammar. */
class SkillParseError extends Error {
  /**
   * @param {string} message human-readable reason, including the offending field.
   * @param {{ code?: string, field?: string }} [details] optional machine-readable reason.
   */
  constructor(message, details = {}) {
    super(message)
    this.name = 'SkillParseError'
    this.code = details.code ?? 'SKILL_PARSE_FAILED'
    if (details.field !== undefined) this.field = details.field
  }
}

/**
 * Split a skill file into its raw YAML frontmatter and Markdown body.
 * @param {string} raw complete file text.
 * @returns {{ yaml: string, body: string }} raw halves; `body` is trimmed.
 * @throws {SkillParseError} when the file has no well-formed frontmatter block.
 */
function splitFrontmatter(raw) {
  const text = raw.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== DELIMITER) {
    throw new SkillParseError('missing YAML frontmatter: the file must start with a --- line', {
      code: 'SKILL_FRONTMATTER_MISSING',
    })
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== DELIMITER) continue
    return {
      yaml: lines.slice(1, index).join('\n'),
      body: lines.slice(index + 1).join('\n').trim(),
    }
  }
  throw new SkillParseError('unterminated YAML frontmatter: no closing --- line', {
    code: 'SKILL_FRONTMATTER_UNTERMINATED',
  })
}

/**
 * Read the DSH invocation policy from parsed frontmatter.
 * Mirrors `@deepseek-ai/dsh-skill-filesystem`, including its rejection of the
 * legacy camelCase spellings, so a vendored skill behaves identically to one
 * discovered from disk by the built-in provider.
 * @param {Record<string, unknown>} data parsed frontmatter object.
 * @returns {{ modelInvocable: boolean, userInvocable: boolean }} resolved policy.
 * @throws {SkillParseError} on a legacy key or a non-boolean value.
 */
function readInvocation(data) {
  for (const [legacy, canonical] of [
    ['disableModelInvocation', 'disable-model-invocation'],
    ['modelInvocable', 'disable-model-invocation'],
    ['userInvocable', 'user-invocable'],
  ]) {
    if (Object.hasOwn(data, legacy)) {
      throw new SkillParseError(
        `frontmatter field "${legacy}" is unsupported; use "${canonical}"`,
        { code: 'SKILL_INVOCATION_LEGACY_KEY', field: legacy },
      )
    }
  }
  const disableModelInvocation = readBoolean(data, 'disable-model-invocation')
  const userInvocable = readBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

/**
 * Read one optional boolean-ish frontmatter field.
 * @param {Record<string, unknown>} data parsed frontmatter object.
 * @param {string} key field name.
 * @returns {boolean | undefined} resolved value, or undefined when absent.
 * @throws {SkillParseError} when the present value is not a boolean spelling.
 */
function readBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.trim().toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
      default:
        break
    }
  }
  throw new SkillParseError(`frontmatter field "${key}" must be a boolean`, {
    code: 'SKILL_INVOCATION_INVALID_VALUE',
    field: key,
  })
}

/**
 * Read one optional non-empty string field.
 * @param {Record<string, unknown>} data parsed frontmatter object.
 * @param {string} key field name.
 * @returns {string | undefined} trimmed value, or undefined when absent/blank.
 * @throws {SkillParseError} when the present value is not a string.
 */
function readString(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value !== 'string') {
    throw new SkillParseError(`frontmatter field "${key}" must be a string`, {
      code: 'SKILL_FIELD_NOT_STRING',
      field: key,
    })
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Return whether a name satisfies the DSH public skill-name grammar
 * (lowercase kebab-case), which is also the grammar of every mattpocock skill.
 * @param {string} name candidate name.
 * @returns {boolean} whether the name is acceptable.
 */
function isKebabCaseName(name) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

module.exports = {
  SkillParseError,
  isKebabCaseName,
  readBoolean,
  readInvocation,
  readString,
  splitFrontmatter,
}
