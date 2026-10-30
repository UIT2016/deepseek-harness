# DSH 插件清单（换机同步用）

> 用途：记录本机 DeepSeek Harness 已启用 / 已安装的插件与版本，换机器或搭建另一个 DSH 实例时按此清单复现。
> 采集时间：2026-10-30；DSH 版本 `0.2.2-alpha.2`（源码检出 `D:\code\codex\deepseek-harness`，fork `UIT2016/deepseek-harness`）。
> 本文件**不含任何密钥**：API key、QQ appSecret、Cookie 等一律不记录，需在各机器单独填写（见第 6 节）。变更历史见第 8 节。

## 1. 生效环境

| 项 | 值 |
| --- | --- |
| DSH 版本 | `0.2.2-alpha.2`（`pnpm dsh web --port 3080`，由 `D:\code\codex\dsh-launcher` 拉起） |
| 目标 profile | `web`（GUI）。`tui` 只装 `@deepseek-harness-tui/dsh-tui` 0.15.0；`headless` / `web-safe` / `webadd` 无第三方插件 |
| profile 目录 | `C:\Users\vell\.dsh\profiles\web` |
| 插件声明 | `profiles/web/package.json` → `dependencies` + `dsh.profile.bundles` |
| 配置层 | `profiles/web/cordis.patch.yml`（在所有 bundle 层之后应用；`cordis.yml` 恒为 `[]`，不要编辑） |
| 插件管理器台账 | `profiles/web/.dsh-market/state.json`（`disabled` 数组）+ `log.ndjson` |

一个插件真正生效需要三处同时满足：依赖已装上、包名在 `dsh.profile.bundles` 里、没有被 `cordis.patch.yml` 的 `disabled: true` 或市场 `state.json` 的 `disabled` 关掉。反过来，从 `bundles` 里移除也等于不加载——所以「关闭」有两种做法，本清单按实际加载结果标注。

## 2. 已启用的第三方插件（25 个）

### 2.1 Web GUI / 界面（13 个）

| 插件 | 版本 | 仓库 | 作用 |
| --- | --- | --- | --- |
| `dsh-better-sidebar` | 0.28.2 | `omdsh-dev/DSH-better-sidebar` | 右侧栏：文件树、编辑器、改动、任务、侧聊，按会话隔离；其他插件靠它的 sidecar 服务注册标签页 |
| `dshmarket` | 1.73.5 | `dsh-market/dsh-market` | 插件市场（装插件、启停、更新都走它） |
| `dsh-config-manager` | 0.2.2 | `xiajiajun516/dsh-config-manager` | 配置备份 / 恢复 / 导出 / 迁移，含回滚点 |
| `dsh-context` | 0.78.2 | `bowenliang123/dsh-context` | 上下文构成与演化看板 |
| `dsh-status-rotator` | 0.38.0 | `01Virex/dsh-status-rotator` | 状态栏轮播 |
| `dsh-my-guardian` | 0.4.8 | `baosfeng/my-dsh-plugins` | 插件治理守护：新插件先候选区热挂载，失败自动禁用 / 冻结，安全模式 |
| `dsh-pet` | 0.3.8 | `PC2005-cloud/dsh-pet` | 桌面宠物 |
| `dsh-session-workbench` | 1.0.3 | `PolinniZhong/dsh-session-workbench` | 会话工作台：会话库全文搜索 + 一键 @ 召回给 AI + 会话视图（标签栏显示/排序）管理 |
| `dsh-startup-screen` | 1.1.2 | `6shenhonghong9/dsh-startup-screen` | 启动界面与启动动画（黑幕 → 过曝 → 授权序列），身份名称等参数在 DSH 设置页可改 |
| `@nonamelego/dsh-catppuccin` | 0.6.5 | `NoNameLeGo/dsh-catppuccin-theme` | Catppuccin 四套主题 + 玻璃拟态（当前 `frappe`，mica 雾化） |
| `@linxin666/dsh-client-ui-*`（2 个） | 0.4.12 | `zhu1090093659/dsh-web` | `dsh-client-ui-git-graph`（分支选择 + Git 图）、`dsh-client-ui-skill-explorer`（技能中心） |
| `@michengai/dsh-archive-manager` | 1.1.22 | `MichengAI/dsh-archive-manager` | 会话归档 / 恢复 / 收藏 / 永久删除，损坏日志诊断 |

### 2.2 宿主能力 / 工具（11 个）

| 插件 | 版本 | 仓库 | 作用 |
| --- | --- | --- | --- |
| `dsh-ops` | 0.4.4 | `T-Auto/dsh-ops` | Windows x64 原生文件与 PTC 工具（`ops_*`），自带 bash 载荷与 PowerShell 7 引擎；profile 里以 `dsh-ops/shell`、`dsh-ops/file` 两行组件挂载 |
| `cc-safety-net` | 2.7.1 | `kenryu42/cc-safety-net` | 危险命令 / 密钥文件访问拦截（默认 standard 级别；standard 不拦"路径由命令替换拼出来"的递归强删，需要时用 strict） |
| `dsh-mnemon` | 0.5.37 | `omdsh-dev/dsh-mnemon` | 分层记忆（runtime memory / 文档 / recall） |
| `dsh-better-reasoning-effort` | 0.5.4 | `HaoyueQin/dsh-better-reasoning-effort` | 第三方 provider 的推理强度与图片输入按模型声明，在官方模型页里编辑 |
| `dsh-univer-office` | 0.3.9 | `dream-num/dsh-univer-office` | Univer 办公套件（`univer_*` 工具、`.univer` 文件） |
| `dsh-bili-scroll` | 2.0.2 | 上游 `c1overzz/dsh-bili-scroll`（本地 link，fork `UIT2016/dsh-bili-scroll`） | 每天替人刷一轮 B 站：读字幕挑值得的、写日报并 @ 本人；12 个 `bili_*` 工具 |
| `@uit2016/dsh-bili-agent` | 0.1.0 | `UIT2016/dsh-bili-agent`（本地 link） | agent preset `preset-bili-duty`（B站刷视频），面向 dsh-bili-scroll 的只读工作流 bundle |
| `@local/dsh-investment-mind` | 1.0.0 | `UIT2016/dsh-investment-mind`（私有，本地 link） | 个人投资观点库（SQLite）+ Investment Mind preset |
| `clearai-dsh` | 0.5.7 | `Clearailhc/clearai-dsh` | ClearAI agent preset（证据校验的研究流程） |
| `@tt-a1i/archify-dsh` | 1.0.0 | `tt-a1i/archify` | Archify 架构图 skill（skill-only bundle） |
| `@deepseek-ai/dsh-experimental-skill-factory` | 0.2.0-rc.1 | 随 DSH 检出（`packages/experimental/skill-factory`，本地 link） | 从会话与交付物中蒸馏可复用 skill |

### 2.3 需要外部凭据 / 服务的 1 个

| 插件 | 版本 | 仓库 | 作用 | 需要补的东西 |
| --- | --- | --- | --- | --- |
| `@local/xhs-mcp` | 1.1.0 | `UIT2016/xhs-mcp-local`（本地 link） | 本地拉起 `xiaohongshu-mcp` 并接成 MCP server | 小红书登录 Cookie（`mcp__xiaohongshu__*` 工具） |

### 2.4 本地 link 包的路径（上面已计数，这里只记路径）

| 包名 | 版本 | link 目标 |
| --- | --- | --- |
| `@local/xhs-mcp` | 1.1.0 | `D:\code\codex\xhs\dsh-bundle-xhs-mcp` |
| `@local/dsh-investment-mind` | 1.0.0 | `D:\code\codex\InvestmentMind\investment-mind-bundle` |
| `@deepseek-ai/dsh-experimental-skill-factory` | 0.2.0-rc.1 | `D:\code\codex\deepseek-harness\packages\experimental\skill-factory`（随 DSH 检出走，不单独发布） |
| `dsh-bili-scroll` | 2.0.2 | `D:\code\codex\dsh-bili-scroll`（origin 为 `UIT2016/dsh-bili-scroll`，上游 `c1overzz/dsh-bili-scroll`） |
| `@uit2016/dsh-bili-agent` | 0.1.0 | `D:\code\codex\bili-agent`（本地目录未配 remote；备份仓库 `UIT2016/dsh-bili-agent`） |

## 3. 官方内置 bundle（随 DSH 版本，不用单独装）

都来自 `@deepseek-ai/dsh-*`，版本跟 DSH 一致（`0.2.2-alpha.2`），从 `apps/cli/node_modules` 解析，不需要进 profile 的 `dependencies`：

| bundle | 提供 |
| --- | --- |
| `dsh-base` | 基础宿主（agent loop、会话、工具） |
| `dsh-web-app` | Web GUI |
| `dsh-experimental-agent-team-profile` | Agent Teams（`spawn_teammate` / 团队任务板） |
| `dsh-experimental-session-search` | 会话检索（`session_search` 等） |
| `dsh-experimental-terminal-bundle` | 持久终端（`terminal_*`） |
| `dsh-experimental-tool-worktree` | 工具工作树（`create_worktree`） |
| `dsh-experimental-badge-skill-bundle` | `dsh-badge` skill |
| `dsh-experimental-cot-translation-bundle` | 思维链翻译 |
| `dsh-experimental-session-titles-bundle` | 会话标题生成 |
| `dsh-experimental-auto-review` | 自动审查 |

## 4. 已安装但已关闭（7 个）

关闭有两种形态：市场 `state.json` 的 `disabled` 数组（可被 UI 开关改回），以及 `cordis.patch.yml` 的 `disabled: true`（优先级更高，UI 打不开）。`task-board` 两者都没走全——它已从 `dsh.profile.bundles` 移除，靠 patch 关掉。

| 插件 | 版本 | 当前状态 / 备注 |
| --- | --- | --- |
| `@linxin666/dsh-client-ui-task-board` | 0.4.11 | 2026-10-30 关闭：已从 `dsh.profile.bundles` 移除 + patch `ui-task-board disabled: true`（市场 `disabled` 数组里没有它） |
| `@linxin666/dsh-remote-web-ui` | 0.4.12 | 2026-10-30 关闭：bundles 移除 + patch `remote-web-ui disabled: true` + 市场 `disabled` |
| `dsh-permission-rules` | 0.7.15 | 当前未启用；重新打开前先确认与 `cordis.patch.yml` 里的 permission preset 条目兼容 |
| `@xmanrui/dsh-im` | 5.1.0 | 多 IM 通道（微信/飞书/Telegram 等），当前不用 |
| `dsh-auto-collapse` | 0.2.1 | 工作段折叠，未启用 |
| `dsh-cost-meter` | 1.9.16 | 费用统计，未启用；注意它内置的火山方舟渠道绑定固定 provider id，认不出 `ark-code-latest` 这类自定义渠道 |
| `@zaofan/dsh-qqbot` | 1.10.11 | QQ 机器人，2026-10-23 关闭（patch 里 `im-qqbot`、`im-qqbot-2` 两条行都已 `disabled`）；配置 insert 仍保留，重开时填 appId/appSecret |

重新启用：市场 UI 里打开对应开关（若在该数组里）、把包名加回 `dsh.profile.bundles`、删掉 `cordis.patch.yml` 里那条 `- id: <rowId>` + `disabled: true`，重启 DSH。

> `cordis.patch.yml` 里还有 `- id: pet` 和 `- id: reasoning-effort` 两条 `disabled: true`，但已装 bundle 都没有声明这两个行 id（`dsh-pet` 的行 id 是 `dsh-pet`），属于历史残留，不影响任何插件。

## 5. 换机同步步骤

### 方案 A：整目录拷贝（最省事，推荐）

```powershell
# 旧机器
robocopy "$env:USERPROFILE\.dsh\profiles\web" D:\backup\dsh-web-profile /E /XD node_modules

# 新机器（同一 DSH 版本）
robocopy D:\backup\dsh-web-profile "$env:USERPROFILE\.dsh\profiles\web" /E
cd "$env:USERPROFILE\.dsh\profiles\web"
pnpm install
```

拷 `package.json`（含 `dsh.profile.bundles`）、`cordis.patch.yml`、`pnpm-lock.yaml` 即可；`node_modules` 别拷。**`cordis.patch.yml` 里 `im-qqbot-2` 那段 appSecret 要按新机器重填或删掉该 insert。**

### 方案 B：按清单重装

```sh
cd ~/.dsh/profiles/web          # Windows: C:\Users\vell\.dsh\profiles\web
pnpm add -w \
  dsh-better-sidebar@0.28.2 dshmarket@1.73.5 dsh-config-manager@0.2.2 dsh-context@0.78.2 \
  dsh-status-rotator@0.38.0 dsh-my-guardian@0.4.8 dsh-ops@0.4.4 cc-safety-net@2.7.1 \
  dsh-mnemon@0.5.37 dsh-better-reasoning-effort@0.5.4 dsh-univer-office@0.3.9 clearai-dsh@0.5.7 \
  dsh-pet@0.3.8 dsh-session-workbench@1.0.3 dsh-startup-screen@1.1.2 \
  @nonamelego/dsh-catppuccin@0.6.5 @tt-a1i/archify-dsh@1.0.0 @michengai/dsh-archive-manager@1.1.22 \
  @linxin666/dsh-client-ui-git-graph@0.4.12 @linxin666/dsh-client-ui-skill-explorer@0.4.12

# 本地 link 包（路径按新机器实际情况改）
pnpm add -w @local/xhs-mcp@link:D:/code/codex/xhs/dsh-bundle-xhs-mcp
pnpm add -w @local/dsh-investment-mind@link:D:/code/codex/InvestmentMind/investment-mind-bundle
pnpm add -w @deepseek-ai/dsh-experimental-skill-factory@link:D:/code/codex/deepseek-harness/packages/experimental/skill-factory
pnpm add -w dsh-bili-scroll@link:D:/code/codex/dsh-bili-scroll
pnpm add -w @uit2016/dsh-bili-agent@link:D:/code/codex/bili-agent
```

装完确认 `dsh.profile.bundles` 里出现这些包名（装了但没进 bundles 的插件不会被加载），最后重启 DSH。

### 两个容易踩的坑

1. **pnpm store 不一致会直接拒绝安装**：报 `ERR_PNPM_UNEXPECTED_STORE: Unexpected store location` 时，把新机器 profile 的 `node_modules/.modules.yaml` 里 `storeDir` 对齐到当前 `pnpm store path`，或删 `node_modules` 重装。
2. **重启才会挂载**：插件（尤其带 host 侧工具或 `dsh.bundle.patch` 的）在 DSH 重启后才会出现在工具列表里；`dsh-ops` 的 bash 载荷还要额外跑 `node bin/dsh-ops.mjs provision-shells --bash`（约 784 MB，缓存不在 profile 目录里，不会跟着拷贝走）。

## 6. 换机后必须补的配置（不进 git、不在本清单里）

| 项 | 位置 | 说明 |
| --- | --- | --- |
| `ARK_CODE_LATEST_API_KEY` / `OPENCODE_GO_API_KEY` / `DEEPSEEK_API_KEY` | 环境变量 | 对应 `cordis.patch.yml` 里 `llm-pi-ai`、`llm-deepseek` 的 `apiKeyEnv` |
| QQ 机器人 appId / appSecret | `cordis.patch.yml` → `insert: im-qqbot-2` | 当前整体关闭；重开时重填，本清单不记录 |
| 小红书登录 Cookie | `~/.dsh` 下 xhs-mcp 的数据目录 | 首次用 `mcp__xiaohongshu__get_login_qrcode` 扫码 |
| `dsh-ops` bash 载荷 | `~/.dsh/dsh-ops` | `provision-shells --bash` 重新下载（走镜像时用 `--pin`） |
| B 站刷视频配置与登录态 | `cordis.patch.yml` → `bili-scroll` 行；状态在 `$DSH_HOME/bili-duty` | 当前 `enabled: true`、`perDay: 10`、三组关键词、`workspace: D:\code\codex\bilibili`；登录态用 `bili_status` 查，缺失时重新扫码 |
| 会话搜索索引 | `cordis.patch.yml` → `session-query-sqlite` 行 | `dsh-session-workbench` 的全文检索依赖它，2026-10-30 起改为持久索引：`path: C:/Users/vell/.dsh/session-query.sqlite`、`openAt: startup`（`:memory:` 会每次重建并卡住 host） |
| 启动动画身份名称 | DSH 设置页（`dsh-startup-screen` 自己的配置项） | 首次进启动界面时确认/修改 |
| 各插件的 profile 级配置 | `cordis.patch.yml` | `better-sidebar`、`catppuccin`、`dsh-ops-shell/file`、`session-query-sqlite` 等条目按需保留 |

## 7. 重新生成本清单

```sh
cd ~/.dsh/profiles/web
node -e '
const fs=require("fs"),path=require("path");
const p=JSON.parse(fs.readFileSync("package.json","utf8"));
for(const n of Object.keys(p.dependencies)){
  try{const q=JSON.parse(fs.readFileSync(path.join("node_modules",n,"package.json"),"utf8"));
    console.log(`${n}\t${q.version}\t${(q.repository&&(q.repository.url||q.repository))||q.homepage||"-"}`);}catch(e){console.log(`${n}\tMISSING\t-`);}
}'
# 已关闭的：cat .dsh-market/state.json 的 disabled 数组
# 实际加载状态：grep "plugin kept off" .dsh-market/log.ndjson | tail
```

## 8. 变更记录

- **2026-10-30**：DSH 升到 `0.2.2-alpha.2`（官方 bundle 版本随动）；新增 `dsh-session-workbench` 1.0.3、`dsh-startup-screen` 1.1.2；关闭 `@linxin666/dsh-client-ui-task-board` 0.4.11 与 `@linxin666/dsh-remote-web-ui` 0.4.12（都已从 bundles 移除）；升版 14 个：archive-manager 1.1.8→1.1.22、catppuccin 0.6.4→0.6.5、cc-safety-net 2.6.18→2.7.1、clearai 0.5.6→0.5.7、better-sidebar 0.28.0→0.28.2、config-manager 0.1.81→0.2.2、context 0.74.0→0.78.2、mnemon 0.5.34→0.5.37、my-guardian 0.4.6→0.4.8、ops 0.4.1→0.4.4、status-rotator 0.37.0→0.38.0、univer-office 0.3.7→0.3.9、dshmarket 1.69.0→1.73.5、linxin666 两件 0.4.8→0.4.12。`session-query-sqlite` 改为持久索引。
- **2026-10-23**：新增 `dsh-bili-scroll` 2.0.2（link）与 `@uit2016/dsh-bili-agent` 0.1.0（link）；`dsh-pet` 重新启用、`@zaofan/dsh-qqbot` 关闭；升版 9 个：archive-manager 1.1.6→1.1.8、catppuccin 0.6.3→0.6.4、cc-safety-net 2.6.16→2.6.18、config-manager 0.1.78→0.1.81、context 0.73.3→0.74.0、mnemon 0.5.33→0.5.34、ops 0.4.0→0.4.1、pet 0.3.7→0.3.8、dshmarket 1.66.44→1.69.0。
- **2026-10-20**：首次建单（23 个启用 / 5 个关闭）。
