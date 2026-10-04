---
name: dsh-unblock-commit-push
description: Use when a deepseek-harness commit or push is blocked by a repository hook, when the user reports that git commit or git push fails (报错/失败), or before running an aggregate documentation gate such as doc-sync while unblocking one, to triage the blocking job, repair only that blocker, commit, push, and stop without over-verifying or widening the request.
---

# DSH Unblock Commit And Push

A blocked commit is a bounded repair. The user's stated task fixes the verification bar: unblock the hook, commit, push, report. Evidence past that bar belongs to CI or to a separate task the user raises.

Two hooks gate this sequence, and both run themselves: the lefthook `pre-commit` job set during `git commit`, and the incremental repository typecheck in the lefthook `pre-push` job during `git push`. [dsh-pre-push-checks](../dsh-pre-push-checks/SKILL.md) owns that inventory and the evidence a diff needs; this skill owns the task boundary, the triage, and the stop condition. No aggregate gate is a precondition for unblocking a commit.

## Read the blocking job before touching anything

Run the failing command once and read which job reports failure. Two signatures separate the causes, and they call for opposite responses.

| Observation | Cause | Action |
|---|---|---|
| One named job fails and prints `path:line: reason` for specific files | Content the commit carries | Repair those files, or stop carrying them |
| Every job fails with `exit status 0xc0000142` alongside `bash.exe: *** fatal error - couldn't create signal pipe, Win32 error 5` | The file sandbox blocks named pipes, so `sh.exe` cannot start any hook job | Retry the same command once with the narrowest host escalation; change no code |

The whitespace job runs `git diff --cached --check`, and its output names every offending path. Use that list; do not infer the cause from a directory name or from `git status` alone.

## Unstage what the commit should not carry

A staged set that mixes the user's change with local scratch is the common cause. `git reset` unstages everything and leaves the working tree untouched; re-add the paths that belong.

Never delete a file to satisfy a gate. An unstaged path keeps its contents on disk and stops being visible to the gate, which is the whole remedy.

```sh
git reset
git add <paths belonging to the change>
git diff --cached --name-only
git diff --cached --check
```

## Ask once, in the user's language

Two decisions genuinely need the user when a staged set is mixed: which paths belong in the commit, and which remote ref receives the push. Ask both in one question, written in the language the user writes. A question in another language costs a full round trip.

Everything else is inferable from the repository and needs no question: which paths are scratch, which failure is environmental, which gate is stale.

For the push target, read `git config --get-regexp '^branch\.'` and the current remote refs first. A branch whose `branch.<name>.merge` names a different branch has no same-named remote branch, so plain `git push` fails; offer the plausible refspecs. Prefer a fast-forward and confirm it with `git merge-base --is-ancestor <remote-ref> HEAD` rather than forcing.

## Escalate once, batched

Every hook and every `tsx`, `vitest`, or `pnpm` script that captures child output needs host escalation here, and each escalation costs the user an approval. Collect the work into one escalated command: the commit and its hook, the push and its typecheck, and any per-gate verification already in scope.

## Stop when the bar is met

The floor is six commands: inspect, unstage, re-add, check, commit, push. Tool time of 12–15 minutes covers that including hook runtimes. Past roughly 20 minutes on the original ask, something outside it is being worked on; say what and why before continuing.

Commit, then push, then confirm the remote ref equals local `HEAD`:

```sh
git rev-parse HEAD origin/<target>
```

Report the commits, the gates that actually ran, and anything still failing.

## Classify every failure of a gate you chose to run

If you ran a gate beyond the two hooks, classify each failing check before repairing anything. Repair without asking only the failures the outgoing diff causes.

| Class | Evidence | Action |
|---|---|---|
| Caused by the outgoing diff | The check names paths inside the commit | Repair |
| Pre-existing on the branch | `git log -1 -- <path>` names an earlier commit, and `git diff --name-only <parent> HEAD` excludes that path | Report it; repair only when the user asks |
| Local worktree junk | `git status --porcelain` lists the path as `??` | Report it; never commit it, never delete it unasked |
| Environment or platform | The failure reproduces outside the repository, such as a `symlinkSync` `EPERM` or `UnauthorizedAccessException` | Report it with the reproduction; do not repair |

An untracked path cannot exist in a CI clone, so a check failing only on local scratch does not make the pushed branch red. State that rather than implying the push is unsafe.

## Do not fold a newly raised defect into this task

When the user answers a report with a pointer at something else, that is a new task with its own scope and its own verification bar. Finish and report the commit task first, then treat the second one separately and say so. Folding it in inflates the estimate for the simple task and hides the boundary from the user.

## Iterate with the owning gate, not the aggregate

An aggregate such as `doc-sync` costs roughly four to six minutes per run. Running it after each repair spends the whole budget re-learning the same information. When the outgoing diff genuinely reaches documentation, catalogs, or generated regions, iterate with the narrow script that owns the failing surface and run the aggregate once, after the last edit.

| Surface | Owning check |
|---|---|
| Cordis service catalog and generated signatures | `pnpm run verify-cordis-catalog` |
| Capability and event graph documents | `pnpm run verify-doc-graphs` |
| Bilingual pairs | `pnpm run verify-translation-pairing` |
| Repository references | `pnpm run verify-repository-references` |
| Package README structure | `pnpm exec vitest run scripts/doc-standard.spec.ts` |

Regenerating a document also re-records its paired side. A reviewed Chinese counterpart under `docs/` carries a header naming the two commands to run in order: the generator, then `pnpm run verify-translation-pairing --write <english-page>`.

## Enumerate a generator's curated maps in one pass

A generator guarding curated maps reports one missing entry per run, so repairing the first reveals the next and each cycle costs a full gate run. Before the second run, list every guard and fix all of them together:

```sh
grep -rn 'SERVICE_PAGE\|SERVICE_ROLES\|TYPE_LINK_EXEMPTIONS\|SERVICE_WALK_EXEMPTIONS' scripts/gen-cordis-catalog.ts scripts/gen-doc-graphs.ts
```

`SERVICE_WALK_EXEMPTIONS` accepts only a Context key the rendering projection cannot see, so a renderable service belongs in `SERVICE_PAGE`, never there. Package short names are the npm name with `@deepseek-ai/dsh-` stripped, so an entry under `packages/experimental/` carries the `experimental-` prefix.
