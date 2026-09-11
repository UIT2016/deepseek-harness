# DSH 控制台（本地启动器）

个人桌面工具：把 DeepSeek Harness 仓库的常用操作做成按钮。**独立工具，不参与
DSH 构建，不随 git 分发**（本目录已被本机的 `.git/info/exclude` 排除）。

## 按钮与命令

| 按钮 | 执行的命令 |
|---|---|
| ▶ 启动服务 | `pnpm dsh web`（后台拉起，监听 :3080） |
| ■ 停止服务 | `taskkill /PID <记录PID> /T /F`，兜底杀 :3080 监听进程 |
| 🌐 打开 GUI | 浏览器打开 `http://127.0.0.1:3080` |
| 🔨 构建 | `pnpm run build` |
| 📦 安装 | `pnpm install` |
| 📁 打开仓库/数据目录 | `explorer.exe <仓库>` / `explorer.exe <$DSH_HOME>` |

## 文件

- `launcher.mjs` — 零依赖 Node 服务器（127.0.0.1:17577），按钮 API + SSE 日志流
- `page.html` — 控制台页面（启动器内置读取）
- `launch.vbs` — 隐藏窗口启动（桌面快捷方式指向它）
- `install.ps1` — 在本机创建桌面快捷方式
- `.instance` / `launcher.log` — 运行时生成，可随时删除

## 工作原理

- 由 `<repo>\dsh-launcher\launcher.mjs` 的所在位置向上推导仓库根目录
  （`launcher.mjs` 必须放在仓库根目录下的 `dsh-launcher/` 文件夹里）
- 每次启动生成随机令牌，URL 带令牌才有权限；只监听 127.0.0.1；
  只能执行上面固定几条命令，不接受任意输入
- 已运行时再次双击快捷方式 = 重新打开面板（读 `.instance`），不会起第二个实例
- `$DSH_HOME` 环境变量存在则用之，否则默认 `C:\Users\<用户>\.dsh`

## 在新电脑上部署

1. 装 Node.js >= 22（仓库要求 ^22.19 || >=24），确认 `node` 在 PATH
2. 把整个 `dsh-launcher\` 文件夹拷进新机器仓库根目录
   （`<仓库>\dsh-launcher\`）
3. 运行 `install.ps1`（右键 → 使用 PowerShell 运行）
4. 双击桌面「DSH 控制台」即可
5. 可选：`Add-Content .git\info\exclude "dsh-launcher/"` 保持 git 状态干净

## 注意

- 停止服务会杀掉任何监听 3080 的进程（包括正在使用的 Web GUI 会话）
- 构建期间不要同时跑 `pnpm run dev:web`（两者写同一批 lib/ 产物，官方已禁止并行）
