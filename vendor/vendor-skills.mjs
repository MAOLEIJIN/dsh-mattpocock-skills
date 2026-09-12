#!/usr/bin/env node
/**
 * Vendor Matt Pocock's skill tree into this plugin package.
 *
 * The plugin ships the upstream skills verbatim so the bundle is
 * self-contained. This script is the only writer of `skills/` and `vendor/`,
 * and it refuses to produce a package that would break the DSH skill contract:
 * every vendored `SKILL.md` must carry a kebab-case `name` and a
 * `description`, exactly as `ctx.skills` requires.
 *
 * Usage:
 *   node vendor/vendor-skills.mjs [--from <skills-1.2.3 dir>] [--check] [--quiet]
 *
 *   --from   upstream release directory (default /root/dsh-mattpocock-skills/skills-1.2.3)
 *   --check  verify the vendored tree is identical to upstream; write nothing
 *   --quiet  print only the final summary line
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { splitFrontmatter, isKebabCaseName, readInvocation, readString } = require('../src/frontmatter.js')
const { PACKAGE_ROOT, PACKAGED_SKILLS_ROOT, MANIFEST_FILE } = require('../src/paths.js')
const { createOverlay } = require('../src/overlay.js')
const { loadYaml } = require('../src/yaml.js')

const { parse: parseYaml } = loadYaml()

const VENDORED_SKILLS = PACKAGED_SKILLS_ROOT
const REPORT_FILE = join(PACKAGE_ROOT, 'vendor', 'VENDOR.md')
const DEFAULT_SOURCE = '/root/dsh-mattpocock-skills/skills-1.2.3'

/** Read the command line into an options object. */
function parseArgs(argv) {
  const options = { from: DEFAULT_SOURCE, check: false, quiet: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--from') {
      index += 1
      if (argv[index] === undefined) throw new Error('--from requires a path')
      options.from = argv[index]
    } else if (arg === '--check') {
      options.check = true
    } else if (arg === '--quiet') {
      options.quiet = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

/** Recursively list files under a directory, as POSIX-relative paths. */
async function listFiles(root) {
  const found = []
  async function walk(current) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) found.push(relative(root, path).split(sep).join('/'))
    }
  }
  await walk(root)
  found.sort()
  return found
}

/** Read and validate one upstream `SKILL.md`. */
async function readSkill(sourceFile, category, directoryName) {
  const raw = await readFile(sourceFile, 'utf8')
  const { yaml, body } = splitFrontmatter(raw)
  const data = parseYaml(yaml)
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${sourceFile}: frontmatter must be a YAML mapping`)
  }
  const name = readString(data, 'name')
  const description = readString(data, 'description')
  if (name === undefined) throw new Error(`${sourceFile}: frontmatter requires a "name"`)
  if (description === undefined) throw new Error(`${sourceFile}: frontmatter requires a "description"`)
  if (!isKebabCaseName(name)) throw new Error(`${sourceFile}: "name" is not kebab-case: ${JSON.stringify(name)}`)
  if (name !== directoryName) {
    throw new Error(`${sourceFile}: "name" ${name} does not match directory ${directoryName}`)
  }
  if (body.trim() === '') throw new Error(`${sourceFile}: skill body is empty`)
  const invocation = readInvocation(data)
  return {
    name,
    category,
    description,
    whenToUse: readString(data, 'whenToUse') ?? null,
    argumentHint: readString(data, 'argument-hint') ?? null,
    invocation,
    sha256: createHash('sha256').update(raw).digest('hex'),
    bytes: Buffer.byteLength(raw),
  }
}

/** Discover every `<category>/<name>/SKILL.md` under the upstream root. */
async function collectSkills(sourceRoot, options) {
  const skillsDir = join(sourceRoot, 'skills')
  let categories
  try {
    categories = await readdir(skillsDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`upstream skills directory not found: ${skillsDir}`)
    throw error
  }
  const records = []
  for (const category of categories.filter((entry) => entry.isDirectory()).sort(byName)) {
    const categoryPath = join(skillsDir, category.name)
    const entries = await readdir(categoryPath, { withFileTypes: true })
    for (const entry of entries.filter((item) => item.isDirectory()).sort(byName)) {
      const sourceFile = join(categoryPath, entry.name, 'SKILL.md')
      try {
        await stat(sourceFile)
      } catch (error) {
        if (error.code === 'ENOENT') {
          if (!options.quiet) console.log(`skip  ${category.name}/${entry.name}: no SKILL.md`)
          continue
        }
        throw error
      }
      records.push(await readSkill(sourceFile, category.name, entry.name))
    }
  }
  records.sort((left, right) => left.name.localeCompare(right.name))
  return records
}

/** Compare two maps of relative path to digest and return the differing paths. */
function diffDigests(expected, actual) {
  const changed = []
  for (const [path, digest] of expected) {
    const other = actual.get(path)
    if (other === undefined) changed.push({ path, reason: 'missing from vendored tree' })
    else if (other !== digest) changed.push({ path, reason: 'content differs' })
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) changed.push({ path, reason: 'unexpected extra file' })
  }
  changed.sort((left, right) => left.path.localeCompare(right.path))
  return changed
}

/** Build path → sha256 maps for the upstream and the vendored trees. */
async function digestTrees(sourceRoot, skills) {
  const wanted = new Set(skills.map((skill) => `${skill.category}/${skill.name}/`))
  const upstream = new Map()
  const vendored = new Map()
  for (const relativePath of await listFiles(join(sourceRoot, 'skills'))) {
    if (isVendoredPath(relativePath, wanted)) {
      upstream.set(relativePath, await digest(join(sourceRoot, 'skills', relativePath)))
    }
  }
  for (const relativePath of await listFiles(VENDORED_SKILLS)) {
    if (isVendoredPath(relativePath, wanted)) {
      vendored.set(relativePath, await digest(join(VENDORED_SKILLS, relativePath)))
    }
  }
  return { upstream, vendored }
}

/** Return whether a bundle-relative path belongs to one of the vendored skills. */
function isVendoredPath(relativePath, wanted) {
  const [category, directory] = relativePath.split('/')
  return wanted.has(`${category}/${directory}/`)
}

/** Hash one file's bytes. */
async function digest(path) {
  const raw = await readFile(path)
  return createHash('sha256').update(raw).digest('hex')
}

/** Sort two directory entries by name. */
function byName(left, right) {
  return left.name.localeCompare(right.name)
}

/** Copy the upstream tree into the package, with strict path containment. */
async function vendor(sourceRoot, skills, options) {
  const sourceSkills = join(sourceRoot, 'skills')
  await rm(VENDORED_SKILLS, { recursive: true, force: true })
  await mkdir(VENDORED_SKILLS, { recursive: true })
  for (const skill of skills) {
    const from = join(sourceSkills, skill.category, skill.name)
    const to = join(VENDORED_SKILLS, skill.category, skill.name)
    if (!to.startsWith(`${VENDORED_SKILLS}${sep}`)) throw new Error(`refusing to write outside the bundle: ${to}`)
    await cp(from, to, { recursive: true, dereference: true })
    if (!options.quiet) {
      const files = await listFiles(to)
      console.log(`vendor ${skill.category}/${skill.name} (${files.length} file(s))`)
    }
  }
}

/** Write the machine-readable manifest and the human-readable report. */
async function writeMetadata(sourceRoot, skills) {
  const manifest = {
    schema: 'dsh-mattpocock-skills/vendor-manifest@1',
    upstream: {
      repository: 'https://github.com/mattpocock/skills',
      version: await upstreamVersion(sourceRoot),
      sourceRoot,
    },
    vendoredAt: new Date().toISOString(),
    skillCount: skills.length,
    skills: skills.map((skill) => ({
      name: skill.name,
      category: skill.category,
      description: skill.description,
      whenToUse: skill.whenToUse,
      argumentHint: skill.argumentHint,
      invocation: skill.invocation,
      sha256: skill.sha256,
      bytes: skill.bytes,
    })),
  }
  await mkdir(dirname(MANIFEST_FILE), { recursive: true })
  await writeFile(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const modelFacing = skills.filter((skill) => skill.invocation.modelInvocable)
  const lines = [
    '# Vendored skills',
    '',
    'This file is generated by `node vendor/vendor-skills.mjs`. Do not edit by hand.',
    '',
    `- Upstream: ${manifest.upstream.repository} \`${manifest.upstream.version}\``,
    `- Source root: \`${sourceRoot}\``,
    `- Vendored at: ${manifest.vendoredAt}`,
    `- Skills: ${skills.length} (${modelFacing.length} model-invocable, ${skills.length - modelFacing.length} user-invocable only)`,
    '',
    '| Category | Skill | Invocation | Files |',
    '| --- | --- | --- | --- |',
  ]
  for (const skill of skills) {
    const policy = skill.invocation.modelInvocable ? 'model + user' : 'user only'
    const files = (await listFiles(join(VENDORED_SKILLS, skill.category, skill.name))).length
    lines.push(`| ${skill.category} | \`${skill.name}\` | ${policy} | ${files} |`)
  }

  const overlay = JSON.parse(await readFile(join(PACKAGE_ROOT, 'overlay', 'patches.json'), 'utf8'))
  const adapted = new Set(overlay.rules.map((rule) => rule.file))
  lines.push(
    '',
    '## DSH adaptation layer (`overlay/patches.json`)',
    '',
    `- Rules: ${overlay.rules.length}, touching ${adapted.size} file(s) across ${new Set(overlay.rules.map((rule) => rule.file.split('/').slice(0, 2).join('/'))).size} skill(s)`,
    `- Added skills: \`dsh-workflow\` (the model-facing map, shipped from \`overlay/skills/\`)`,
    '- These files are rewritten in memory when a skill is loaded; the copy on disk stays upstream-exact:',
    '',
  )
  for (const file of [...adapted].sort()) lines.push(`  - \`${file}\``)
  lines.push('')
  await writeFile(REPORT_FILE, `${lines.join('\n')}`, 'utf8')
}

/** Read the upstream package version, falling back to an explicit marker. */
async function upstreamVersion(sourceRoot) {
  try {
    const pkg = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Check the DSH adaptation layer: every rule must still match the vendored tree
 * with its declared occurrence count, the overlay's own skills must exist, and
 * the generated catalog must list exactly the skills that ship.
 * @returns {Promise<string[]>} problems; empty when the overlay is sound.
 */
async function checkOverlay() {
  const problems = []
  try {
    await createOverlay()
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
  }

  const overlaySkillsDir = join(PACKAGE_ROOT, 'overlay', 'skills')
  const overlaySkills = (await readdir(overlaySkillsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  for (const name of overlaySkills) {
    try {
      await stat(join(overlaySkillsDir, name, name, 'SKILL.md'))
    } catch {
      problems.push(`overlay skill ${name} has no ${name}/SKILL.md`)
    }
  }

  const catalogFile = join(overlaySkillsDir, 'dsh-workflow', 'dsh-workflow', 'SKILLS.md')
  try {
    const catalog = await readFile(catalogFile, 'utf8')
    const names = new Set([...catalog.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((match) => match[1]))
    const expected = new Set([...overlaySkills, 'dsh-workflow'])
    const manifestNames = JSON.parse(await readFile(MANIFEST_FILE, 'utf8')).skills.map((skill) => skill.name)
    for (const name of [...manifestNames, ...expected]) {
      if (!names.has(name)) problems.push(`catalog SKILLS.md does not list ${name}`)
    }
  } catch (error) {
    problems.push(`catalog SKILLS.md is unreadable: ${error.code ?? error.message}`)
  }

  return problems
}

/** Entry point. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    console.log('usage: node vendor/vendor-skills.mjs [--from <dir>] [--check] [--quiet]')
    return
  }
  const sourceRoot = resolve(options.from)
  const skills = await collectSkills(sourceRoot, options)
  const modelFacing = skills.filter((skill) => skill.invocation.modelInvocable).length
  console.log(
    `source ${sourceRoot}: ${skills.length} skill(s), ${modelFacing} model-invocable, ` +
      `${skills.length - modelFacing} user-invocable only`,
  )

  if (options.check) {
    const { upstream, vendored } = await digestTrees(sourceRoot, skills)
    const changed = diffDigests(upstream, vendored)
    const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8').catch(() => 'null'))
    const manifestNames = new Set((manifest?.skills ?? []).map((skill) => skill.name))
    const missing = skills.filter((skill) => !manifestNames.has(skill.name)).map((skill) => skill.name)
    const overlayProblems = await checkOverlay()
    if (
      changed.length === 0 &&
      missing.length === 0 &&
      overlayProblems.length === 0 &&
      manifest?.skillCount === skills.length
    ) {
      console.log('check ok: the vendored tree matches upstream, the manifest is current, and the DSH overlay applies')
      return
    }
    for (const entry of changed.slice(0, 40)) console.error(`drift ${entry.path}: ${entry.reason}`)
    if (changed.length > 40) console.error(`drift … ${changed.length - 40} more path(s)`)
    for (const name of missing) console.error(`drift manifest: ${name} is missing from vendor/skills.manifest.json`)
    for (const problem of overlayProblems) console.error(`drift overlay: ${problem}`)
    throw new Error(
      `bundle is out of date (${changed.length} drifted path(s), ${overlayProblems.length} overlay problem(s))`,
    )
  }

  await vendor(sourceRoot, skills, options)
  await writeMetadata(sourceRoot, skills)
  console.log(`wrote ${MANIFEST_FILE}`)
  console.log(`wrote ${REPORT_FILE}`)
}

main().catch((error) => {
  console.error(`vendor-skills failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
