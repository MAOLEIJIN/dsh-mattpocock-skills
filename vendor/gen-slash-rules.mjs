#!/usr/bin/env node
/**
 * Regenerate the mechanical half of the DSH adaptation layer.
 *
 * The hand-written rules in `overlay/patches.json` rewrite prose; this script
 * produces the leftover normalisation: for every adapted file, each remaining
 * `` `/name` `` reference loses its slash, because in DSH a skill is loaded by
 * name with the `skill` tool and a session command is run by the user — the
 * slash spelling belongs to a harness this bundle no longer targets.
 *
 * Two spellings are handled separately, since one file can use both:
 *   - prose: `` the `/handoff` is narrow `` → `` the `handoff` is narrow `` (code formatting kept)
 *   - a bolded move in a table: `` **`/compact`** `` → `` **Compact** `` (a session-level move the user names)
 *
 * Counts are measured **after** the hand-written rules have run, so the two
 * halves never fight over the same text. Run this after editing hand rules,
 * then `node vendor/overlay-report.mjs` to see the result.
 *
 * Usage: node vendor/gen-slash-rules.mjs [--check]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const PATCHES = join(PACKAGE_ROOT, 'overlay', 'patches.json')
const MANIFEST = join(PACKAGE_ROOT, 'vendor', 'skills.manifest.json')
const { PACKAGED_SKILLS_ROOT } = require('../src/paths.js')
const { applyRules, countOccurrences } = require('../src/overlay.js')

/** Tokens that are paths or routes, not skill names. */
const SKIP_TOKENS = new Set(['tmp', 'settings'])
/** Files whose prose was rewritten by hand instead of mechanically. */
const skipFile = (file) => file.endsWith('PHASE-BOUNDARIES.md')
/** Capitalise a token for use as a prose move name. */
const titleCase = (token) => token[0].toUpperCase() + token.slice(1)

const check = process.argv.includes('--check')
const patches = JSON.parse(await readFile(PATCHES, 'utf8'))
const skillNames = new Set(JSON.parse(await readFile(MANIFEST, 'utf8')).skills.map((skill) => skill.name))

const byFile = new Map()
for (const rule of patches.rules) {
  const list = byFile.get(rule.file)
  if (list === undefined) byFile.set(rule.file, [rule])
  else list.push(rule)
}

/**
 * Every vendored Markdown file, bundle-relative. The normalisation is not
 * limited to files that hand-written rules touch: a skill with no hand rule can
 * still say "use /tdd here", and that reference has to lose its slash too.
 */
async function listBundleFiles(dir, prefix = '') {
  const { readdir } = await import('node:fs/promises')
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const next = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) found.push(...(await listBundleFiles(join(dir, entry.name), next)))
    else if (entry.name.endsWith('.md')) found.push(next)
  }
  return found
}

const files = {}
const candidates = (await listBundleFiles(PACKAGED_SKILLS_ROOT)).sort()
for (const file of candidates) {
  if (skipFile(file)) continue
  const raw = await readFile(join(PACKAGED_SKILLS_ROOT, file), 'utf8')
  const afterHandRules = applyRules(file, raw, byFile)
  const tokens = new Set([...afterHandRules.matchAll(/`\/([a-z0-9]+(?:-[a-z0-9]+)*)`/g)].map((match) => match[1]))
  const generated = []
  for (const token of [...tokens].sort()) {
    if (SKIP_TOKENS.has(token)) continue
    const isSkill = skillNames.has(token)
    const bolded = '**`/' + token + '`**'
    const boldCount = isSkill ? 0 : countOccurrences(afterHandRules, bolded)
    if (boldCount > 0) {
      generated.push({
        find: bolded,
        replace: '**' + titleCase(token) + '**',
        expect: boldCount,
        note: `${token} is a session-level move the user asks for, so it is named in prose`,
      })
    }
    const plainCount = countOccurrences(afterHandRules, '`/' + token + '`') - 2 * boldCount
    if (plainCount <= 0) continue
    generated.push({
      find: '`/' + token + '`',
      replace: '`' + token + '`',
      expect: plainCount,
      note: isSkill
        ? `${token} is a skill, not a command: name it instead of running it`
        : `${token} is a host session command: the user runs it`,
    })
  }
  if (generated.length > 0) files[file] = generated
}

const next = { $comment: patches.slashInvocations?.$comment ?? [], files }
const total = Object.values(files).reduce((sum, rules) => sum + rules.length, 0)

if (check) {
  const current = JSON.stringify((patches.slashInvocations ?? {}).files ?? {})
  if (current === JSON.stringify(files)) {
    console.log(`slash rules ok: ${total} mechanical rule(s) match the hand-written half`)
    process.exit(0)
  }
  console.error('slash rules are stale: run `node vendor/gen-slash-rules.mjs`')
  process.exit(1)
}

patches.slashInvocations = next
await writeFile(PATCHES, JSON.stringify(patches, null, 2) + '\n')
console.log(`wrote ${total} slash rule(s) across ${Object.keys(files).length} file(s)`)
