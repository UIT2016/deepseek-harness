/**
 * SKILL.md assembly and the per-classification authoring guidance embedded in
 * the authoring prompt. The plugin owns the file format; the subagent owns the
 * prose, so the guide states the required sections rather than the content.
 * @module @deepseek-ai/dsh-experimental-skill-factory/templates
 */

import type { SkillDocType } from './types.ts'

/** The kebab-case skill-name rule enforced by the local skill provider. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/**
 * Whether a name satisfies the skill-name rule and the 64-character bound.
 * @param raw - Candidate name.
 * @returns whether the name is kebab-case and within bounds.
 */
export function isSkillName(raw: string): boolean {
  return raw.length <= 64 && SKILL_NAME_RE.test(raw)
}

/**
 * Fold arbitrary text into a candidate kebab-case name.
 * @param raw - Proposed name.
 * @returns lowercase ASCII name, or an empty string when nothing usable remains.
 */
export function normalizeSkillName(raw: string): string {
  const folded = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .replace(/-{2,}/gu, '-')
  return folded.slice(0, 64).replace(/-+$/u, '')
}

/** One authored skill, before frontmatter assembly. */
export interface SkillDraft {
  /** kebab-case skill name. */
  name: string
  /** Routing description shown in the session catalog. */
  description: string
  /** Optional extra routing guidance. */
  whenToUse?: string
  /** Markdown body without frontmatter. */
  content: string
}

/** Render one YAML frontmatter value as a JSON string (a valid YAML flow scalar). */
function yamlValue(value: string): string {
  return JSON.stringify(value)
}

/**
 * Assemble the complete SKILL.md text: YAML frontmatter plus the body with
 * exactly one trailing newline.
 * @param draft - The authored skill.
 * @returns the file content to write.
 */
export function assembleSkillMarkdown(draft: SkillDraft): string {
  const lines = ['---', `name: ${yamlValue(draft.name)}`, `description: ${yamlValue(draft.description)}`]
  if (draft.whenToUse !== undefined && draft.whenToUse.trim().length > 0) {
    lines.push(`whenToUse: ${yamlValue(draft.whenToUse.trim())}`)
  }
  lines.push('---', '')
  const body = draft.content.replace(/\s+$/u, '')
  return `${lines.join('\n')}${body}\n`
}

/**
 * The section skeleton the body must carry for its classification.
 * @param docType - Winning classification of the candidate.
 * @returns the section guide embedded in the authoring prompt.
 */
export function authoringGuide(docType: SkillDocType): string {
  const common = 'Start with a level-1 heading naming the skill.'
  switch (docType) {
    case 'document':
      return [
        'The reuse lives in a stable deliverable structure.',
        common,
        'Then a one-line statement of the deliverable, followed by these sections:',
        '- "## When to use" — the requests that should load this skill.',
        '- "## Output format" — the section skeleton observed across the evidence, with any fixed labels.',
        '- "## Steps" — the numbered procedure that produces it.',
        '- "## Quality checks" — what must hold before the deliverable is done.',
        '- "## Evidence" — the source sessions as bullet ids.',
      ].join('\n')
    case 'workflow':
      return [
        'The reuse lives in a stable procedure whose output varies per task.',
        common,
        'Then a one-line statement of the procedure, followed by these sections:',
        '- "## When to use" — the requests that should load this skill.',
        '- "## Inputs" — what the procedure needs before it starts.',
        '- "## Steps" — the numbered procedure, naming the tools each step uses.',
        '- "## Failure handling" — the branch the evidence shows when a step fails.',
        '- "## Evidence" — the source sessions as bullet ids.',
      ].join('\n')
    case 'mixed':
      return [
        'The reuse carries both a stable deliverable structure and a stable procedure.',
        common,
        'Then a one-line statement, followed by the document sections ("## When to use", "## Output format", "## Steps", "## Quality checks") and the workflow sections that apply ("## Inputs", "## Failure handling"), and "## Evidence".',
      ].join('\n')
  }
}
