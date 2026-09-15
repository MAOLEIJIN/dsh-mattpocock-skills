#!/usr/bin/env node
'use strict'

/**
 * Verification suite for the mattpocock skill bundle plugin.
 *
 * Run it against a DSH profile so the peer packages resolve:
 *
 *   cd /root/.dsh/profiles/web
 *   node /root/dsh-mattpocock-skills/dsh-mattpocock-skills/test/bundle.test.js
 *
 * The suite exercises the provider contract directly and then boots one real
 * `SkillRegistry` through Cordis, so the registry merge, invocation policy, and
 * on-demand body loading are all verified the way the host uses them.
 */

const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { join } = require('node:path')
const { readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')

const PROFILE_ROOT = process.env.DSH_PROFILE_ROOT ?? join(__dirname, '..')
const PROFILE_REQUIRE = createRequire(join(PROFILE_ROOT, 'node_modules', 'x.js'))
const { Context } = PROFILE_REQUIRE('@deepseek-ai/cordis')
const { SkillRegistry, isModelInvocable, isUserInvocable } = PROFILE_REQUIRE('@deepseek-ai/dsh-skill')

const plugin = require('../src/index.js')
const { createSkillBundleProvider } = require('../src/provider.js')
const { splitFrontmatter } = require('../src/frontmatter.js')

const portablePath = (value) => value.replaceAll('\\', '/')

/** Collected failures; the process exits non-zero when any test fails. */
const failures = []

/** Number of tests executed so far, for the final summary. */
let ran = 0

/**
 * Run one named test, recording a thrown assertion instead of aborting the run.
 * @param {string} title test name.
 * @param {() => unknown | Promise<unknown>} body test body.
 * @returns {Promise<void>} resolves after the test settles.
 */
async function test(title, body) {
  ran += 1
  try {
    await body()
    process.stdout.write(`ok   ${title}\n`)
  } catch (error) {
    failures.push({ title, error })
    process.stdout.write(`FAIL ${title}\n     ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

/** Build a provider for the packaged bundle. */
function provider(options = {}) {
  return createSkillBundleProvider({ ...options, logger: undefined })
}

/**
 * Boot a Cordis host with a real `ctx.skills` and this plugin mounted.
 * @param {Record<string, unknown>} [config] plugin config row.
 * @returns {Promise<{ ctx: object, dispose: () => Promise<void> }>} live host.
 */
async function bootHost(config) {
  const ctx = new Context()
  new SkillRegistry(ctx)
  const fiber = ctx.plugin({ apply: (inner) => plugin.apply(inner, config) })
  await fiber
  return {
    ctx,
    dispose: async () => {
      await fiber.dispose()
    },
  }
}

async function main() {
  await test('provider lists every vendored skill plus the DSH overlay guide', async () => {
    const candidates = await provider().list()
    const manifest = JSON.parse(await readFile(join(__dirname, '..', 'vendor', 'skills.manifest.json'), 'utf8'))
    assert.equal(candidates.length, manifest.skillCount + 1)
    for (const candidate of candidates) {
      assert.equal(candidate.provider, 'mattpocock-skills')
      assert.equal(candidate.source, 'bundled')
      assert.equal(candidate.rank, 0)
      assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      assert.ok(candidate.description.length > 0, `${candidate.name} has no description`)
      assert.ok(candidate.locator.path.endsWith('SKILL.md'))
    }
  })

  await test('provider loads a full body with a directory resource base', async () => {
    const bundle = provider()
    const candidates = await bundle.list()
    const candidate = candidates.find((entry) => entry.name === 'tdd')
    assert.ok(candidate !== undefined, 'tdd is missing from the bundle')
    const definition = await bundle.get(candidate)
    assert.ok(definition !== undefined)
    assert.equal(definition.name, 'tdd')
    assert.equal(definition.resourceBase.kind, 'directory')
    assert.ok(portablePath(definition.resourceBase.path).endsWith('/engineering/tdd'), definition.resourceBase.path)
    assert.ok(definition.content.startsWith('# Test-Driven Development'), definition.content.slice(0, 40))
    assert.ok(!definition.content.includes('description:'), 'frontmatter leaked into the body')
  })

  await test('provider keeps upstream invocation policy and support files', async () => {
    const bundle = provider()
    const candidates = await bundle.list()
    const byName = new Map(candidates.map((entry) => [entry.name, entry]))
    assert.deepEqual(byName.get('implement').invocation, { modelInvocable: false, userInvocable: true })
    assert.deepEqual(byName.get('tdd').invocation, { modelInvocable: true, userInvocable: true })
    const tdd = await bundle.get(byName.get('tdd'))
    assert.equal(tdd.metadata.upstream, 'mattpocock/skills')
    const { readFile } = require('node:fs/promises')
    const support = await readFile(join(tdd.resourceBase.path, 'tests.md'), 'utf8')
    assert.ok(support.length > 0, 'support file tests.md is empty')
  })

  await test('provider returns undefined for an unknown or stale locator', async () => {
    const bundle = provider()
    await bundle.list()
    assert.equal(await bundle.get({ name: 'not-a-skill' }), undefined)
    assert.equal(await bundle.get({ locator: { name: 'not-a-skill' } }), undefined)
  })

  await test('overlay: adapted skills carry DSH prose and the contract note', async () => {
    const bundle = provider()
    const candidates = await bundle.list()
    const byName = new Map(candidates.map((entry) => [entry.name, entry]))
    const askMatt = await bundle.get(byName.get('ask-matt'))
    assert.ok(askMatt.content.includes('**In DSH** this router names skills instead of running them'), 'router preamble missing')
    assert.ok(askMatt.content.includes('Packaged for DeepSeek Harness (DSH)'), 'the contract note is missing')
    assert.ok(!askMatt.content.includes('`/clear`'), 'the dead /clear command survived the overlay')
    assert.equal(
      bundle.diagnose().overlay.adaptedFiles.includes('engineering/ask-matt/PHASE-BOUNDARIES.md'),
      true,
      'the phase-boundary reference file is not in the adapted set',
    )
  })

  await test('overlay: untouched skills stay byte-identical to upstream', async () => {
    const bundle = provider()
    const candidates = await bundle.list()
    const byName = new Map(candidates.map((entry) => [entry.name, entry]))
    const untouched = await bundle.get(byName.get('resolving-merge-conflicts'))
    const onDisk = await readFile(join(untouched.resourceBase.path, 'SKILL.md'), 'utf8')
    assert.equal(untouched.content, splitFrontmatter(onDisk).body, 'an unadapted skill body was altered')
    const snapshot = bundle.diagnose()
    assert.equal(snapshot.skills.find((skill) => skill.name === 'resolving-merge-conflicts').adapted, false)
    assert.equal(snapshot.skills.find((skill) => skill.name === 'ask-matt').adapted, true)
    assert.ok(snapshot.overlay.ruleCount >= 20, `overlay lost rules: ${snapshot.overlay.ruleCount}`)
    assert.ok(snapshot.overlay.adaptedFiles.length >= 10, 'the adapted file set shrank unexpectedly')
    assert.equal(snapshot.overlay.skills.includes('dsh-workflow'), true)
  })

  await test('overlay: the DSH guide ships as a model-invocable skill with its references', async () => {
    const bundle = provider()
    const candidates = await bundle.list()
    const guide = candidates.find((entry) => entry.name === 'dsh-workflow')
    assert.ok(guide !== undefined, 'dsh-workflow is missing')
    assert.deepEqual(guide.invocation, { modelInvocable: true, userInvocable: true })
    const definition = await bundle.get(guide)
    assert.equal(
      portablePath(definition.resourceBase.path).endsWith('/overlay/skills/dsh-workflow/dsh-workflow'),
      true,
      definition.resourceBase.path,
    )
    for (const file of ['SKILLS.md', 'DSH-MAPPING.md']) {
      const text = await readFile(join(definition.resourceBase.path, file), 'utf8')
      assert.ok(text.length > 400, `${file} looks empty`)
    }
    const catalog = await readFile(join(definition.resourceBase.path, 'SKILLS.md'), 'utf8')
    for (const name of ['ask-matt', 'implement', 'tdd', 'dsh-workflow']) {
      assert.ok(catalog.includes(`\`${name}\``), `SKILLS.md does not mention ${name}`)
    }
  })

  await test('overlay: no bundle file still tells the model to run a skill as a command', async () => {
    const bundle = provider()
    const candidates = await bundle.list()
    // The vendored tree, not just the adapted files: a skill with no hand-written rule
    // (implement, for one) can still say "use /tdd where possible".
    const { readdir } = require('node:fs/promises')
    const skillsRoot = join(__dirname, '..', 'skills')
    const offenders = []
    const walk = async (dir, prefix) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const next = prefix === '' ? entry.name : `${prefix}/${entry.name}`
        if (entry.isDirectory()) await walk(join(dir, entry.name), next)
        else if (entry.name.endsWith('.md')) {
          const text = bundle.overlayApply(next, await readFile(join(dir, entry.name), 'utf8'))
          // `/tmp` and `/settings` are paths. `/compact` is the one command DSH really has,
          // and the adapted text deliberately points the user at it.
          const allowed = new Set(['tmp', 'settings', 'compact'])
          const tokens = [...new Set([...text.matchAll(/`\/([a-z0-9-]+)`/g)].map((m) => m[1]))].filter(
            (token) => !allowed.has(token),
          )
          if (tokens.length > 0) offenders.push(`${next}: ${tokens.join(',')}`)
        }
      }
    }
    await walk(skillsRoot, '')
    assert.deepEqual(offenders, [], `slash command references survived: ${offenders.join(' | ')}`)
    const manifest = JSON.parse(await readFile(join(__dirname, '..', 'vendor', 'skills.manifest.json'), 'utf8'))
    assert.equal(candidates.length, manifest.skillCount + 1)
  })

  await test('overlay: a stale anchor fails the whole load instead of half-applying', async () => {
    const broken = join(tmpdir(), `dsh-overlay-broken-${process.pid}.json`)
    await writeFile(
      broken,
      JSON.stringify({
        schema: 'dsh-mattpocock-skills/overlay@1',
        rules: [
          {
            file: 'engineering/tdd/SKILL.md',
            find: 'this anchor does not exist upstream',
            replace: 'x',
            expect: 1,
          },
        ],
      }),
      'utf8',
    )
    try {
      const bundle = provider({ overlayFile: broken })
      await assert.rejects(async () => bundle.list(), /anchor not found/)
    } finally {
      await rm(broken, { force: true })
    }
  })

  await test('promote upgrades a user-only skill for the model surface', async () => {
    const bundle = provider({ promote: ['implement'] })
    const candidates = await bundle.list()
    const implement = candidates.find((entry) => entry.name === 'implement')
    assert.deepEqual(implement.invocation, { modelInvocable: true, userInvocable: true })
    const others = candidates.filter((entry) => entry.name !== 'implement')
    assert.equal(others.filter((entry) => entry.invocation.modelInvocable).length, 16)
  })

  await test('disabled bundle serves an empty catalog without throwing', async () => {
    const bundle = provider({ enabled: false })
    assert.deepEqual(await bundle.list(), [])
    assert.equal(bundle.diagnose().error, 'the mattpocock skill bundle is disabled in settings')
  })

  await test('relative promote entries are reported, not silently accepted', async () => {
    assert.throws(() => plugin.normalizeConfig({ rank: -1 }), /rank must be a non-negative integer/)
    assert.throws(() => plugin.normalizeConfig({ promote: 'tdd' }), /promote must be a list of skill names/)
    assert.throws(() => plugin.normalizeConfig({ skillRoot: 42 }), /skillRoot must be a path string/)
    assert.equal(plugin.normalizeConfig({}).rank, plugin.DEFAULT_RANK)
    assert.equal(plugin.normalizeConfig({}).enabled, true)
  })

  let host
  await test('host boot: the registry serves the bundle through ctx.skills', async () => {
    host = await bootHost()
    const summaries = await host.ctx.skills.list()
    const manifest = JSON.parse(await readFile(join(__dirname, '..', 'vendor', 'skills.manifest.json'), 'utf8'))
    assert.equal(summaries.length, manifest.skillCount + 1)
    const tdd = await host.ctx.skills.get('tdd')
    assert.ok(tdd !== undefined, 'ctx.skills.get("tdd") returned undefined')
    assert.equal(tdd.provider, 'mattpocock-skills')
    assert.equal(tdd.source, 'bundled')
    assert.ok(tdd.content.includes('red → green'), 'body was not loaded from disk')
    const implement = await host.ctx.skills.get('implement')
    assert.equal(isModelInvocable(implement), false)
    assert.equal(isUserInvocable(implement), true)
    assert.equal(await host.ctx.skills.get('no-such-skill'), undefined)
  })

  await test('host boot: diagnostics service is exposed on the context', async () => {
    const snapshot = host.ctx.mattpocockSkills.provider.diagnose()
    assert.equal(snapshot.provider, 'mattpocock-skills')
    assert.equal(snapshot.rootKind, 'packaged')
    const manifest = JSON.parse(await readFile(join(__dirname, '..', 'vendor', 'skills.manifest.json'), 'utf8'))
    assert.equal(snapshot.skills.length, manifest.skillCount + 1)
    assert.deepEqual(snapshot.problems, [])
  })

  await test('host boot: plugin config (rank + promote) reaches the registry', async () => {
    const promoted = await bootHost({ rank: 123, promote: ['implement'] })
    try {
      const summaries = await promoted.ctx.skills.list()
      const implement = summaries.find((entry) => entry.name === 'implement')
      assert.equal(isModelInvocable(implement), true)
      const snapshot = promoted.ctx.mattpocockSkills.provider.diagnose()
      assert.equal(snapshot.skills.find((skill) => skill.name === 'implement').promoted, true)
    } finally {
      await promoted.dispose()
    }
  })

  await test('host dispose removes the provider from the registry', async () => {
    const disposable = await bootHost()
    await disposable.dispose()
    const summaries = await disposable.ctx.skills.list()
    assert.deepEqual(summaries, [], 'the disposed provider still serves skills')
  })

  if (host !== undefined) await host.dispose()

  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} of ${ran} test(s) failed\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`\nall ${ran} test(s) passed\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
