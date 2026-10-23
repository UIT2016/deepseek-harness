# Mnemon Native 安装与接入（换机复现用）

> 用途：在另一台 DSH（或同一个 DSH 的另一个 profile）上装好 Mnemon Native CLI，让 `dsh-mnemon` 插件能够创建并使用记忆空间。
> 实测环境：2026-10-23，Windows 11 x64，Node `v24.19.0`，npm `11.17.0`，`dsh-mnemon` 0.5.34。
> 本文件不含任何密钥；记忆数据与登录态不进 git。

## 1. 为什么需要单独装

`dsh-mnemon` 的默认记忆后端是 **Mnemon Native**。插件包 `dsh-mnemon-provider-mnemon-native` 只是驱动（`lib/` 下的 CLI 适配层），**不含二进制**，真正的 `mnemon` 可执行文件要单独安装。

- 未安装时：`mnemon_status` 返回 `commandFound: false`，提示 *Install the Mnemon CLI for Mnemon Native*，记忆空间无法创建。
- 安装后：`commandFound: true` + 正确版本号，可创建 Memory Space、写入与召回；提示语变为 *No Memory Space exists yet*。

## 2. 前置条件

| 项 | 要求 |
| --- | --- |
| Node | ≥ 22（npm 包 `engines` 要求） |
| npm | 任意近期版本 |
| 平台 | `win32-x64` / `linux-x64` / `linux-arm64` / `darwin-x64` / `darwin-arm64`（npm 包按平台附带原生二进制） |
| 网络 | 能访问 npm registry（本机已配 `npmmirror`） |

## 3. 安装（推荐：npm 全局）

```sh
npm install -g @mnemon-dev/mnemon@latest
```

- 装到 npm 全局 prefix，先确认位置：`npm config get prefix`。Windows 常见为 `%APPDATA%\npm`，本机为 `D:\code\repo\npm`（已在 PATH 中）。
- 包结构：`bin/mnemon.js` 是启动器，可选依赖 `@mnemon-dev/mnemon-<platform>-<arch>` 提供原生 `mnemon.exe`。插件识别出这是官方 npm 启动器后，会**直接调用原生二进制**，不经过 Node shim。
- 升级：`mnemon update`，或重新执行上面的 npm 命令。

> **在 DSH 会话内安装时的注意**：npm prefix 通常在工作区之外，DSH 的 `workspace-write` 沙箱会拒绝写入（报 `EPERM`）。让执行者以 `danger-full-access` 放行一次，或直接在系统终端里装。

### 备选安装方式

| 方式 | 结果路径 | 说明 |
| --- | --- | --- |
| 官方 Windows 安装包 | `%LOCALAPPDATA%\Programs\mnemon\mnemon.exe` | 插件默认扫描路径之一 |
| Go 编译 | `%GOPATH%\bin\mnemon.exe` | 仅当 Go 工具链与目标架构一致；本机 Go 是 `windows-386`，产出 32 位二进制，不推荐 |
| 任意目录 | 自定义 | 需设置 `MNEMON_CLI_PATH`，或在 dsh-mnemon 配置里写 `cliPath` |

## 4. 验证

```sh
mnemon --version     # 期望：mnemon version 0.2.12（或更新）
which mnemon         # Linux/macOS
where mnemon         # Windows
```

DSH 内验证：

- 调用 `mnemon_status`：`commandFound: true`，`version` 与命令一致；
- 或 GUI：设置 → 插件 → `dsh-mnemon`（记忆系统），状态里不再提示安装 CLI。

> CLI 是否可用是**实时探测**的，装完不需要重启 DSH 就能在 `mnemon_status` 里看到 `commandFound: true`。

## 5. 插件如何找到 `mnemon`

源码 `dsh-mnemon-source-memory-spaces/lib/native-cli.js` 中 `findMnemonCommand` 的解析顺序：

1. 插件配置项 `cliPath`；
2. 环境变量 `MNEMON_CLI_PATH`；
3. `PATH` 中的 `mnemon`（Windows 依次尝试 `mnemon.exe`、`mnemon.cmd`；`.cmd` 必须是官方 npm 启动器才会被接受）；
4. 常见安装路径：
   - **Windows**：`%GOBIN%\mnemon.exe`、`%GOPATH%\bin\mnemon.exe`（默认 `%USERPROFILE%\go\bin`）、`%LOCALAPPDATA%\Programs\mnemon\mnemon.exe`、`%ProgramFiles%\mnemon\mnemon.exe`；
   - **Unix**：`~/.local/bin/mnemon`、`/opt/homebrew/bin/mnemon`、`/usr/local/bin/mnemon`、`/usr/bin/mnemon`。

最省事的做法：装进已在 `PATH` 里的 npm prefix；否则设 `MNEMON_CLI_PATH`（或插件 `cliPath`）到绝对路径。

## 6. 创建记忆空间（关键）

创建空间**不是 CLI 命令**，而是 `dsh-mnemon` 的 Memory Space 管理动作，有两条路径：

### 6.1 GUI 插件页（推荐，最可靠）

设置 → 插件 → `dsh-mnemon`（记忆系统）→ 记忆空间 → 新建。建完确认该空间是**激活**状态，否则记忆没有落点。

### 6.2 让 Agent 用工具创建

工具 `mnemon_memory_body_create` 会委托子代理执行**当前会话 View** 的 `memory-spaces/manage-spaces` 写动作。View 是会话开始时构建的快照：

- 如果在**安装 CLI 之前**就开了会话，这个 View 里没有写能力，会报
  `Source Action is not offered by the current View: memory-spaces/manage-spaces`，
  或包装后的「宿主拒绝了创建操作」；
- 装完 CLI 后**新开一个会话，或重启 DSH**，View 重建即可正常创建与写入。

> 实测：本机在装 CLI 的同一会话里两次调用 `mnemon_memory_body_create` 均失败（一次报视图能力错误、一次报宿主拒绝），且同会话的 `mnemon_runtime_memory` 也报 `memory-spaces/remember` 不可用；新会话后恢复正常。

## 7. 数据位置

| 层 | 路径 | 说明 |
| --- | --- | --- |
| CLI 自身默认 | `~/.mnemon` | 可用 `--data-dir` 或 `MNEMON_DATA_DIR` 覆盖；Store 数据库在 `<data-dir>/data/<store>/mnemon.db` |
| dsh-mnemon Memory Space | `~/.mnemon/sources/<sourceInstanceKey>/<memorySpaceId>/mnemon.db` | 插件为每个 Source 实例单独建 dataDir；Store 由插件扫描该目录自动发现 |

备份 / 迁移：整目录拷贝 dataDir 即可（含插件的空间注册表文件）。

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `commandFound: false`，提示装 CLI | 不在 PATH，也不在常见路径 | 设 `MNEMON_CLI_PATH` 或插件 `cliPath` |
| `npm install -g` 报 `EPERM` | DSH 沙箱阻止写工作区外 | 放行一次，或改在系统终端安装 |
| 创建空间报 View 无 `manage-spaces` / 宿主拒绝 | 会话 View 是装 CLI 前的快照 | 新开会话或重启 DSH；或直接用 GUI 插件页建 |
| Windows 上 `agency` 命令不可用 | 官方说明 Windows 目前只支持 Memory 命令 | 与记忆空间用途无关 |
| Go 安装产出 32 位二进制 | 本机 Go 工具链为 `windows-386` | 改用 npm 全局安装 |

## 9. 本机实测记录（2026-10-23）

| 项 | 值 |
| --- | --- |
| npm 包 | `@mnemon-dev/mnemon@0.2.12` |
| 安装位置 | `D:\code\repo\npm`（npm prefix，已在 PATH） |
| 实际执行 | 插件直呼 `@mnemon-dev/mnemon-win32-x64/bin/mnemon.exe` |
| 插件版本 | `dsh-mnemon` 0.5.34、`dsh-mnemon-source-memory-spaces` 0.5.22、`dsh-mnemon-provider-mnemon-native` 0.5.9 |
| 验证结果 | `mnemon --version` → `0.2.12`；`mnemon_status` → `commandFound: true`；插件 spawn 调用链返回 `status: 0` |
| dataDir | 保持默认 `~/.mnemon/sources/<实例>/` |

## 10. 变更记录

- **2026-10-23**：首建。记录 npm 全局安装方式、插件 CLI 解析顺序、创建空间时的 View 快照限制。
