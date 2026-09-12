'use strict'

/**
 * DeepSeek Harness plugin: Matt Pocock's agent skills as one installable bundle.
 *
 * The package carries the whole upstream set under `skills/` and serves it
 * read-only through `ctx.skills`, so the entire collection installs, updates,
 * and uninstalls as a single plugin row instead of dozens of loose copies in a
 * user skill root.
 *
 * @module dsh-mattpocock-skills
 */

const { createSkillBundleProvider } = require('./provider.js')
const { PACKAGED_SKILLS_ROOT } = require('./paths.js')

/** Cordis plugin name. */
const name = 'mattpocock-skills'

/** Service this plugin registers into. */
const inject = ['skills']

/** Skills root packaged with this plugin (`skills/<category>/<name>/SKILL.md`). */
const PACKAGED_ROOT = PACKAGED_SKILLS_ROOT

/**
 * Default precedence rank. `@deepseek-ai/dsh-skill-filesystem` uses 100–500 for
 * project and user roots and 600 for the host's own bundled root, and the
 * lowest rank wins a duplicate name within one layer; 450 therefore outranks a
 * left-over copy under `~/.agents/skills` (500) so the packaged files win,
 * while still losing to project-local customisations (100–300).
 */
const DEFAULT_RANK = 450

/**
 * Validate and normalise the loader configuration.
 * @param {Record<string, unknown>} config raw config row value.
 * @returns {{ enabled: boolean, rank: number, skillRoot?: string, promote: string[] }} normalised config.
 */
function normalizeConfig(config = {}) {
  const enabled = config.enabled !== false
  const rank = config.rank === undefined ? DEFAULT_RANK : Number(config.rank)
  if (!Number.isInteger(rank) || rank < 0) {
    throw new Error(`rank must be a non-negative integer; received ${JSON.stringify(config.rank)}`)
  }
  const promote = config.promote ?? []
  if (!Array.isArray(promote) || promote.some((entry) => typeof entry !== 'string')) {
    throw new Error('promote must be a list of skill names')
  }
  if (config.skillRoot !== undefined && typeof config.skillRoot !== 'string') {
    throw new Error('skillRoot must be a path string')
  }
  return {
    enabled,
    rank,
    ...(config.skillRoot === undefined ? {} : { skillRoot: config.skillRoot }),
    promote: [...promote],
  }
}

/**
 * Register the bundled skill provider on `ctx.skills` and expose it for
 * diagnostics through `ctx.mattpocockSkills`.
 * @param {import('@deepseek-ai/cordis').Context} ctx host context.
 * @param {Record<string, unknown>} [config] loader configuration row.
 * @returns {void}
 */
function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const provider = createSkillBundleProvider({
    skillRoot: settings.skillRoot,
    defaultRoot: PACKAGED_ROOT,
    rank: settings.rank,
    promote: settings.promote,
    enabled: settings.enabled,
    logger: ctx.logger,
  })

  ctx.skills.registerProvider(() => provider)
  ctx.effect(() => {
    const dispose = ctx.provide('mattpocockSkills', { provider, settings, packagedRoot: PACKAGED_ROOT })
    return () => dispose()
  }, 'mattpocock-skills diagnostics service')

  ctx.logger.info(
    `${name}: registered (rank ${settings.rank}, enabled ${settings.enabled}, ` +
      `promote ${settings.promote.length === 0 ? 'none' : settings.promote.join(', ')})`,
  )

  // Discovery is cheap and cached; run one pass off the apply path so the first
  // session catalog is already warm and any packaging problem is logged once.
  void provider.list().catch((error) => {
    ctx.logger.warn(
      `${name}: initial discovery failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  })
}

module.exports = { apply, inject, name, DEFAULT_RANK, PACKAGED_ROOT, normalizeConfig }
