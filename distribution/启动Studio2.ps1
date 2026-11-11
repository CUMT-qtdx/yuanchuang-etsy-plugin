$ErrorActionPreference = 'Stop'
$application = 'E:\etsy\DeepSeek Harness\DeepSeek Harness.exe'
if (-not (Test-Path -LiteralPath $application)) { throw '未找到原 DeepSeek Harness 桌面程序。' }
$env:DSH_HOME = 'E:\etsy\desktop-data'
# 当前入口恢复原桌面应用，不创建浏览器服务或 Chrome 窗口。
Start-Process -FilePath $application -WorkingDirectory (Split-Path -Parent $application)
Write-Output '已打开原 DSH 桌面程序；点击“生图”进入 Studio 2。'
