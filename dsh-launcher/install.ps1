# DSH 控制台 installer — creates the desktop shortcut for this machine.
# Usage: right-click -> Run with PowerShell, or:
#   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'

$dir = $PSScriptRoot
if (-not (Test-Path (Join-Path $dir 'launch.vbs'))) {
  Write-Host "install.ps1 must run from inside the dsh-launcher folder" -ForegroundColor Red
  exit 1
}

$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $desktop 'DSH 控制台.lnk'))
$lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments = "`"$dir\launch.vbs`""
$lnk.WorkingDirectory = $dir
$lnk.Description = 'DSH Harness 启动/停止/构建/安装控制台'
try { $lnk.IconLocation = "$env:SystemRoot\System32\imageres.dll,220" } catch {}
$lnk.Save()

Write-Host "已创建桌面快捷方式: $desktop\DSH 控制台.lnk" -ForegroundColor Green
Write-Host "双击即可启动; 需要先确保本机已安装 Node.js >= 22 (node 在 PATH 中)"
