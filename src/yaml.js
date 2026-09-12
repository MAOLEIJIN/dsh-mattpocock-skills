'use strict'

/**
 * Single point where this bundle loads its YAML parser.
 *
 * The packaged bundle resolves `yaml` from the profile that installs the plugin
 * (the plugin declares it as a dependency). During development in the checkout
 * there is no local `node_modules`, so resolution falls back to the DSH profile
 * named by `DSH_PROFILE_ROOT`, then to `/root/.dsh/profiles/web`. Only
 * `MODULE_NOT_FOUND` is retried: a real failure inside `yaml` still surfaces.
 */

const { createRequire } = require('node:module')
const { isAbsolute, join } = require('node:path')

/** Profile root used when no override is configured. */
const DEFAULT_PROFILE_ROOT = '/root/.dsh/profiles/web'

/** Candidate require roots, most specific first. */
const ROOTS = [
  join(__dirname, 'x.js'),
  ...profileRoots().map((root) => join(root, 'node_modules', 'x.js')),
]

/**
 * Resolve the DSH profile directories that may hold the `yaml` dependency.
 * @returns {string[]} absolute profile roots.
 */
function profileRoots() {
  const override = process.env.DSH_PROFILE_ROOT
  const roots = []
  if (override !== undefined && override !== '' && isAbsolute(override)) roots.push(override)
  if (!roots.includes(DEFAULT_PROFILE_ROOT)) roots.push(DEFAULT_PROFILE_ROOT)
  return roots
}

/**
 * Load the `yaml` module from the first root that provides it.
 * @returns {typeof import('yaml')} the YAML module.
 * @throws {Error} when no candidate root provides `yaml`.
 */
function loadYaml() {
  for (const root of ROOTS) {
    try {
      return createRequire(root)('yaml')
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(
    'cannot resolve the "yaml" package; install the plugin into a DSH profile (pnpm install) ' +
      'or set DSH_PROFILE_ROOT to a profile that has it',
  )
}

module.exports = { loadYaml, profileRoots, DEFAULT_PROFILE_ROOT }
