---
name: git-ops
description: '涉及 git 操作时触发：查看或排查仓库状态、分支与远端关系、提交、合并（含"已解决冲突但未提交"的合并落地）、重置/回退、推送与认证、commit 或 push 失败排查、工作区残留文件的取舍'
---

# Skill: 本仓库 git 操作规范（git-ops）

面向工作区 `D:\code\codex\deepseek-harness`。这个仓库长期带着"未提交的大改动 / 已解决冲突但没提交的合并"工作区状态，运行环境（DSH Windows 沙箱）又会让 git 的部分子进程机制失效。下面每条都来自实测。

## 0. 目标与顺序

用户点名 git 动作时：**先核对状态（≤1 分钟）→ 状态与用户描述不一致就先问 → 再执行**。

最容易踩的坑不是命令，而是**误判"要落地的是哪一份内容"**。核对成本极低，考古成本极高。

## 1. 硬规则

1. **只做用户点名的动作**。不顺手跑全仓 `build` / `typecheck` / `lint` / `doc-sync`（CI 负责闸门矩阵）；确实要跑，先问用户。
2. **仓库状态与用户的描述不符时，先问一句再动手**，不要自行推断后执行。典型："代码在 X 分支上、已调通，合并到 master 并 push"——先确认 `origin/master` 与 `X` 的关系、以及没提交的内容归属。
3. **破坏性操作前先存 checkpoint**（见 §5）：merge / rebase / reset / checkout / 清理之前。
4. **不改写已推送的历史**；禁止 `git push --force`（必要时 `--force-with-lease`）；禁止 `git clean -fdx`、`git checkout -f` 全量清洗——会清掉未提交成果和 node_modules。
5. **秘密不落盘、不回显**：token 不进命令行回显、不进 commit、不写进配置文件。
6. **汇报只报跑过的命令 + 前后 ref**（`git rev-parse` / `git ls-remote`）。跳过了哪个闸门要明说并给理由。

## 2. 侦察（省流，够用就停）

```powershell
cd D:\code\codex\deepseek-harness
git status --short --branch | Select-Object -First 1        # 只要分支追踪行
(git status --porcelain | Measure-Object -Line).Lines        # 只要条目数
git rev-parse --abbrev-ref HEAD; git rev-parse HEAD master 2>$null
git rev-parse origin/master upstream/master
git log --oneline -3 --decorate --graph
git ls-remote origin refs/heads/master                       # 远端真值；本地 ref 可能过期
```

**禁止**（都是实测踩过的）：

- 裸 `git status` / `git status --short` 全量打印——本仓库随时有 4000+ 条目，输出会被截断且没信息量。
- 拿 `upstream/master` 做大范围 `git diff`——`upstream` 是 `[blob:none]` 部分克隆，一次 diff 要联网拉几千个 blob（实测 ~10 分钟）。要对比就用本地 ref，或 `git merge-tree --write-tree <ours> <theirs>`（纯本地对象）。
- 在工作区做 `Get-ChildItem -Recurse` / 递归 glob——会扫进 node_modules，实测触发 300s 工具超时。列文件用 `git ls-files`、`git ls-files --others --exclude-standard`。

## 3. 判断"这份工作区状态是什么"

```powershell
Test-Path .git/MERGE_HEAD         # true = 有进行中的合并
Test-Path .git/AUTO_MERGE         # 存在 = ort 合并在工作区写过结果（可能已解决但没提交）
git stash list                    # 有人存过 stash
git diff --cached --name-only | Group-Object { $_.Substring(0,1) }   # index 与 HEAD 的差异类型
git diff --stat <ref> | Select-Object -Last 1                        # 工作区等于哪一版，只看最后一行
```

- `git diff --cached` **只有 A（新增）**：多半是 checkpoint 工具或部分 `add` 留下的痕迹，不是有人在分步 add。不要考古它的来历，直接用 §4.1 重建 index。
- 判断合并结果是否忠实：`git merge-tree --write-tree` 的冲突清单 + 结果树，够用即止。

## 4. 常见动作

### 4.1 落地"已解决冲突但未提交"的合并

`git merge` 在工作区脏时会直接拒绝；**不要重跑合并**（会二次冲突、覆盖已解决的结果）。用两父提交：

```powershell
git add -A -- . ':!<调试目录>'                                    # 排除清单见 §6
git reset -q -- <已在 index 里的调试路径>                          # add 不会撤出旧的 staged 项
(git rev-parse <theirs>) | Set-Content -NoNewline .git/MERGE_HEAD  # 第二个父
git commit --no-verify -m "Merge remote-tracking branch '<theirs>' into <branch>"
git log -1 --format='%h %s%n parents: %p'                          # 确认两个父
Test-Path .git/MERGE_HEAD                                          # 应为 False
git show --name-only --format= HEAD | Select-String -Pattern '^\.tmp-|^\.workbuddy|^dsh-deliverables-test'   # 确认没带进调试文件
```

### 4.2 让未 checkout 的分支前进到当前提交

```powershell
git branch -f master HEAD     # 只动 ref，不碰工作区；该分支正被 checkout 时会被拒绝
```

### 4.3 推送（本沙箱必读）

沙箱里 MSYS `sh` 起不来，表现为：

```
sh.exe: *** fatal error - couldn't create signal pipe, Win32 error 5
error: failed to execute prompt script (exit code 66)
fatal: could not read Username for 'https://github.com'
```

即 GCM 凭据弹窗、lefthook 的 `pre-commit` / `pre-push`（都是 sh 脚本）全不可用。可用做法（token 不回显）：

```powershell
$token = (gh auth token).Trim()                      # gh 已登录 UIT2016，scopes 含 repo
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("UIT2016:$token"))
$env:GIT_CONFIG_COUNT='1'; $env:GIT_CONFIG_KEY_0='http.extraheader'; $env:GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $b64"
git -c credential.helper= push --no-verify origin master
Remove-Item Env:GIT_CONFIG_COUNT,Env:GIT_CONFIG_KEY_0,Env:GIT_CONFIG_VALUE_0
git ls-remote origin refs/heads/master               # 证据：远端确实前进了
```

- 不要把 token 写进远端 URL——`git` 报错时会把它整条回显出来。
- `--no-verify` 在这里是**环境所迫**，不是"跳过失败"；用了必须在汇报里写明，并说明 CI 负责闸门矩阵。
- 远端：`origin` = 私有 fork `UIT2016/deepseek-harness`；`upstream` = `deepseek-ai/deepseek-harness`（blobless，只读参考）。用户说"push 到 origin"= 推 fork。

### 4.4 hook 与全仓闸门

- `core.hooksPath = .git/dsh-hooks`（lefthook）。`pre-commit`：staged lint `--fix`、第三方声明重生成、whitespace 检查；`pre-push`：`pnpm run typecheck`。
- staged 文件上千时 `{staged_files}` 会超 Windows 命令行长度，本来也跑不通 → 这种规模直接用 `--no-verify` 并说明理由。
- `pnpm run typecheck` = `build:lib:host`（全仓递归 bundle，数分钟）+ `typecheck:contracts-ready`。沙箱里 node 子进程 `execFileSync('git')` 会 `EPERM`（`scripts/client-build-environment.ts`），可用 `$env:DSH_CLIENT_COMMIT_HASH='<sha>'` 绕过。
- **宿主 GUI 正在运行时不要全仓重建 `lib/`**：宿主会读到半新半旧的产物。要跑先问用户。

## 5. 安全网（破坏性操作前 5 秒）

```powershell
$c = git stash create                                            # 只造对象，不改工作区/index
git update-ref refs/dsh/backup/<name>-<yyyyMMdd-HHmm> $c
git diff --shortstat $c HEAD                                     # 记下这棵树与 HEAD 的差异规模
```

恢复：先 `git diff --stat <checkpoint>` 确认范围，再 `git checkout <checkpoint> -- <paths>`。

## 6. 工作区残留文件

默认**不提交、也不擅自删除**（是否删除问用户）：

排除：`.tmp-audit/` `.tmp-ui/` `.tmp-repro-pet/`（~680 MB）`.tmp-profile-backup/` `.workbuddy/`（除 `memory/`）`dsh-deliverables-test/` `dsh-icon-*.png` `dsh-ui-preview.png` `thinking-effort-loaded.json`（根目录与 `apps/cli/src/` 各一份，根目录那份是**已提交**的孤儿调试 dump）`dsh-web.stdout*.log` `dsh-web.stderr*.log`

保留：`.workbuddy/memory/`（环境备忘，有复用价值）、`dsh-web.local-overlay.yml`（`start-deepseek-harness.ps1` 通过 `dsh web --patch` 在用）、`.dsh/skills/`（项目技能，就是本文件所在目录）

```powershell
git add -A -- . ':!.tmp-audit' ':!.tmp-ui' ':!.tmp-repro-pet' ':!.tmp-profile-backup' ':!.workbuddy' ':!.dsh' ':!dsh-deliverables-test' ':!dsh-icon-shortcut.png' ':!dsh-icon-window.png' ':!dsh-ui-preview.png' ':!dsh-web.local-overlay.yml' ':!thinking-effort-loaded.json' ':!apps/cli/src/thinking-effort-loaded.json'
```

## 7. 时间预算

一次"合并 + push"应在 5 分钟内结束：侦察 ≤1 min、决策或提问 ≤1 min、stage+commit ≤2 min、push ≤1 min。

超过 10 分钟即视为走偏：停下来，说明卡在哪，或直接问用户——不要继续考古、不要临时加验证、不要顺手跑全仓闸门。
