#!/usr/bin/env node
'use strict'

/**
 * Report the state of every DSH adaptation rule against the vendored tree.
 *
 * A rule is a literal find/replace with an expected occurrence count, so this
 * report answers three questions at once: does the anchor still exist, does it
 * appear exactly as often as the rule claims, and will two rules collide in the
 * same file (the second one applying to text the first already rewrote).
 *
 * Usage:
 *   node vendor/overlay-report.mjs [--rules <patches.json>] [--only <substring>]
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const { PACKAGED_SKILLS_ROOT } = require('../src/paths.js')
const { countOccurrences, loadOverlay, mergeRuleTables } = require('../src/overlay.js')

/** Parse the command line. */
function parseArgs(argv) {
  const options = { rules: join(HERE, "..", "overlay", "patches.json"), only: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--rules') {
      index += 1
      if (argv[index] === undefined) throw new Error('--rules requires a path')
      options.rules = argv[index]
    } else if (arg === '--quiet') {
      options.quiet = true
    } else if (arg === '--only') {
      index += 1
      if (argv[index] === undefined) throw new Error('--only requires a substring')
      options.only = argv[index]
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    console.log('usage: node vendor/overlay-report.mjs [--rules <patches.json>] [--only <substring>] [--quiet]')
    return
  }

  const manifest = await loadOverlay(options.rules)
  const byFile = mergeRuleTables(manifest.byFile, manifest.slash)

  let ok = 0
  let ready = 0
  const problems = []
  for (const [file, rules] of [...byFile.entries()].sort()) {
    if (options.only !== undefined && !file.includes(options.only)) continue
    let body
    try {
      body = await readFile(join(PACKAGED_SKILLS_ROOT, file), 'utf8')
    } catch (error) {
      problems.push(`${file}: cannot read (${error.code ?? error.message})`)
      console.log(`MISS ${file}  (file not found)`)
      continue
    }
    let working = body
    for (const [index, rule] of rules.entries()) {
      const found = countOccurrences(working, rule.find)
      const status = found === rule.expect ? 'ok  ' : found === 0 ? 'MISS' : 'AMB '
      if (status === 'ok  ') {
        ok += 1
        const replacement = Array.isArray(rule.replace) ? rule.replace.join('\n') : rule.replace
        working = working.split(rule.find).join(replacement)
      } else {
        problems.push(`${file} rule #${index + 1}: found ${found}, expected ${rule.expect} — ${rule.note ?? ''}`)
      }
      if (!options.quiet) {
        console.log(
          `${status} ${file} #${index + 1}  found=${found} expect=${rule.expect}  ${rule.note ?? ''}`.trimEnd(),
        )
      }
    }
    ready += 1
  }

  console.log(
    `\n${ok} rule(s) ready, ${problems.length} problem(s), ${ready} file(s) targeted ` +
      `(${manifest.byFile.size} hand-written file(s) + ${manifest.slash.size} normalised file(s))`,
  )
  if (problems.length > 0) {
    console.log('')
    for (const problem of problems) console.log(`- ${problem}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`overlay-report failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
