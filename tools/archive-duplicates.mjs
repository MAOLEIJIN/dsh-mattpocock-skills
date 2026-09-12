#!/usr/bin/env node
'use strict'

/**
 * Move the loose copies of Matt Pocock's skills out of a user skill root.
 *
 * Those copies predate the plugin and, because `dsh-skill-filesystem` registers
 * into the agent preset's own scope layer, they outrank the bundle regardless of
 * rank. Archiving keeps the bundle as the single source of truth and stays
 * reversible.
 *
 * Usage:
 *   node tools/archive-duplicates.mjs [--dry-run] [--root <dir>] [--backup <dir>]
 *
 *   --dry-run  list what would move, change nothing
 *   --root     skill root to clean (default ~/.agents/skills)
 *   --backup   backup directory (default <root>.backup-<UTC stamp>)
 */

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { MANIFEST_FILE } = require('../src/paths.js')

/** Parse the command line. */
function parseArgs(argv) {
  const options = {
    root: join(homedir(), '.agents', 'skills'),
    backup: undefined,
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--root') {
      index += 1
      if (argv[index] === undefined) throw new Error('--root requires a path')
      options.root = argv[index]
    } else if (arg === '--backup') {
      index += 1
      if (argv[index] === undefined) throw new Error('--backup requires a path')
      options.backup = argv[index]
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

/** UTC stamp for the backup directory name. */
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')
}

/** Return whether a path exists. */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help === true) {
    console.log('usage: node tools/archive-duplicates.mjs [--dry-run] [--root <dir>] [--backup <dir>]')
    return
  }

  const root = resolve(options.root)
  const manifest = JSON.parse(await readFile(MANIFEST_FILE, 'utf8'))
  const names = manifest.skills.map((skill) => skill.name).sort()

  const present = []
  for (const name of names) {
    const path = join(root, name)
    if (await exists(path)) present.push({ name, path })
  }

  console.log(`bundle         : ${manifest.upstream.repository} ${manifest.upstream.version}`)
  console.log(`skill root     : ${root}`)
  console.log(`bundle skills  : ${names.length}`)
  console.log(`loose copies   : ${present.length}${present.length === 0 ? ' (nothing to archive)' : ''}`)
  for (const entry of present) console.log(`  - ${entry.name}`)

  if (present.length === 0) return
  if (options.dryRun) {
    console.log('dry run: nothing was moved')
    return
  }

  const backup = resolve(options.backup ?? `${root}.backup-${stamp()}`)
  await mkdir(backup, { recursive: true })
  const moved = []
  for (const entry of present) {
    const target = join(backup, entry.name)
    await rename(entry.path, target)
    moved.push({ name: entry.name, from: entry.path, to: target })
  }
  await writeFile(
    join(backup, 'ARCHIVE.md'),
    [
      '# Archived mattpocock skill copies',
      '',
      `Moved out of \`${root}\` on ${new Date().toISOString()} because the`,
      '`dsh-mattpocock-skills` plugin (a profile bundle) now serves these skills',
      'read-only from its own package: `mattpocock/skills` ' + manifest.upstream.version + '.',
      '',
      'Restore any single skill with:',
      '',
      '```bash',
      `mv "${backup}/<name>" "${root}/<name>"`,
      '```',
      '',
      'Moved entries:',
      '',
      ...moved.map((entry) => `- \`${entry.name}\``),
      '',
    ].join('\n'),
    'utf8',
  )
  console.log(`backup dir     : ${backup}`)
  console.log(`archived       : ${moved.length} director${moved.length === 1 ? 'y' : 'ies'}`)
  console.log(`note file      : ${join(backup, 'ARCHIVE.md')}`)
}

main().catch((error) => {
  console.error(`archive-duplicates failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
