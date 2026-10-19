/**
 * Keep this package's shipped `skill-factory` agent preset in sync with the
 * shipped `standard` composition.
 *
 * An agent preset is a complete plugin list: `@deepseek-ai/dsh-agent-preset`
 * accepts only `plugins`, with no inheritance and no include, so a customized
 * preset must be a copy of the shipped composition. A DSH upgrade that changes
 * `standard`'s rows invalidates every copy — a removed config field makes the
 * copy refuse to mount and the preset silently drops out of the session preset
 * roster. This script keeps the copy derived instead of hand-edited:
 *
 *   node packages/experimental/skill-factory/setup/sync-preset.mjs --check
 *   node packages/experimental/skill-factory/setup/sync-preset.mjs --write
 *
 * Target: `presets/skill-factory.patch.yml`, this bundle's second patch layer,
 * which the host reads as the preset declaration.
 *
 * The merge keeps what this preset owns and adopts what upstream owns:
 *
 * - A row that exists in both compositions takes the shipped `standard` copy,
 *   so upstream config and prompt-text changes (and the removal of obsolete
 *   fields such as `toolFilter`) reach the preset.
 * - A row that exists only in the deployed preset is kept verbatim and in
 *   place: the persistent pwsh shell, the prior-session search tool, and the
 *   Skill Factory delegation rows are local customizations, not upstream state.
 * - A row that exists only upstream is inserted after its shipped predecessor,
 *   unless `EXCLUDED` names it.
 *
 * `--check` (the default) exits 1 when a deployed copy is behind. `--write`
 * rewrites each listed preset's plugin list in place and leaves the rest of the
 * patch file byte-identical. A rewrite is refused unless the resulting text
 * parses back to the merged rows.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../../../..')
const standardFile = path.join(repoRoot, 'packages/bundle/web-app/presets/standard.patch.yml')

/**
 * Shipped rows this preset deliberately does not run.
 *
 * `tool-pwsh` is the per-call PowerShell tool: the preset replaces it with the
 * persistent `persistent-pwsh-shell` group, and both registrations claim the
 * tool name `pwsh`, so re-adding `tool-pwsh` would make the rows collide. The
 * per-call `tool-bash` stays (the shell group only carries pwsh).
 */
const EXCLUDED = {
  'preset-skill-factory': new Set(['tool-plugin-market', 'tool-pwsh']),
}

/**
 * `!!js` expression nodes: the scalar dialect the profile patch and the shipped
 * bundle patches share, so `disabled: !!js process.platform === 'win32'` round
 * trips instead of turning into an inert string.
 */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: data => ({ __jsExpr: data }),
  predicate: value => typeof value === 'object' && value !== null && typeof value.__jsExpr === 'string',
  represent: value => value.__jsExpr,
})
const schema = yaml.JSON_SCHEMA.extend(JsExpr)

/**
 * Preset insert rows to sync. The package's `presets/` patch is the shipped
 * declaration the bundle registers for every profile, so it is the only target:
 * the profile no longer carries a copy of this preset.
 * @returns the existing target files and their preset row ids.
 */
function targets() {
  return [
    {
      file: path.join(repoRoot, 'packages/experimental/skill-factory/presets/skill-factory.patch.yml'),
      presets: ['preset-skill-factory'],
    },
  ].filter(target => fs.existsSync(target.file))
}

/**
 * Merge one row list: shared rows take the shipped copy, local-only rows stay
 * put, shipped-only rows land after their shipped predecessor.
 * @param deployed - rows currently in the deployed preset.
 * @param shipped - rows of the shipped `standard` preset.
 * @param excluded - shipped row ids this preset does not run.
 * @returns the merged rows, in the deployed order.
 */
function mergeRows(deployed, shipped, excluded) {
  const result = deployed.map((row) => {
    const upstream = shipped.find(candidate => candidate.id === row.id)
    if (upstream === undefined) return row
    const nested = Array.isArray(row.config) && Array.isArray(upstream.config)
    return nested ? { ...upstream, config: mergeRows(row.config, upstream.config, excluded) } : upstream
  })
  for (const [index, upstream] of shipped.entries()) {
    if (excluded.has(upstream.id)) continue
    if (result.some(row => row.id === upstream.id)) continue
    const previous = [...shipped.slice(0, index)].reverse()
      .find(candidate => result.some(row => row.id === candidate.id))
    const at = previous === undefined
      ? 0
      : result.findIndex(row => row.id === previous.id) + 1
    result.splice(at, 0, upstream)
  }
  return result
}

/** The shipped `standard` preset's plugin list. */
function shippedPlugins() {
  const doc = yaml.load(fs.readFileSync(standardFile, 'utf8'), { schema })
  const definition = doc.find(entry => Array.isArray(entry?.insert))
    ?.insert.find(entry => entry?.config?.plugins !== undefined)
  if (definition === undefined) throw new Error(`${standardFile}: no agent preset definition found`)
  return definition.config.plugins
}

/**
 * Locate the plugin list of one preset insert row.
 * @param text - patch file contents.
 * @param file - patch path, for diagnostics.
 * @param presetId - the insert row id.
 * @returns the parsed rows and the line range they occupy.
 */
function locatePlugins(text, file, presetId) {
  const lines = text.split('\n')
  const rowAt = lines.findIndex(line => line === `    - id: ${presetId}`)
  if (rowAt < 0) throw new Error(`${file}: no "${presetId}" insert row`)
  const keyAt = lines.findIndex((line, index) => index > rowAt && line === '        plugins:')
  if (keyAt < 0) throw new Error(`${file}: "${presetId}" has no plugins list`)
  let end = keyAt + 1
  while (end < lines.length && (lines[end].trim() === '' || lines[end].startsWith('          '))) end++
  const parsed = yaml.load(lines.slice(keyAt + 1, end).join('\n'), { schema })
  return { lines, keyAt, end, parsed }
}

/** Render merged rows at the indentation these patch files use under `plugins:`. */
function renderRows(rows) {
  return yaml.dump(rows, { schema, lineWidth: -1, noRefs: true, quotingType: "'", indent: 2 })
    .trimEnd()
    .split('\n')
    .map(line => (line === '' ? line : `          ${line}`))
    .join('\n')
}

/** Row ids that differ between two merges, for the report. */
function differences(deployed, merged) {
  const flatten = (rows, prefix = '') => rows.flatMap(row => [
    [`${prefix}${row.id}`, row],
    ...(Array.isArray(row.config) ? flatten(row.config, `${prefix}${row.id}/`) : []),
  ])
  const before = new Map(flatten(deployed))
  const after = new Map(flatten(merged))
  const notes = []
  for (const [key] of after) if (!before.has(key)) notes.push(`  + ${key}`)
  for (const [key] of before) if (!after.has(key)) notes.push(`  - ${key}`)
  for (const [key, row] of after) {
    if (before.has(key) && JSON.stringify(before.get(key)) !== JSON.stringify(row)) notes.push(`  ~ ${key}`)
  }
  return notes
}

const args = process.argv.slice(2)
const write = args.includes('--write')
const shipped = shippedPlugins()
let drifted = false

for (const target of targets()) {
  const text = fs.readFileSync(target.file, 'utf8')
  const blocks = target.presets.map(presetId => ({
    presetId,
    ...locatePlugins(text, target.file, presetId),
  }))
  const plan = blocks.map((block) => {
    const excluded = EXCLUDED[block.presetId] ?? new Set()
    const merged = mergeRows(block.parsed, shipped, excluded)
    return { ...block, merged, notes: differences(block.parsed, merged) }
  })
  for (const item of plan) {
    if (item.notes.length === 0) {
      console.log(`${target.file}#${item.presetId}: in sync (${item.merged.length} rows)`)
      continue
    }
    drifted = true
    console.log(`${target.file}#${item.presetId}: ${item.notes.length} difference(s)`)
    for (const note of item.notes) console.log(note)
  }
  if (!write) continue
  // Rewrite from the bottom up so earlier line ranges stay valid.
  let next = text
  for (const item of plan.filter(entry => entry.notes.length > 0).sort((a, b) => b.keyAt - a.keyAt)) {
    const current = locatePlugins(next, target.file, item.presetId)
    next = [
      ...current.lines.slice(0, current.keyAt + 1),
      ...renderRows(item.merged).split('\n'),
      ...current.lines.slice(current.end),
    ].join('\n')
  }
  if (next !== text) {
    yaml.load(next, { schema })
    for (const item of plan.filter(entry => entry.notes.length > 0)) {
      const reparsed = locatePlugins(next, target.file, item.presetId).parsed
      if (JSON.stringify(reparsed) !== JSON.stringify(item.merged)) {
        throw new Error(`refusing to write ${target.file}: "${item.presetId}" does not round-trip`)
      }
    }
    fs.writeFileSync(`${target.file}.tmp`, next, 'utf8')
    fs.renameSync(`${target.file}.tmp`, target.file)
    console.log(`${target.file}: rewritten`)
  }
}

if (drifted && !write) {
  console.log('\nRe-run with --write to apply the merge.')
  process.exit(1)
}
