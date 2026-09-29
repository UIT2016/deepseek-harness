---
description: "The profile layer and model tools that distill reusable skills from one workspace's sessions and their delivered files, for users composing a recurring skill-distillation workflow."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-skill-factory

English | [中文](README.zh.md)

## Summary

This layer adds a host service that reads one workspace's session history and the files those sessions delivered, clusters the repeatable task patterns it finds, and authors a `SKILL.md` per evidence-backed candidate into that workspace's skill root. A profile gains the durable checkpoint domain, the skill-usage metrics listener, and two model tools the repository's own agent presets do not mount. Add it to a profile, then compose the `./tool` entry into an agent preset that runs in the target workspace. The package ships as an experimental bundle and is not part of any in-box bundle.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

Add the package to an initialized profile's ordered layer list:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-skill-factory
dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-skill-factory
```

The layer's `cordis.patch.yml` inserts one host row, `skill-factory-host`, which needs the profile's existing `storage`, `storage-domain`, and `storage-json` rows plus `session-query` and `session-query-sqlite`; a profile built on `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-web-app` already carries all of them. Removing the package removes the host row and its checkpoint domain stops opening; the stored `skill_factory.json` unit stays on the medium.

### Compose the model tools

The tools are not in the bundle patch: a workspace that should distill its own sessions needs an agent preset that mounts them, because the tools derive their workspace from the calling session's working directory.

```yaml
# An agent preset's agent.cordis.yml, alongside the delegation group:
- id: skill-factory-tool
  name: '@deepseek-ai/dsh-experimental-skill-factory/tool'
```

Mount the tool row in the same composition as the workflow engine (`dsh-workflow` plus an engine such as `dsh-workflow-worker-thread` or `dsh-workflow-ptc`), because the distill tool starts its extraction and authoring children through `ctx.workflowEngine`. Without an engine the tool reports that the run could not start.

### Wire a source checkout

A checkout composes a profile by name, so the package must be linked and built before a profile can load it:

```sh
pnpm install          # links this workspace package
pnpm run build        # emits the lib/ entry a profile loads
```

Then paste [`setup/skill-factory-preset.patch.yml`](setup/skill-factory-preset.patch.yml) into `$DSH_HOME/profiles/web/cordis.patch.yml` and restart that profile. The fragment inserts the host row, the `skill-factory` preset, and the lazy search index. Adding `@deepseek-ai/dsh-experimental-skill-factory` to the profile's `dsh.profile.bundles` instead is equivalent for the host row, and the fragment's own host row must then be dropped.

### What you get

| Row or entry | Behavior |
|---|---|
| `skill-factory-host` | Opened by the bundle patch: the `skill_factory` checkpoint domain, the deterministic pipeline, and the `tools/result` listener that counts `skill` and `skill_load` invocations of stored skills. |
| `./tool` | Mounted by an agent preset: `skill_factory_distill` and `skill_factory_status`. |

Every run is incremental by default. Sessions already in the checkpoint are skipped, stored patterns accumulate across runs, and a cluster becomes a candidate only after `minEvidenceSessions` distinct sessions agree. Under the default `propose` policy an existing skill name is never overwritten: the run writes a review file and leaves the decision to the user.

Skills and review files land under the resolved project root — the nearest ancestor of the workspace carrying `.git`, or the workspace itself when no ancestor has one — because that is where the local skill provider discovers project skills. A workspace nested inside a repository therefore writes to the repository's `.dsh` directory, not to the nested directory's own.

### Schedule the loop

A recurring run is a Host task-board card pinned to the target workspace, the preset above, and a cron schedule; the Host runs each occurrence as a real session in that workspace, so the tool derives the right workspace without any argument. A manual run is the same card's run action, or one call to `skill_factory_distill` from a session already running in the workspace.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle patch inserts exactly one row, so a profile cannot half-enable the feature. Everything else is the tool entry.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle layer: one `insert` entry mounting `skill-factory-host`. |
| [`src/index.ts`](src/index.ts) | Host entry: re-exports the service and the public vocabulary. |
| [`src/host.ts`](src/host.ts) | The service: discovery, checkpointing, clustering, settlement, metrics. |
| [`src/tool.ts`](src/tool.ts) | The two model tools and the workflow-engine binding. |
| [`src/domain.ts`](src/domain.ts) | The `skill_factory` domain: checkpoint, patterns, clusters, skills, reviews. |
| [`src/digest.ts`](src/digest.ts) | Bounded per-session digests handed to extractors. |
| [`src/signature.ts`](src/signature.ts), [`src/cluster.ts`](src/cluster.ts) | Keyword signatures, greedy clustering, and the evidence gate. |
| [`src/scripts.ts`](src/scripts.ts) | The workflow scripts for extraction and authoring, plus their result validation. |
| [`src/writer.ts`](src/writer.ts) | Name validation, the skill-root layout, the update policy, and review files. |
| [`src/templates.ts`](src/templates.ts) | SKILL.md assembly and the per-classification authoring guide. |

The service owns the deterministic half of the pipeline: it lists the workspace's sessions through `ctx.sessionQuery`, builds bounded digests, gates clusters, settles files, and writes the checkpoint. The model-driven half — reading each digest for repeatable patterns, and authoring one skill per candidate — runs as two workflow-script runs through the `runScript` capability the calling tool supplies, so the children belong to the calling agent and inherit its presets and cancellation. Script return values cross a worker boundary and are validated field by field before they re-enter the service.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill subsystem](../../../docs/subsystems/skills.md) — the registry, provider contract, and the local discovery roots this package writes into.
- [Session Query subsystem](../../../docs/subsystems/session-query.md) — the history reads the pipeline performs.
- [Workflow subsystem](../../../docs/subsystems/workflow.md) — the script hooks the extraction and authoring phases use.

-----

<a id="model-experience"></a>
## Model Experience

### Tools on the preset's agents

#### What the model sees

Two tools: `skill_factory_distill` (mode, dry-run flag, optional session-id subset) and `skill_factory_status` (no parameters). The tool plugin also registers one short guidance section naming both.

#### Token effect

Two fixed schemas plus one fixed guidance section are present for every request while the preset's agent is live.

#### KV Cache effect

Prefix-stable while the preset composition and the tool definitions are unchanged.

### Distill results

#### What the model sees

One plain-text report: the workspace, session accounting, pattern and candidate counts, one line per candidate with its disposition and paths, the workspace's stored skills with their metrics, and any per-session failures. Candidate names and dispositions come from the settlement, not from free text.

#### Token effect

Proportional to candidate and skill counts; a no-op incremental run is a few lines. Subagent calls made during the run are not part of this result.

#### KV Cache effect

The result appends to the session's history and rewrites no earlier message. Distilled skills change the *next* session's catalog through the skill provider, not the running request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The write path is host-side.** Settlement writes through the Host process into the resolved skill root, bounded to that root and the project's `.dsh/skill-factory` directory. It does not flow through the calling agent's file tools or its approval policy, so enable the tool only on presets whose workspace and permission you chose deliberately.
- **Not in the generated tool catalog.** `scripts/gen-tool-catalog.ts` lists the documented tool packages by hand and boots each one; this preset-mounted entry is absent from that list, so `docs/tool-catalog.md` does not describe its two tool schemas.
- **The domain is one JSON document.** The `skill_factory` unit uses the default single-document layout, so every checkpoint or pattern write rewrites the whole unit; patterns accumulate per session and are not pruned.
- **Clustering is lexical.** Signatures are keyword vectors, so two sessions that describe one task with unrelated vocabulary stay in separate clusters. No embedding provider is consulted.
- **The author owns the name.** The tool gives the authoring child a derived latin name hint, and the child's returned name decides the file. Two candidates that pick the same name collide, and the collision is settled by the update policy rather than by an identity model.
- **Metrics are invocations, not quality.** Executions count `skill` and `skill_load` results whose name matches a stored skill in that workspace; revisions count factory revisions plus detected user edits of the skill file. A skill the user never invokes has no signal.
- **Review files are manual.** The `propose` policy writes a review document; applying it means replacing the stored file yourself. There is no UI for the review queue.
- **No deduplication against non-factory skills.** A candidate is skipped only when one stored factory skill already covers every session of its cluster; a hand-written skill in the same root does not suppress a candidate with the same intent.
- **Extraction cost is per session.** Every unprocessed session becomes one subagent call with a bounded digest. A large workspace's first run is correspondingly expensive; `maxSessionsPerRun` bounds one run.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The thresholds mirror the standalone `skill-factory` prototype's discovery knobs (repeat threshold, layer agreement, and evidence minimum) translated to session evidence instead of workspace files. Open questions: whether the pattern store should be pruned or aged, whether a skill's identity should be a fingerprint over its evidence rather than its name, and whether the review queue deserves a client surface.

</details>
