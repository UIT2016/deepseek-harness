# DSH 插件清单（换机同步用）

> 用途：记录本机 DeepSeek Harness 已启用 / 已安装的插件与版本，换机器或搭建另一个 DSH 实例时按此清单复现。
> 采集时间：2026-10-20；DSH 版本 `0.2.1-rc.2`（源码检出 `D:\code\codex\deepseek-harness`，fork `UIT2016/deepseek-harness`）。
> 本文件**不含任何密钥**：API key、QQ appSecret、Cookie 等一律不记录，需在各机器单独填写（见第 6 节）。

## 1. 生效环境

| 项 | 值 |
| --- | --- |
| DSH 版本 | `0.2.1-rc.2`（`pnpm dsh web --port 3080`，由 `D:\code\codex\dsh-launcher` 拉起） |
| 目标 profile | `web`（GUI）。`tui` 只装 `@deepseek-harness-tui/dsh-tui` 0.15.0；`headless` / `web-safe` / `webadd` 无第三方插件 |
| profile 目录 | `C:\Users\vell\.dsh\profiles\web` |
| 插件声明 | `profiles/web/package.json` → `dependencies` + `dsh.profile.bundles` |
| 配置层 | `profiles/web/cordis.patch.yml`（在所有 bundle 层之后应用；`cordis.yml` 恒为 `[]`，不要编辑） |
| 插件管理器台账 | `profiles/web/.dsh-market/state.json`（`disabled` 数组）+ `log.ndjson` |

一个插件真正生效需要三处同时满足：依赖已装上、包名在 `dsh.profile.bundles` 里、没有被 `cordis.patch.yml` 的 `disabled: true` 或市场 `state.json` 的 `disabled` 关掉。

## 2. 已启用的第三方插件（23 个）

### 2.1 Web GUI / 界面（12 个）

| 插件 | 版本 | 仓库 | 作用 |
| --- | --- | --- | --- |
| `dsh-better-sidebar` | 0.28.0 | `omdsh-dev/DSH-better-sidebar` | 右侧栏：文件树、编辑器、改动、任务、侧聊，按会话隔离；其他插件靠它的 sidecar 服务注册标签页 |
| `dshmarket` | 1.66.44 | `dsh-market/dsh-market` | 插件市场（装插件、启停、更新都走它） |
| `dsh-config-manager` | 0.1.78 | `xiajiajun516/dsh-config-manager` | 配置备份 / 恢复 / 导出 / 迁移，含回滚点 |
| `dsh-context` | 0.73.3 | `bowenliang123/dsh-context` | 上下文构成与演化看板 |
| `dsh-status-rotator` | 0.37.0 | `01Virex/dsh-status-rotator` | 状态栏轮播 |
| `dsh-my-guardian` | 0.4.6 | `baosfeng/my-dsh-plugins` | 插件治理守护：新插件先候选区热挂载，失败自动禁用 / 冻结，安全模式 |
| `@nonamelego/dsh-catppuccin` | 0.6.3 | `NoNameLeGo/dsh-catppuccin-theme` | Catppuccin 四套主题 + 玻璃拟态（当前 `frappe`，mica 雾化） |
| `@linxin666/dsh-client-ui-*`（3 个） | 0.4.8 | `zhu1090093659/dsh-web` | `dsh-client-ui-git-graph`（分支选择 + Git 图）、`dsh-client-ui-skill-explorer`（技能中心）、`dsh-client-ui-task-board`（任务看板） |
| `@linxin666/dsh-remote-web-ui` | 0.4.8 | `zhu1090093659/dsh-web` | 扫码配对远程访问同一个 Web GUI（手机触屏适配） |
| `@michengai/dsh-archive-manager` | 1.1.6 | `MichengAI/dsh-archive-manager` | 会话归档 / 恢复 / 收藏 / 永久删除，损坏日志诊断 |

### 2.2 宿主能力 / 工具（9 个）

| 插件 | 版本 | 仓库 | 作用 |
| --- | --- | --- | --- |
| `dsh-ops` | 0.4.0 | `T-Auto/dsh-ops` | Windows x64 原生文件与 PTC 工具（`ops_*`），自带 bash 载荷与 PowerShell 7 引擎；profile 里以 `dsh-ops/shell`、`dsh-ops/file` 两行组件挂载 |
| `cc-safety-net` | 2.6.16 | `kenryu42/cc-safety-net` | 危险命令 / 密钥文件访问拦截（默认 standard 级别，未自定义 `~/.cc-safety-net/policy.json`） |
| `dsh-mnemon` | 0.5.33 | `omdsh-dev/dsh-mnemon` | 分层记忆（runtime memory / 文档 / recall） |
| `dsh-better-reasoning-effort` | 0.5.4 | `HaoyueQin/dsh-better-reasoning-effort` | 第三方 provider 的推理强度与图片输入按模型声明，在官方模型页里编辑 |
| `dsh-univer-office` | 0.3.7 | `dream-num/dsh-univer-office` | Univer 办公套件（`univer_*` 工具、`.univer` 文件） |
| `@local/dsh-investment-mind` | 1.0.0 | `UIT2016/dsh-investment-mind`（私有，本地 link） | 个人投资观点库（SQLite）+ Investment Mind preset |
| `clearai-dsh` | 0.5.6 | `Clearailhc/clearai-dsh` | ClearAI agent preset（证据校验的研究流程） |
| `@tt-a1i/archify-dsh` | 1.0.0 | `tt-a1i/archify` | Archify 架构图 skill（skill-only bundle） |
| `@deepseek-ai/dsh-experimental-skill-factory` | 0.2.0-rc.1 | 随 DSH 检出（`packages/experimental/skill-factory`，本地 link） | 从会话与交付物中蒸馏可复用 skill |

### 2.3 需要外部凭据 / 服务的 2 个

| 插件 | 版本 | 仓库 | 作用 | 需要补的东西 |
| --- | --- | --- | --- | --- |
| `@zaofan/dsh-qqbot` | 1.10.11 | `zaofan-make/dsh-qqbot` | QQ 机器人 IM 通道（`qq_send` 等） | QQ 开放平台 appId / appSecret；patch 里以 `im-qqbot-2` 实例插入 |
| `@local/xhs-mcp` | 1.1.0 | `UIT2016/xhs-mcp-local`（本地 link） | 本地拉起 `xiaohongshu-mcp` 并接成 MCP server | 小红书登录 Cookie（`mcp__xiaohongshu__*` 工具） |

### 2.4 本地 link 包的路径（上面已计数，这里只记路径）

| 包名 | 版本 | link 目标 |
| --- | --- | --- |
| `@local/xhs-mcp` | 1.1.0 | `D:\code\codex\xhs\dsh-bundle-xhs-mcp` |
| `@local/dsh-investment-mind` | 1.0.0 | `D:\code\codex\InvestmentMind\investment-mind-bundle` |
| `@deepseek-ai/dsh-experimental-skill-factory` | 0.2.0-rc.1 | `D:\code\codex\deepseek-harness\packages\experimental\skill-factory`（随 DSH 检出走，不单独发布） |

## 3. 官方内置 bundle（随 DSH 版本，不用单独装）

都来自 `@deepseek-ai/dsh-*`，版本跟 DSH 一致（`0.2.1-rc.2`），从 `apps/cli/node_modules` 解析，不需要进 profile 的 `dependencies`：

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

## 4. 已安装但已关闭（5 个）

关闭方式有两种，两处都要一致：市场 `state.json` 的 `disabled` 数组，以及 `cordis.patch.yml` 里对应的 `disabled: true`。

| 插件 | 版本 | 关掉的原因 / 备注 |
| --- | --- | --- |
| `dsh-permission-rules` | 0.7.15 | 当前未启用；重新打开前先确认与 `cordis.patch.yml` 里的 permission preset 条目兼容 |
| `dsh-pet` | 0.3.7 | 桌面宠物，未启用 |
| `@xmanrui/dsh-im` | 5.1.0 | 多 IM 通道（微信/飞书/Telegram 等），当前只用 QQ bot |
| `dsh-auto-collapse` | 0.2.1 | 工作段折叠，未启用 |
| `dsh-cost-meter` | 1.9.16 | 费用统计，未启用；注意它内置的火山方舟渠道绑定固定 provider id，认不出 `ark-code-latest` 这类自定义渠道 |

重新启用：市场 UI 里打开对应开关，再删掉 `cordis.patch.yml` 里那条 `- id: <rowId>` + `disabled: true`，重启 DSH。

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
  dsh-better-sidebar@0.28.0 dshmarket@1.66.44 dsh-config-manager@0.1.78 dsh-context@0.73.3 \
  dsh-status-rotator@0.37.0 dsh-my-guardian@0.4.6 dsh-ops@0.4.0 cc-safety-net@2.6.16 \
  dsh-mnemon@0.5.33 dsh-better-reasoning-effort@0.5.4 dsh-univer-office@0.3.7 clearai-dsh@0.5.6 \
  @nonamelego/dsh-catppuccin@0.6.3 @tt-a1i/archify-dsh@1.0.0 \
  @michengai/dsh-archive-manager@1.1.6 @zaofan/dsh-qqbot@1.10.11 \
  @linxin666/dsh-client-ui-git-graph@0.4.8 @linxin666/dsh-client-ui-skill-explorer@0.4.8 \
  @linxin666/dsh-client-ui-task-board@0.4.8 @linxin666/dsh-remote-web-ui@0.4.8

# 本地 link 包（路径按新机器实际情况改）
pnpm add -w @local/xhs-mcp@link:D:/code/codex/xhs/dsh-bundle-xhs-mcp
pnpm add -w @local/dsh-investment-mind@link:D:/code/codex/InvestmentMind/investment-mind-bundle
pnpm add -w @deepseek-ai/dsh-experimental-skill-factory@link:D:/code/codex/deepseek-harness/packages/experimental/skill-factory
```

装完确认 `dsh.profile.bundles` 里出现这些包名（装了但没进 bundles 的插件不会被加载），最后重启 DSH。

### 两个容易踩的坑

1. **pnpm store 不一致会直接拒绝安装**：报 `ERR_PNPM_UNEXPECTED_STORE: Unexpected store location` 时，把新机器 profile 的 `node_modules/.modules.yaml` 里 `storeDir` 对齐到当前 `pnpm store path`，或删 `node_modules` 重装。
2. **重启才会挂载**：插件（尤其带 host 侧工具或 `dsh.bundle.patch` 的）在 DSH 重启后才会出现在工具列表里；`dsh-ops` 的 bash 载荷还要额外跑 `node bin/dsh-ops.mjs provision-shells --bash`（约 784 MB，缓存不在 profile 目录里，不会跟着拷贝走）。

## 6. 换机后必须补的配置（不进 git、不在本清单里）

| 项 | 位置 | 说明 |
| --- | --- | --- |
| `ARK_CODE_LATEST_API_KEY` / `OPENCODE_GO_API_KEY` / `DEEPSEEK_API_KEY` | 环境变量 | 对应 `cordis.patch.yml` 里 `llm-pi-ai`、`llm-deepseek` 的 `apiKeyEnv` |
| QQ 机器人 appId / appSecret | `cordis.patch.yml` → `insert: im-qqbot-2` | 本清单不记录，按新机器人重填 |
| 小红书登录 Cookie | `~/.dsh` 下 xhs-mcp 的数据目录 | 首次用 `mcp__xiaohongshu__get_login_qrcode` 扫码 |
| `dsh-ops` bash 载荷 | `~/.dsh/dsh-ops` | `provision-shells --bash` 重新下载（走镜像时用 `--pin`） |
| 各插件的 profile 级配置 | `cordis.patch.yml` | `better-sidebar`、`catppuccin`、`dsh-ops-shell/file`、`ui-task-board`、`session-query-sqlite` 等条目按需保留 |

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
