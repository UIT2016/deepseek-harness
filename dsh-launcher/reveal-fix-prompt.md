# 修复任务提示词：交付卡片"显示文件位置"不弹窗

请以本仓库工作区的 dsh 会话执行以下修复任务。任务自包含，无需参考其他会话。

## 问题现象

在 Windows 上（会话为交互桌面，Explorer 正常运行），点击 DSH Web GUI 交付卡片上的"显示文件位置"（reveal）时，界面提示"已请求在文件管理器中显示"，但 Windows 资源管理器窗口没有弹出，文件没有被选中。

## 已完成排查（结论：不是调用方式或权限问题）

已用实验排除以下因素，系统侧 `explorer.exe /select,<file:///URI>` 在普通 cmd、管理员 cmd、带空格、中文文件名等所有形式下都能正常弹出窗口：

- 宿主进程完整性（S-1-16-8192 Medium）与 Explorer 一致，非 elevated/UIPI 问题
- 会话/窗口站/桌面一致（session 10 / WinSta0\Default）
- UAC 配置正常；不是服务、计划任务启动
- DSH 调用方式本身（CreateProcess + `/select,` + file:/// URI + 中文路径）经独立复刻验证能弹出
- `windowsHide`、stdout/stderr 管道重定向均不影响

## 根因

`explorer.exe /select,<path>` 是**单实例 shell 委派**机制：新进程把请求委派给桌面上已运行的 Explorer 实例后自行退出（退出码 1 被 DSH 的 `runExplorer` 接受为"已委派"）。当系统里堆积了多个**残留的 explorer.exe 进程**（每个都带隐藏的"文件资源管理器"窗口，标题如 `dsh-deliverables-test - 文件资源管理器`），新进程的委派目标不确定，请求可能交给一个隐藏/无响应的残留实例，导致窗口不弹出。此时 DSH 侧只看到 explorer 退出码 0/1，UI 显示乐观确认"已请求在文件管理器中显示"，但窗口实际没有出现。

残留实例来源：反复调用 `explorer.exe`（本目录 `launcher.mjs` 的"打开仓库/数据目录"按钮每次 spawn 一个 explorer，以及多次 reveal 测试）产生，且委派失败时不会自动退出，逐步堆积。本次现场 session 10 曾堆积 15+ 个 explorer 进程，清理（保留拥有 Program Manager 的真实 shell 进程）后 reveal 立即可靠弹出，问题消失。

## 需要做的改动

1. **`dsh-launcher/launcher.mjs`**：`OPENS.repo` / `OPENS.home` 目前每次 `spawn('explorer.exe', [path], { detached: true })`。请改为不产生残留实例的方式，例如：
   - spawn 前用 `Get-Process explorer`（或等效检查）判断是否已有 Explorer 在运行，有则改用 `cmd /c start "" <path>`（ShellExecute 语义，交给已有 shell 实例），无则再直连 spawn；或
   - 统一改用 `cmd /c start "" <path>`，避免每次 spawn 新 explorer 进程。
2. **（可选，仓库内 DSH 侧）** `packages/util/native-command/src/path-opener.ts` 的 `runExplorer`：目前把 explorer 退出码 1 无条件当作"已委派成功"（注释明确写 "exit 1 is accepted as a delegated handoff, not proof of selection"）。请评估能否在委派后校验窗口是否真正出现，或在失败时返回可区分的错误/提示，避免 UI 显示乐观确认误导用户。若评估后认为不宜改动，请在回复中说明理由。

## 验收标准

1. 修改后，连续点击交付卡片"显示文件位置"多次，每次都能弹出资源管理器窗口并选中目标文件。
2. 连续触发 dsh-launcher 的"打开仓库/数据目录"多次后，任务管理器中 explorer.exe 进程数量不持续增长（不产生新的隐藏残留实例）。
3. 现有残留的 explorer 进程不影响以上验证（可先清理：保留拥有 Program Manager 窗口的 explorer 进程，终止其余 session 同用户的 explorer 残留实例）。
4. 相关改动通过仓库本地检查（如适用），并在回复中给出改动摘要。
