# Skill Factory 设计架构 Review

> 对象：`@deepseek-ai/dsh-experimental-skill-factory`（v0.2.0-rc.1）+ 本机接线（`preset-skill-factory` + 任务看板卡片）。
> 目的：把现有设计摊开，标出**可改进点**。所有"证据"都来自当前 checkout 的源码行号或 2026-10-10 那次真实运行。
> 说明：本文是评审稿，不是仓库正式文档（`packages/**` 的正式文档只有 README 双语对）。

---

## 0. TL;DR

一句话：**它是一个"会话历史 → 可复用 SKILL.md"的离线提炼管线**，确定性的部分（发现、摘要、聚类、门槛、落盘、检查点）在宿主进程里，模型驱动的部分（逐会话抽模式、逐候选写技能）以子代理跑在调用方 agent 的 workflow engine 上。

三层运行形态：

```
任务看板卡片(preset=skill-factory, cron 0 2 * * *)      ← 触发与工作区锚定
        └─ 会话里挂载的模型工具 skill_factory_distill    ← 调用方 agent 的引擎/权限/取消
                └─ 宿主服务 SkillFactoryService          ← 检查点域 + 确定性管线 + 指标
                        └─ 写盘：<project>/.dsh/skills/<name>/SKILL.md
```

设计上最值得肯定的两点：**确定性/模型驱动的切分干净**，以及**子代理归属调用方 agent**（预设、取消、成本都跟着调用者走）。最薄弱的四点：**增量检查点忽略会话增长**、**聚类召回率低（词面余弦）**、**技能身份=名字**、**可观测性只到"调用次数"**。

---

## 1. 运行形态与本机接线

| 层 | 载体 | 作用 |
|---|---|---|
| 打包层 | [`cordis.patch.yml`](packages/experimental/skill-factory/cordis.patch.yml) | 只 `insert` 一行 `skill-factory-host`，profile 不能"半开"这个特性 |
| 宿主行 | `@deepseek-ai/dsh-experimental-skill-factory` → [`src/host.ts`](packages/experimental/skill-factory/src/host.ts) | 数据库域、管线、`tools/result` 指标监听 |
| 工具行 | `@deepseek-ai/dsh-experimental-skill-factory/tool` → [`src/tool.ts`](packages/experimental/skill-factory/src/tool.ts) | 两个模型工具 + 一段系统提示词；绑定调用方的 `workflowEngine` |
| 预设 | `$DSH_HOME/profiles/web/cordis.patch.yml` 的 `preset-skill-factory`（order 6） | = 随发行版 `standard` 组合 + `tool-session-query` + `skill-factory-tool`；后者放在 `delegation` 组内以拿到 `workflowEngine` 隔离 |
| 计划 | 任务看板卡片 `d37a9bb5-…`「Skill Factory：doc 工作区会话提炼」 | 工作区 `D:\code\codex\doc`、权限 `workspace-write`、`0 2 * * *`（Asia/Shanghai）、goalRun 默认开 |

关键约束（README 已写、代码也印证）：工具**不接收 workspace 参数**，工作区 = 调用会话的 `cwd`（[tool.ts:213](packages/experimental/skill-factory/src/tool.ts#L213)）；因此"定时提炼某个工作区"必须靠**在该工作区里跑一张卡片**来实现。

---

## 2. 组件与职责

| 文件 | 职责 | 关键导出 |
|---|---|---|
| [`src/host.ts`](packages/experimental/skill-factory/src/host.ts) | 服务本体：发现 → 摘要 → 调脚本 → 聚类 → 门槛 → 落盘 → 检查点 → 指标 | `SkillFactoryService`、`projectRootFor`、`nameHintFor` |
| [`src/tool.ts`](packages/experimental/skill-factory/src/tool.ts) | 模型契约与引擎绑定 | `apply`、`renderReport`、`renderStatus` |
| [`src/domain.ts`](packages/experimental/skill-factory/src/domain.ts) | 持久域 schema（zod）与 key 规则 | `skillFactoryDomainSpec`、`skillKey` |
| [`src/digest.ts`](packages/experimental/skill-factory/src/digest.ts) | 有界会话摘要 | `buildSessionDigest`、`isTopLevelSession`、`structurePortrait` |
| [`src/signature.ts`](packages/experimental/skill-factory/src/signature.ts) | 分词与 TF 向量 | `tokenize`、`patternSignature`、`cosine`、`foldCentroid` |
| [`src/cluster.ts`](packages/experimental/skill-factory/src/cluster.ts) | 贪心聚类 + 证据门 + 反对证据 | `clusterPatterns`、`gateCluster`、`opposingSessions`、`stableClusterId` |
| [`src/scripts.ts`](packages/experimental/skill-factory/src/scripts.ts) | 两个 workflow 脚本的生成与返回值校验 | `buildExtractionScript`、`buildAuthoringScript`、`parse*Results` |
| [`src/writer.ts`](packages/experimental/skill-factory/src/writer.ts) | 落盘：名字规范化、技能根、更新策略、评审文件 | `settleCandidate`、`resolveSkillRoot`、`contentHash` |
| [`src/templates.ts`](packages/experimental/skill-factory/src/templates.ts) | SKILL.md 组装与分类化写作指南 | `assembleSkillMarkdown`、`authoringGuide` |
| [`src/config.ts`](packages/experimental/skill-factory/src/config.ts) | 13 个部署可调字段 | `Config`、`ToolConfigSchema` |

---

## 3. 一次 `distill()` 的完整数据流

入口 [`host.ts:231`](packages/experimental/skill-factory/src/host.ts#L231)，全部步骤都在**一次工具调用**里同步完成：

| # | 阶段 | 代码 | 产物 / 说明 |
|---|---|---|---|
| 1 | 解析项目根 | [`host.ts:239`](packages/experimental/skill-factory/src/host.ts#L239) `projectRootFor` | 向上找最近带 `.git` 的祖先，找不到就用工作区自己 → 技能落盘根 |
| 2 | 抢运行锁 | [`host.ts:249`](packages/experimental/skill-factory/src/host.ts#L249)、[`339-347`](packages/experimental/skill-factory/src/host.ts#L339) | 域 global 上的布尔锁，`STALE_LOCK_MS = 6h` 后可抢占 |
| 3 | 对账用户手改 | [`host.ts:360-380`](packages/experimental/skill-factory/src/host.ts#L360) | 技能文件哈希 ≠ 记录里最后一版 → `revisions += 1` + 追加版本哈希 |
| 4 | 发现会话 | [`host.ts:388-392`](packages/experimental/skill-factory/src/host.ts#L388) | `sessionQuery.filterSessions([{kind:'cwd'}])`，或显式 `session_ids` |
| 5 | 选目标 | [`host.ts:395-408`](packages/experimental/skill-factory/src/host.ts#L395) | 丢子代理会话（`isTopLevelSession`）、丢已检查点（`full` 除外）、截断 `maxSessionsPerRun` |
| 6 | 有界摘要 | [`digest.ts:200-256`](packages/experimental/skill-factory/src/digest.ts#L200) | 预算分配：请求 40% / 交付物 30% / 收尾输出 30%；工具直方图 top-12；交付物结构画像 ≤3 个标题 |
| 7 | 抽取（模型） | [`host.ts:433-471`](packages/experimental/skill-factory/src/host.ts#L433)、[`scripts.ts:114-134`](packages/experimental/skill-factory/src/scripts.ts#L114) | 按 20 万字符切块 → 每块一个 workflow 脚本 → 脚本内 `parallel` 分批（`maxConcurrency`）跑 `agent(..., {schema})` |
| 8 | 落模式 + 检查点 | [`host.ts:474-508`](packages/experimental/skill-factory/src/host.ts#L474) | 先删 `sessionId#*` 再写新模式，最后写检查点记录（含 `lastSeq`） |
| 9 | 签名 | [`signature.ts:123-133`](packages/experimental/skill-factory/src/signature.ts#L123) | intent 重复一次（权重×2）+ actions/outputs/inputs/tools/docType；CJK 二元组 + 拉丁词 |
| 10 | 贪心聚类 | [`cluster.ts:53-73`](packages/experimental/skill-factory/src/cluster.ts#L53) | 单趟；与质心余弦 ≥ `similarityThreshold`(0.35) 才归并，之后折叠重归一化 |
| 11 | 证据门 | [`cluster.ts:142-179`](packages/experimental/skill-factory/src/cluster.ts#L142) | 去重会话数 ≥ `minEvidenceSessions`(2)；平均相似度 ≥ 分类阈值（document/workflow 0.4，mixed 取 max）；`score = mean × completeness` |
| 12 | 候选准备 | [`host.ts:532-560`](packages/experimental/skill-factory/src/host.ts#L532) | `stableClusterId`（成员 patternId 的 FNV-1a）；跳过已接受簇；跳过"已被现有技能完全覆盖"的簇；按 score 排序截断 `maxCandidates`(8) |
| 13 | 写作（模型） | [`host.ts:577-614`](packages/experimental/skill-factory/src/host.ts#L577)、[`scripts.ts:140-161`](packages/experimental/skill-factory/src/scripts.ts#L140) | 一次脚本、`parallel` 全量并发；按 docType 注入章节骨架 |
| 14 | 结算落盘 | [`host.ts:617-721`](packages/experimental/skill-factory/src/host.ts#L617)、[`writer.ts:169-223`](packages/experimental/skill-factory/src/writer.ts#L169) | 名字规范化 → 技能根 → 更新策略（`propose`/`replace`/`skip-existing`）→ 写 SKILL.md / 评审文件 → 更新 skill、cluster、review 记录 |

最后写 `lastRunAt/lastRunMode/sessionCount`（[`host.ts:313-320`](packages/experimental/skill-factory/src/host.ts#L313)）并释放锁，把报告渲染成纯文本回给模型（[`tool.ts:108-146`](packages/experimental/skill-factory/src/tool.ts#L108)）。

**阶段边界很清晰**：1–6、8–12、14 是纯确定性代码（可单测），7 和 13 是子代理。跨 worker 边界的返回值**逐字段校验并裁剪**（[`scripts.ts:209-264`](packages/experimental/skill-factory/src/scripts.ts#L209)），这是整条链路上最扎实的一处防御。

---

## 4. 持久化、目录布局与度量

### 4.1 持久域 `skill_factory`（v1，单 JSON 文档）

[`domain.ts:170-184`](packages/experimental/skill-factory/src/domain.ts#L170)：1 个 global + 5 张 KV 表。

| 表 | key | 记录要点 |
|---|---|---|
| `sessions` | sessionId | `lastSeq`、`processedAt`、`patternCount`（检查点） |
| `patterns` | `<sessionId>#<index>` | intent/docType/actions/inputs/outputs/tools/confidence |
| `clusters` | `stableClusterId` | 成员 patternIds、score、meanSimilarity、status、skillName |
| `skills` | `<encodeURIComponent(workspace)>\|<name>` | versions(哈希序列)、sourceSessions、metrics |
| `reviews` | 同 skills key | 评审文件路径 + diff 摘要 |
| global | — | 运行锁、`lastRunAt`、`lastRunMode`、`sessionCount` |

### 4.2 磁盘布局

- 技能：`<project root>/.dsh/skills/<name>/SKILL.md`（`skillRoot: 'user'` 时为 `$DSH_HOME/skills`）——[`writer.ts:74-76`](packages/experimental/skill-factory/src/writer.ts#L74)
- 评审：`<workspace>/.dsh/skill-factory/reviews/<name>-<ISO 时间戳>.md`——[`writer.ts:208-212`](packages/experimental/skill-factory/src/writer.ts#L208)
- 检查点文件：`$DSH_HOME/storages/skill_factory.json`
- SKILL.md 格式：YAML frontmatter（`name`/`description`/可选 `whenToUse`，用 JSON 字符串当 YAML flow 标量）+ 正文，恰好一个尾换行——[`templates.ts:59-67`](packages/experimental/skill-factory/src/templates.ts#L59)

### 4.3 度量

`tools/result` 监听器（[`host.ts:195-222`](packages/experimental/skill-factory/src/host.ts#L195)）只认 `skill` / `skill_load` 两个工具名，参数里的 `name` 命中本工作区已存技能就 `executions += 1`；`revisions` = 工厂重写次数 + 手改次数；`revisionRate = revisions / max(1, executions)`。

---

## 5. 配置面（13 个字段，全部有默认值）

[`config.ts:41-55`](packages/experimental/skill-factory/src/config.ts#L41)：

| 字段 | 默认 | 作用 |
|---|---|---|
| `similarityThreshold` | 0.35 | 归并进簇的最小质心余弦 |
| `agreementThreshold` / `taskThreshold` | 0.4 / 0.4 | document / workflow 候选的平均相似度门槛 |
| `minEvidenceSessions` | 2 | 最少去重会话数 |
| `maxConcurrency` | 4 | 抽取子代理每批并发 |
| `sessionDigestChars` | 12000 | 单会话摘要字符上限 |
| `deliverableReadBytes` | 8192 | 交付物画像读取字节上限 |
| `updatePolicy` | `propose` | 同名技能的处置策略 |
| `skillRoot` | `workspace` | 写工作区还是写 `$DSH_HOME/skills` |
| `watchMetrics` | true | 是否统计技能调用 |
| `maxSessionsPerRun` | 50 | 单次处理会话上限 |
| `maxPatternsPerSession` | 8 | 单会话模式上限 |
| `maxCandidates` | 8 | 单次写作候选上限 |

---

## 6. 并发、失败与生命周期语义

- **锁**：全局一把布尔锁；`running && now - runningStartedAt < 6h` 直接抛错（[`host.ts:343-346`](packages/experimental/skill-factory/src/host.ts#L343)）。
- **取消**：工具把 `exec.signal` 透传给发现查询、每批脚本运行（[`host.ts:262`](packages/experimental/skill-factory/src/host.ts#L262)、[`451`](packages/experimental/skill-factory/src/host.ts#L451)）；子代理归属调用方 agent，所以取消能一起收掉。
- **错误收集**：读会话/写模式失败进 `errors[]`，不中断整轮；脚本级失败只 warn（[`host.ts:464-467`](packages/experimental/skill-factory/src/host.ts#L464)）。
- **dry run**：不抢锁、不写检查点、不落盘，但脚本照跑（仍然花钱）——已在工具描述里说明。
- **`revise-only`**：跳过发现与抽取，直接用已存模式重新聚类/写作。

---

## 7. 实测：2026-10-10 17:38 那次运行

环境：工作区 `D:\code\codex\doc`，preset `skill-factory`，手动触发同一张定时卡片。

| 指标 | 值 | 来源 |
|---|---|---|
| 发现 / 处理 / 跳过 / 失败 | 18 / 14 / 0 / 0 | 运行报告 |
| 抽取模式 | 45 条（其中 26 条未成簇） | 运行报告 |
| 通过证据门的簇 | 2（score 0.6351、0.6132） | 运行报告 |
| 落盘技能 | 2 个（`16-excel-univer-worktree`、`uat-vp-docx-word`） | `.dsh/skills/` |
| 待评审 | 0（两簇都是新建而非改名） | `reviews = 0` |
| 持久域 | sessions 14、patterns 45、clusters 2、skills 2、reviews 0 | `$DSH_HOME/storages/skill_factory.json` |
| 检查点 `lastSeq` 范围 | 4 – 2432 | 同上 |
| 耗时 | distill 17:38:49 → 17:41:42（≈3 分钟），另起 ~16 个子代理 | 运行报告 + 会话日志 |

两个可直接观察到的现象，后文作为缺陷证据：

1. **18 − 14 = 4 个会话没有出现在任何计数口径里**。其中 3 个可确证是 doc 工作区里 `origin=subagent` 的子代理会话（跑前存在），它们被 `isTopLevelSession` 静默丢弃。
2. **它把自己这次运行的会话也提炼了**（检查点里 `session-01f1320e`，2 条模式，意图就是"调用 skill_factory_distill 并写报告"）。这是自指：定时跑下去会持续产出"关于跑 skill-factory 的模式"。

---

## 8. 设计上做对的地方（建议保留）

1. **确定性 / 模型驱动切分干净**：阈值、聚类、门槛、策略全在代码里，模型只产出内容，不参与"要不要建技能"的判定。
2. **跨边界返回值逐字段校验**：worker 回来的 JSON 一律重新构造并裁剪，不信任 worker。
3. **子代理归属调用方 agent**：预设、权限、取消、成本都跟着调用者；宿主服务不自己造 agent。
4. **默认 `propose` 不覆盖既有技能**：写评审文件而不是静默改写，符合"用户资产优先"。
5. **签名在读取时计算**：改分词/权重不需要迁移已存记录。
6. **有界摘要**：每个会话的输入预算固定，成本可预估（缺点是召回，见 F7）。
7. **有真实单测**：`signature` / `cluster` / `digest` / `scripts` / `writer` / `service` 六个 spec。

---

## 9. 可改进点

> 证据栏里的行号对应当前 checkout；"实测"指第 7 节那次运行。

### P0 — 会造成结果错误或卡死

**F1 检查点忽略会话增长，长会话永远不会被重新提炼**
- 证据：[`host.ts:400`](packages/experimental/skill-factory/src/host.ts#L400) 只判断 sessionId 是否在检查点里；[`lastSeq`](packages/experimental/skill-factory/src/domain.ts#L37) 写进去之后**全仓库再没读过**（grep 仅命中写入点与类型/测试）。实测 14 条检查点记录里 `lastSeq` 从 4 到 2432。
- 影响：一个持续多天、不断追加请求的工作会话，在首次跑完后**新增的工作全部丢失**；而 DSH 的会话是长期的，这正是最常见的形态。
- 建议：增量判据改为"检查点存在且 `lastSeq` ≥ 当前日志末尾 seq"，增长时重抽（可先整段重抽，后续再做差量）；报告里区分"新增会话"和"增长会话"。

**F2 被过滤的会话没有任何计数口径**
- 证据：[`host.ts:255`](packages/experimental/skill-factory/src/host.ts#L255) `total = records.length`，而 `skipped` 只统计检查点命中（[`host.ts:400-403`](packages/experimental/skill-factory/src/host.ts#L400)）；`isTopLevelSession` 的丢弃与 `maxSessionsPerRun` 的截断都不计数。实测 18 发现 / 14 处理 / 0 跳过 / 0 失败，4 个会话无从解释（可确证 3 个为子代理会话）。
- 影响：报告不可对账，用户与验收裁判都无法判断"少了的会话去哪了"。
- 建议：`SkillFactoryReport.sessions` 增加 `filtered`（子代理/非顶层）与 `truncated`（超出单次上限），并在文本报告里打印。

**F3 抽取脚本整块失败被静默吞掉**
- 证据：[`host.ts:464-467`](packages/experimental/skill-factory/src/host.ts#L464) `if (!run.ok) { warn; continue }`：既不入 `errors[]`，也不给会话留任何标记。
- 影响：报告 `failed` 只反映 `errors.length`，脚本全挂时报告仍显示"失败 0"，用户看到的是"没有新模式"而不是"这一批没跑成"。
- 建议：脚本失败按 chunk 记入 `errors`（带阶段标签），并把该 chunk 的会话排除在检查点写入之外（现在的行为恰好是可重试的，只是没被告知）。

**F4 `processed` 与 `failed` 语义混合**
- 证据：`processed += 1` 在**摘要构建成功**处自增（[`host.ts:273`](packages/experimental/skill-factory/src/host.ts#L273)），与该会话抽取是否成功无关；`errors[]` 混装"读会话失败""写模式失败"。
- 影响：`processed` 看起来像"提炼成功的会话数"，实际是"摘要成功数"。
- 建议：拆成 `digested / extracted / failed`，错误对象带 `stage`。

**F5 运行锁全局、非原子、跨工作区互相阻塞**
- 证据：锁在 global 上（[`domain.ts:140-151`](packages/experimental/skill-factory/src/domain.ts#L140)），`acquireLock` 是 `get` → `await set`（[`host.ts:341-346`](packages/experimental/skill-factory/src/host.ts#L341)），中间有 await 边界，两个并发 run 可能都通过检查；崩溃后最长阻塞 6 小时（[`host.ts:62`](packages/experimental/skill-factory/src/host.ts#L62)）。
- 影响：A 工作区的一次卡住会让 B 工作区的定时提炼整晚失败；"另一个 distill run 正在进行"这句报错还不告诉你是哪个工作区。
- 建议：锁按 workspace 分键（毕竟管线本身已经按 workspace 过滤），或提供原子 claim；报错里带上持有者 workspace 与开始时间。

**F6 状态工具的 `sessions` / `lastRunAt` 是全局值，但描述说"调用方工作区"**
- 证据：[`host.ts:167`](packages/experimental/skill-factory/src/host.ts#L167) `sessions: handles.sessions.size`；`lastRunAt/lastRunMode` 在 global 上（[`host.ts:313-320`](packages/experimental/skill-factory/src/host.ts#L313)）。技能列表倒是按 workspace 过滤了（[`host.ts:174-192`](packages/experimental/skill-factory/src/host.ts#L174)）。
- 影响：多工作区部署下状态面板会撒谎（把别的工作区的运行当成自己的）。
- 建议：`sessions` 按 workspace 计数；`lastRunAt` 记录到每个 workspace（或至少返回时标注作用域）。

### P1 — 影响产出质量、成本或规模

**F7 聚类召回率低：词面余弦 + 高门槛**
- 证据：签名是 TF 余弦（[`signature.ts:123-133`](packages/experimental/skill-factory/src/signature.ts#L123)），归并阈值 0.35、成簇还要 ≥2 个不同会话。实测 **45 条模式只成 2 簇，26 条孤立**；README 也承认"同一任务用不同词汇描述就分不到一簇"。
- 影响：这是当前最大的"漏提炼"来源——用户真正重复的工作，只要措辞不同就永远不成技能。
- 建议（按成本递增）：① 让抽取子代理额外输出一个**规范化 `taskKey`/canonical intent**，先用 key 分桶再用余弦做簇内排序；② 对孤立模式做一次"归并"子代理调用（把 N 条 intent 直接交给模型判断哪些是同一件事）；③ 引入 embedding provider。①几乎零额外成本，且不改现有阈值语义。

**F8 技能身份 = 名字，簇身份 = 成员集合**
- 证据：`skillKey(workspace, name)`（[`domain.ts:26-28`](packages/experimental/skill-factory/src/domain.ts#L26)）；`stableClusterId` 是成员 patternId 的哈希（[`cluster.ts:210-223`](packages/experimental/skill-factory/src/cluster.ts#L210)）。
- 影响：① 两个不同簇写出同名技能会互相覆盖/互相提议；② 簇成员一变就是**新簇 id**，同一技能会被反复"新建"，`propose` 策略下评审文件不断堆积。
- 建议：簇身份改为 name 或质心指纹（阈值内视为同一簇），并让 skill 记录持有"哪些簇/证据版本"。

**F9 `sourceSessions` 取并集，会把新会话"吞掉"**
- 证据：[`host.ts:672`](packages/experimental/skill-factory/src/host.ts#L672) `dedupe([...existing.sourceSessions, ...candidate.sessionIds])`，而覆盖判断用它做包含测试（[`host.ts:563-574`](packages/experimental/skill-factory/src/host.ts#L563)）。
- 影响：一个老技能会把后续所有相关会话都记在自己名下，从而抑制本应独立产生的其它候选。
- 建议：证据按簇（或版本）分别保留，覆盖判断只看同一簇的历史。

**F10 非文本交付物拿不到结构画像**
- 证据：[`structurePortrait`](packages/experimental/skill-factory/src/digest.ts#L127) 只认 markdown 标题，否则回退"第一个非空行取 80 字符"。实测工作区交付物是 xlsx/docx/univer，两个落盘技能恰好都是"文档结构"类，说明这里本可以拿到更强信号。
- 影响：对文档型工作区（正是本机的形态），抽取子代理看不到交付物的真实结构，只能靠会话文字猜。
- 建议：按扩展名分支——xlsx 取 sheet 名 + 表头行，docx 取标题层级，univer 取 unit 概览；不可解析类型直接跳过而不是吐二进制首行。

**F11 交付物读取先整文件读入再切片**
- 证据：[`host.ts:422-430`](packages/experimental/skill-factory/src/host.ts#L422) `readFile(path,'utf8')` 后 `slice(0, deliverableReadBytes)`；`renderDeliverable` 里又切一次。
- 影响：交付物是几十 MB 的 xlsx/docx 时，内存峰值与 IO 都按整文件算。
- 建议：先 `stat` 限制大小，或按字节流读上限；二进制扩展名直接跳过。

**F12 子代理没有统一预算，写作阶段还是全量并发**
- 证据：抽取按 `maxConcurrency` 分批（[`scripts.ts:123-125`](packages/experimental/skill-factory/src/scripts.ts#L123)），写作一次 `parallel` 铺满（[`scripts.ts:153`](packages/experimental/skill-factory/src/scripts.ts#L153)）；两者的输入预算都写在代码常量/配置里，但**报告不返回任何用量**。
- 影响：首跑成本 ≈ 会话数（上限 50，实测 14 个会话起了 ~16 个子代理）；定时跑的人看不到花了多少。
- 建议：统一并发来源；给一次运行加"子代理数 / token 预算"上限；把用量（calls/tokens）记入报告——任务看板的验收裁判已经算 usage，宿主这里也拿得到。

**F13 自观察循环**
- 证据：实测检查点里的 `session-01f1320e` 就是本次运行自己的会话，抽出了 2 条"调用 skill_factory_distill"的模式。
- 影响：定时跑久了会持续积累"关于运行工厂"的模式，迟早铸出一个自指技能；也稀释了聚类。
- 建议：默认排除本工具自身的调用会话（`sessionId` 去重或按来源标记），或提供 `excludeSessionIds` / 会话来源过滤配置。

**F14 指标把失败调用也算作执行，工具名写死**
- 证据：[`host.ts:195-206`](packages/experimental/skill-factory/src/host.ts#L195) 只看 `exec.name` 与参数 `name`，不检查结果是否 `isError`；`SKILL_LOAD_TOOLS` 是模块常量（[`host.ts:59`](packages/experimental/skill-factory/src/host.ts#L59)）。
- 影响：加载失败的技能会抬高 `executions`，让 `revisionRate` 偏乐观。
- 建议：过滤失败结果；工具名走配置（config.ts 已有 `ToolConfig` 的先例）。

**F15 指标本身很弱（README 已承认）**
- 证据：`revisions` 混装"工厂重写"和"用户手改"（[`host.ts:360-380`](packages/experimental/skill-factory/src/host.ts#L360)）；`revisionRate` 分母是调用次数，未被加载的技能永远 0 信号。
- 建议：区分 `factoryRevisions` / `userEdits`；对未被调用的技能给"从未命中"标记而不是 0 比率。

### P2 — 可维护性、产品面与规模化

**F16 域是单个 JSON 文档、patterns 只增不删**（README 已承认）
- 影响：每次检查点/模式写入都重写整个单元；长期工作区写放大明显。
- 建议：按 workspace 分片，或加老化/裁剪（例如仅保留最近 N 次运行仍能成簇的模式）。

**F17 评审队列没有出口**
- 证据：`reviews` 只在 `propose` 时写入（[`host.ts:702-711`](packages/experimental/skill-factory/src/host.ts#L702)），用户手工采纳后没有任何对账/清理路径。
- 建议：`reconcileUserEdits` 顺手对账评审（文件已被采纳 → 标记完成），并考虑给看板/客户端一个列表。

**F18 运行报告靠卡片提示词现写**
- 证据：工具只回渲染文本（[`tool.ts:108-146`](packages/experimental/skill-factory/src/tool.ts#L108)），本机那张卡片的提示词要求模型自己写 `reports/<date>.md` 并 `present`。
- 影响：报告质量取决于提示词，且与工具的返回结构重复。
- 建议：工具支持可选 `report_path`（自己落盘、原子写），卡片提示词退化为"调用 + 汇报"。

**F19 与手写技能无去重**（README 已承认）：候选只与工厂自己的技能比对，同名手写技能不会抑制候选。
**F20 `maxSessionsPerRun` 截断依赖查询顺序**：`selectTargets` 直接 `break`（[`host.ts:405`](packages/experimental/skill-factory/src/host.ts#L405)），没有显式按 `createdAt` 排序；README 声称 newest first，但排序由 `session-query` 决定，建议在管线内固定。
**F21 常量语义易误读**：`EXTRACTION_ARGS_BUDGET`（20 万字符）是**脚本入参预算**，不是单子代理预算；名字容易让人以为在限制每次子代理调用。
**F22 长工具调用**：一次 distill 3 分钟（实测），交互式调用会独占一个 step；定时卡片形态没问题，但手动使用时建议支持后台 job 或进度事件。
**F23 提示词注入面**：digest 文本与抽取结果都会拼进下游提示词（[`scripts.ts:125`](packages/experimental/skill-factory/src/scripts.ts#L125)、[`153-157`](packages/experimental/skill-factory/src/scripts.ts#L153)），现有"evidence, never instructions"是唯一防线。建议在评审文件里保留来源标注，便于人工审计被注入的候选。

---

## 10. 建议的下一步（按性价比排序）

1. **先修 F1（增量判据）+ F2/F3/F4（报告口径）**：这四条决定"定时跑到底攒下了什么、少的东西去哪了"，改动都在 `host.ts` 内部，不动数据模型。
2. **再做 F7 的第一步（规范化 `taskKey`）**：让抽取子代理多返回一个字段，聚类先用 key 分桶——不改阈值语义、不加外部依赖，预计能显著提升成簇率。F13（排除自观察会话）与它同批做，成本极低。
3. **然后处理身份问题（F8/F9）**：簇身份与证据归属，是"反复新建同一个技能"和"老技能吞新会话"的根因；越晚做，已积累的 `clusters`/`skills` 记录越难迁移（域版本目前是 v1，还没有迁移先例）。

规模与产品面（F16–F18）可以等项目确认要长期跑再看。

---

### 附：本文证据的可复核方式

- 代码：`packages/experimental/skill-factory/src/*.ts`（行号见各条）
- 运行数据：`D:\code\codex\doc\.dsh\skill-factory\reports\2026-10-10.md`
- 持久域现状：`C:\Users\vell\.dsh\storages\skill_factory.json`（sessions 14 / patterns 45 / clusters 2 / skills 2 / reviews 0）
- 卡片：任务看板 `d37a9bb5-54e3-4ece-a398-79d398714ee8`
