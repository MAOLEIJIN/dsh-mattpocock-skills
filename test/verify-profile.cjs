#!/usr/bin/env node
'use strict'

/**
 * Verify, without booting and without writing anything, that the composed web
 * profile really contains the mattpocock skill bundle and that its entry name
 * resolves to the installed package. It uses the launcher's own helpers
 * (`loadProfile` + `composeEntries`), so the result matches a host boot.
 *
 * Run it from the profile directory:
 *   cd /root/.dsh/profiles/web && node <this file>
 */

const { createRequire } = require('node:module')
const { join } = require('node:path')

const PROFILE_DIR = process.env.DSH_PROFILE_ROOT ?? '/root/.dsh/profiles/web'
const BUNDLE_ID = 'dsh-mattpocock-skills'

const req = createRequire(join(PROFILE_DIR, 'package.json'))
const boot = req('@deepseek-ai/dsh-app-boot')

/** Absolute path of the dsh installation's package.json, the launcher's first anchor. */
const installAnchor = join(PROFILE_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')

const profile = boot.loadProfile('dsh', 'web', installAnchor)
const composed = boot.composeEntries(profile.layers.flatMap((layer) => layer.patches).concat(profile.patches))
const rows = Array.isArray(composed) ? composed : (composed.entries ?? [])
const serialized = JSON.stringify(rows)

const layer = profile.layers.find((entry) => entry.packageName === BUNDLE_ID)
const matches = rows.filter((row) => JSON.stringify(row).includes('mattpocock'))
const entryModule = req.resolve(BUNDLE_ID)

console.log('profile dir          :', profile.dir)
console.log('bundle layers        :', profile.layers.length)
console.log('patchReload          :', profile.patchReload)
console.log('root rows composed   :', rows.length)
console.log('mattpocock layer     :', layer === undefined ? 'MISSING' : layer.patchPath)
console.log('mattpocock rows      :', JSON.stringify(matches))
console.log('row present in tree  :', serialized.includes(BUNDLE_ID))
console.log('entry module resolves:', entryModule)

const plugin = req(BUNDLE_ID)
console.log('plugin exports       :', Object.keys(plugin).join(', '))
console.log('plugin inject / name :', JSON.stringify(plugin.inject), '/', plugin.name)

process.exitCode = serialized.includes(BUNDLE_ID) && layer !== undefined ? 0 : 1
