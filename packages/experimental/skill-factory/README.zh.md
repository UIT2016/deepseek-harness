---
description: "从单个工作区的会话及其交付文件中提炼可复用 Skill 的 profile 层与模型工具，供用户组装周期性 skill 提炼工作流。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-skill-factory

[English](README.md) | 中文

## 概述

这一层新增一个 Host 服务：读取某个工作区的会话历史与这些会话交付的文件，聚类其中反复出现的任务模式，并为每个有证据支撑的候选把一个 `SKILL.md` 写入该工作区的 skill 目录。profile 由此获得持久化检查点域、skill 使用指标监听，以及两个仓库自带 agent 预设不会挂载的模型工具。把它加入 profile，再把 `./tool` 入口组合进一个在目标工作区运行的 agent 预设。该包以实验性 bundle 形式发布，不属于任何自带 bundle。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装到 profile

把该包加入已初始化 profile 的有序层级列表：

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-skill-factory
dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-skill-factory
```

该层的 `cordis.patch.yml` 只插入一个 Host 行 `skill-factory-host`，它依赖 profile 已有的 `storage`、`storage-domain`、`storage-json` 行以及 `session-query` 与 `session-query-sqlite`；基于 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` 构建的 profile 已经带有这些行。移除该包会移除该 Host 行，其检查点域不再打开；已落盘的 `skill_factory.json` 单元仍保留在存储介质上。

### 组合模型工具

两个工具不在 bundle patch 里：需要自行提炼会话的工作区必须有一个挂载它们的 agent 预设，因为工具以调用会话的工作目录作为工作区。

```yaml
# An agent preset's agent.cordis.yml, alongside the delegation group:
- id: skill-factory-tool
  name: '@deepseek-ai/dsh-experimental-skill-factory/tool'
```

把该工具行挂在承载工作流引擎的同一组合中（`dsh-workflow` 加上 `dsh-workflow-worker-thread` 或 `dsh-workflow-ptc` 之类的引擎），因为 distill 工具通过 `ctx.workflowEngine` 启动它的抽取与撰写子代理。缺少引擎时工具会报告本次运行无法启动。

### 接入源码 checkout

源码 checkout 下 profile 以包名组合，因此该包必须先建立链接并构建，profile 才能加载它：

```sh
pnpm install          # links this workspace package
pnpm run build        # emits the lib/ entry a profile loads
```

然后把 [`setup/skill-factory-preset.patch.yml`](setup/skill-factory-preset.patch.yml) 粘贴进 `$DSH_HOME/profiles/web/cordis.patch.yml` 并重启该 profile。这段 fragment 会插入 Host 行、`skill-factory` 预设，以及惰性搜索索引。把 `@deepseek-ai/dsh-experimental-skill-factory` 加入 profile 的 `dsh.profile.bundles` 对 Host 行是等价做法，此时要删掉 fragment 自带的那个 Host 行。

### 你会得到什么

| 行或入口 | 行为 |
|---|---|
| `skill-factory-host` | 由 bundle patch 打开：`skill_factory` 检查点域、确定性流水线，以及统计已存 skill 的 `skill`／`skill_load` 调用的 `tools/result` 监听。 |
| `./tool` | 由 agent 预设挂载：`skill_factory_distill` 与 `skill_factory_status`。 |

每次运行默认增量：已进入检查点的会话被跳过，已存模式跨运行累积，且只有 `minEvidenceSessions` 个不同会话一致时聚类才成为候选。默认的 `propose` 策略下已有同名 skill 永不被覆盖：运行写出评审文件，把决定留给用户。

skill 与评审文件落在解析出的 project root —— 工作区最近的带 `.git` 的祖先目录；若没有任何祖先带 `.git`，就是工作区自身 —— 因为本地 skill provider 正是在那里发现项目级 skill。因此嵌套在仓库内的工作区会写入仓库的 `.dsh` 目录，而不是该嵌套目录自己的。

### 定时运行这个循环

周期运行就是一张 Host 任务看板卡片：pin 到目标工作区、上述预设与一个 cron 计划；Host 把每次触发作为一个真实会话在该工作区运行，因此工具无需参数即可推导出正确工作区。手动运行既可用同一张卡片的运行动作，也可在已运行于该工作区的会话里调用一次 `skill_factory_distill`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

bundle patch 只插入一行，因此 profile 无法半启用该功能。其余全部属于工具入口。

| 文件 | 角色 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | bundle 层：一个挂载 `skill-factory-host` 的 `insert` 条目。 |
| [`src/index.ts`](src/index.ts) | Host 入口：再导出服务与公共词汇。 |
| [`src/host.ts`](src/host.ts) | 服务本体：发现、检查点、聚类、落盘、指标。 |
| [`src/tool.ts`](src/tool.ts) | 两个模型工具与工作流引擎绑定。 |
| [`src/domain.ts`](src/domain.ts) | `skill_factory` 域：检查点、模式、聚类、skill、评审。 |
| [`src/digest.ts`](src/digest.ts) | 交给抽取子代理的有界会话摘要。 |
| [`src/signature.ts`](src/signature.ts)、[`src/cluster.ts`](src/cluster.ts) | 关键词签名、贪心聚类与证据门槛。 |
| [`src/scripts.ts`](src/scripts.ts) | 抽取与撰写的工作流脚本及其返回值校验。 |
| [`src/writer.ts`](src/writer.ts) | 名称校验、skill 目录布局、更新策略与评审文件。 |
| [`src/templates.ts`](src/templates.ts) | SKILL.md 组装与按分类的撰写指引。 |

该服务拥有流水线的确定性部分：通过 `ctx.sessionQuery` 列出工作区会话、构建有界摘要、对聚类做门槛判定、写入文件并更新检查点。模型驱动的部分——读取每份摘要找出可复用模式，以及为每个候选撰写一个 skill——以两次工作流脚本运行执行，经由调用方工具提供的 `runScript` 能力，因此子代理归属于调用方 agent 并继承其预设与取消。脚本返回值跨 worker 边界，因此逐字段校验后才回到服务中。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Skill 子系统](../../../docs/subsystems/skills.zh.md) —— 注册表、provider 契约，以及本包写入的本地发现根。
- [Session Query 子系统](../../../docs/subsystems/session-query.zh.md) —— 流水线执行的会话历史读取。
- [Workflow 子系统](../../../docs/subsystems/workflow.zh.md) —— 抽取与撰写阶段使用的脚本钩子。

-----

<a id="model-experience"></a>
## 模型体验

### 预设 agent 上的工具

#### 模型看到什么

两个工具：`skill_factory_distill`（模式、dry-run 标志、可选的会话 id 子集）与 `skill_factory_status`（无参数）。工具插件还注册一段点名的简短指引段落。

#### Token 影响

预设 agent 存活期间，每个请求都带两个固定 schema 与一段固定指引。

#### KV Cache 影响

预设组合与工具定义不变时前缀稳定。

### 提炼结果

#### 模型看到什么

一份纯文本报告：工作区、会话计数、模式与候选数量、每个候选一行（含处置与路径）、该工作区已存 skill 及其指标，以及任何逐会话失败。候选名与处置来自落盘结果，而非自由文本。

#### Token 影响

与候选数和 skill 数成正比；一次无新会话的增量运行只有几行。运行期间发出的子代理调用不计入该结果。

#### KV Cache 影响

结果追加到会话历史，不改写任何既有消息。提炼出的 skill 通过 skill provider 影响*下一个*会话的目录，而不是当前请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **写路径在 Host 侧。** 落盘由 Host 进程写入解析出的 skill 根，边界限制在该根与项目的 `.dsh/skill-factory` 目录内。它不经过调用 agent 的文件工具或其审批策略，因此请只在工作区与权限都经过刻意选择的预设上启用该工具。
- **不在生成的工具目录中。** `scripts/gen-tool-catalog.ts` 手工列出被记录的工具包并逐个启动；该由预设挂载的入口不在那份列表里，因此 `docs/tool-catalog.md` 不描述它的两个工具 schema。
- **域是单个 JSON 文档。** `skill_factory` 单元使用默认的单文档布局，因此每次检查点或模式写入都会重写整个单元；模式按会话累积且不会被裁剪。
- **聚类基于词面。** 签名是关键词向量，因此用互不相关词汇描述同一任务的两个会话会留在不同聚类中。不会调用任何 embedding provider。
- **命名由撰写子代理决定。** 工具给它一个派生的拉丁名称提示，子代理返回的名称决定文件名。两个候选可能选到同一名称，该冲突由更新策略裁决，而非由身份模型裁决。
- **指标是调用次数，不是质量。** 执行次数统计名称匹配该工作区已存 skill 的 `skill` 与 `skill_load` 结果；修订次数统计工厂修订与检测到的用户手工改动。从未被调用的 skill 没有信号。
- **评审文件需人工应用。** `propose` 策略写出评审文档；应用它意味着自行替换已存文件。评审队列没有 UI。
- **不与非工厂 skill 去重。** 只有当某个已存工厂 skill 覆盖了某聚类的全部会话时该候选才被跳过；同一根目录下手写的同意图 skill 不会抑制候选。
- **抽取成本按会话计。** 每个未处理会话都会变成一次带摘要的子代理调用。大工作区的首次运行相应昂贵；`maxSessionsPerRun` 限制单次运行规模。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

这些阈值对应独立 `skill-factory` 原型中的发现旋钮（重复阈值、双层一致性与最小证据数），只是把工作区文件证据换成了会话证据。未决问题：模式存储是否应裁剪或老化；skill 身份是否应是其证据的指纹而不是名称；评审队列是否需要客户端界面。

</details>
