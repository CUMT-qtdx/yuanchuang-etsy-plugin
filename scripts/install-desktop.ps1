param([switch]$Restore, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
# 官方桌面 profile 需要应用完全退出后才能更改。
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path (Split-Path -Parent $projectRoot) 'releases'
$developmentVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$appRoot = 'E:\etsy\DeepSeek Harness'
$env:DSH_HOME = 'E:\etsy\desktop-data'
$activeDesktopProcesses = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object {
    try { $_.Path -eq (Join-Path $appRoot 'DeepSeek Harness.exe') -and -not $_.HasExited } catch { $false }
})
if ($activeDesktopProcesses.Count -gt 0) {
    throw '请先在 DeepSeek Harness 中保存任务，并选择「应用 → 退出」。关闭主窗口可能只会隐藏到托盘。'
}
# 未能读取路径的其他账户辅助进程不代表当前应用仍在运行；实际写入仍由官方 CLI 的 profile 锁保护。
$cli = Join-Path $appRoot 'resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $cli)) { throw '未找到官方桌面 CLI' }
if ($Restore) {
    & $cli plugin --profile desktop add --save-exact '@dickpy/dsh-imagegen@1.15.4' --store-dir 'E:\etsy\.pnpm-store'
} else {
    $packagePath = Join-Path $releaseRoot ('dickpy-dsh-imagegen-' + $developmentVersion + '.tgz')
    $expected = Get-Content -LiteralPath (Join-Path $releaseRoot ('dickpy-dsh-imagegen-' + $developmentVersion + '.sha256.json')) -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash -ne $expected.Hash) { throw '开发包哈希不一致，请重新构建打包' }
    & $cli plugin --profile desktop add --save-exact $packagePath --store-dir 'E:\etsy\.pnpm-store'
}
if ($LASTEXITCODE -ne 0) { throw ('桌面插件安装失败：' + $LASTEXITCODE) }
$manifest = Get-Content -LiteralPath 'E:\etsy\desktop-data\profiles\desktop\node_modules\@dickpy\dsh-imagegen\package.json' -Raw | ConvertFrom-Json
Write-Host ('当前插件版本：' + $manifest.version)
if (-not $Restore) {
    if ($manifest.version -ne $developmentVersion) { throw '实际安装的版本与开发包不一致' }
    foreach ($relativeFile in @('lib\index.js', 'lib\client.js')) {
        $sourceHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot $relativeFile) -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash -LiteralPath (Join-Path 'E:\etsy\desktop-data\profiles\desktop\node_modules\@dickpy\dsh-imagegen' $relativeFile) -Algorithm SHA256).Hash
        if ($sourceHash -ne $targetHash) { throw ('安装产物与源码构建不一致：' + $relativeFile) }
    }
}
if (-not $NoLaunch) { Start-Process -FilePath (Join-Path $appRoot 'DeepSeek Harness.exe') -WorkingDirectory 'E:\etsy' }
