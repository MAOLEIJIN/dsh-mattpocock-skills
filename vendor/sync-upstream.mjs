#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repository = process.env.MATTPOCOCK_SKILLS_REPOSITORY ?? 'https://github.com/MAOLEIJIN/skills.git'
const ref = process.argv.includes('--ref')
  ? process.argv[process.argv.indexOf('--ref') + 1]
  : 'main'
const checkOnly = process.argv.includes('--check')
const localSource = process.argv.includes('--from')
  ? process.argv[process.argv.indexOf('--from') + 1]
  : undefined

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`)
}

const checkout = localSource ?? await mkdtemp(join(tmpdir(), 'mattpocock-skills-'))
try {
  if (localSource === undefined) run('git', ['clone', '--depth', '1', '--branch', ref, repository, checkout])
  const vendorArgs = ['vendor/vendor-skills.mjs', '--from', checkout]
  if (checkOnly) vendorArgs.push('--check')
  run(process.execPath, vendorArgs)
  if (!checkOnly) run(process.execPath, ['vendor/gen-slash-rules.mjs'])
  run(process.execPath, ['vendor/overlay-report.mjs'])
  run(process.execPath, ['vendor/vendor-skills.mjs', '--from', checkout, '--check'])
  run(process.execPath, ['vendor/gen-slash-rules.mjs', '--check'])
} finally {
  if (localSource === undefined) await rm(checkout, { recursive: true, force: true })
}
