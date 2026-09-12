'use strict'

/**
 * Filesystem layout of this package.
 *
 * `src/index.js`, `src/provider.js`, and the vendoring script all need the same
 * two directories, so the paths are derived in exactly one place.
 */

const { join } = require('node:path')

/** Package root (the directory holding `package.json`). */
const PACKAGE_ROOT = join(__dirname, '..')

/** The skill tree carried inside the package: `<root>/<category>/<name>/SKILL.md`. */
const PACKAGED_SKILLS_ROOT = join(PACKAGE_ROOT, 'skills')

/** The generated vendoring manifest. */
const MANIFEST_FILE = join(PACKAGE_ROOT, 'vendor', 'skills.manifest.json')

module.exports = { MANIFEST_FILE, PACKAGE_ROOT, PACKAGED_SKILLS_ROOT }
