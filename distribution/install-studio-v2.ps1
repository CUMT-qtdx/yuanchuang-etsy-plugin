param(
    [string]$AppPath,
    [string]$DataDirectory,
    [string]$StoreDirectory,
    [switch]$CheckOnly,
    [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
# 保证从双击入口或测试进程运行时，中文提示和路径均按 UTF-8 输出。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Get-PackageSha256 {
    param([string]$File)
    # 使用系统 .NET，兼容未自动加载 Get-FileHash 的 Windows PowerShell 环境。
    $stream = [IO.File]::OpenRead($File)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Resolve-DesktopExecutable {
    param([string]$Requested)
    if ($Requested) {
        $candidate = $Requested.Trim().Trim('"')
        if (Test-Path -LiteralPath $candidate -PathType Container) { $candidate = Join-Path $candidate 'DeepSeek Harness.exe' }
        return (Resolve-Path -LiteralPath $candidate).Path
    }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness\DeepSeek Harness.exe')
    )
    $uninstallRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')
    foreach ($registryRoot in $uninstallRoots) {
        foreach ($entry in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction SilentlyContinue)) {
            $application = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
            if ($application.DisplayName -like '*DeepSeek Harness*' -and $application.InstallLocation) { $candidates += Join-Path $application.InstallLocation 'DeepSeek Harness.exe' }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Resolve-Path -LiteralPath $candidate).Path } }
    if ($CheckOnly) { throw '没有自动找到 DSH。请用 -AppPath 指定 DeepSeek Harness.exe 的完整路径。' }
    Write-Host '请先安装 DeepSeek Harness 主程序。本工具只安装元创插件。'
    Write-Host '如果已经安装，请在接下来的窗口选择 DeepSeek Harness.exe。'
    Add-Type -AssemblyName System.Windows.Forms
    $picker = New-Object System.Windows.Forms.OpenFileDialog
    $picker.Title = '选择已安装的 DeepSeek Harness.exe'
    $picker.Filter = 'DeepSeek Harness|DeepSeek Harness.exe'
    try {
        if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw '没有选择 DSH，安装未执行。' }
        return (Resolve-Path -LiteralPath $picker.FileName).Path
    } finally { $picker.Dispose() }
}

$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.package -notmatch '^dickpy-dsh-imagegen-[0-9A-Za-z.-]+\.tgz$') { throw '交付包清单中的文件名无效。' }
$package = Join-Path $PSScriptRoot $manifest.package
if ((Get-PackageSha256 $package) -ne $manifest.sha256) { throw '插件包校验失败，请重新解压或索取完整交付包。' }
$executable = Resolve-DesktopExecutable $AppPath
if ([IO.Path]::GetFileName($executable) -ne 'DeepSeek Harness.exe') { throw '请选择官方 DeepSeek Harness.exe。' }
$appRoot = Split-Path -Parent $executable
$cli = Join-Path $appRoot 'resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw '当前 DSH 没有官方桌面插件安装工具，请核对选择的程序位置。' }

# 复用使用者自己的数据目录；不导入发送者的账号和历史，也不更改系统环境变量。
$explicitData = -not [string]::IsNullOrWhiteSpace($DataDirectory)
if (-not $DataDirectory) { $DataDirectory = $env:DSH_HOME }
if (-not $DataDirectory) { $DataDirectory = [Environment]::GetEnvironmentVariable('DSH_HOME', 'User') }
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:USERPROFILE '.dsh' }
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
$profile = Join-Path $DataDirectory 'profiles\desktop'
if (-not (Test-Path -LiteralPath (Join-Path $profile 'package.json') -PathType Leaf)) { throw '桌面 profile 尚未初始化。请先打开 DSH 完成首次引导，再通过「应用 → 退出」退出后重试。自定义数据目录需用 -DataDirectory 指定。' }

# 沿用接收者既有 pnpm 存储位置，避免更新原插件时产生存储路径不一致。
if (-not $StoreDirectory) {
    $modulesFile = Join-Path $profile 'node_modules\.modules.yaml'
    if (Test-Path -LiteralPath $modulesFile -PathType Leaf) {
        $modules = Get-Content -LiteralPath $modulesFile -Raw -Encoding UTF8
        $recordedStore = $null
        try { $recordedStore = ($modules | ConvertFrom-Json).storeDir } catch {
            if ($modules -match '(?m)^storeDir:\s*(.+?)\s*$') { $recordedStore = $Matches[1].Trim().Trim('"').Trim("'") }
        }
        if ($recordedStore -and [IO.Path]::IsPathRooted($recordedStore)) {
            $StoreDirectory = [IO.Path]::GetFullPath($recordedStore)
            if ([IO.Path]::GetFileName($StoreDirectory.TrimEnd('\', '/')) -match '^v[0-9]+$') { $StoreDirectory = Split-Path -Parent $StoreDirectory }
        }
    }
}
if ($StoreDirectory) { $StoreDirectory = [IO.Path]::GetFullPath($StoreDirectory) }
if (-not $manifest.files.'lib/index.js' -or -not $manifest.files.'lib/client.js') { throw '交付包缺少必要的构建校验信息。' }
foreach ($file in $manifest.files.PSObject.Properties) {
    if ($file.Name -notmatch '^lib/[A-Za-z0-9_.-]+\.js$' -or $file.Value -notmatch '^[a-fA-F0-9]{64}$') { throw '构建文件清单无效。' }
}

if ($CheckOnly) {
    [pscustomobject]@{ Mode='CheckOnly'; Version=$manifest.version; Application=$executable; DataDirectory=$DataDirectory; StoreDirectory=$StoreDirectory; PackageHashVerified=$true; InstallationPerformed=$false } | ConvertTo-Json
    return
}
$active = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq $executable -and -not $_.HasExited } catch { $false } })
if ($active.Count -gt 0) { throw '请保存正在进行的任务，通过 DSH 左上角「应用 → 退出」完全退出，再重新运行安装。窗口右上角关闭可能只隐藏到托盘。' }

Write-Host ('即将安装元创插件：' + $manifest.version)
Write-Host ('使用你自己的数据目录：' + $DataDirectory)
$backup = Join-Path $DataDirectory ('plugin-backups\yuanchuang-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($file in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.patch.yml')) {
    $sourceFile = Join-Path $profile $file
    if (Test-Path -LiteralPath $sourceFile) { Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $backup $file) }
}
$receiptRoot = Join-Path $DataDirectory 'plugin-install-receipts'
New-Item -ItemType Directory -Path $receiptRoot -Force | Out-Null
$logFile = Join-Path $receiptRoot ('yuanchuang-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '.log')
$previousHome = $env:DSH_HOME
try {
    $env:DSH_HOME = $DataDirectory
    # 保存安装源，员工以后删除解压文件夹也不会丢失安装源。
    $packageRoot = Join-Path $DataDirectory 'plugin-packages\yuanchuang'
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
    $savedPackage = Join-Path $packageRoot $manifest.package
    if (Test-Path -LiteralPath $savedPackage) {
        if ((Get-PackageSha256 $savedPackage) -ne $manifest.sha256) { throw '本机存在同名但内容不同的插件安装源，请联系维护者核对。' }
    } else { Copy-Item -LiteralPath $package -Destination $savedPackage }
    $arguments = @('plugin', '--profile', 'desktop', 'add', '--save-exact', $savedPackage)
    if ($StoreDirectory) { $arguments += @('--store-dir', $StoreDirectory) }
    Write-Host '正在安装，请保持窗口打开；首次安装可能需要联网下载依赖。'
    & $cli @arguments *> $logFile
    if ($LASTEXITCODE -ne 0) { throw ('官方插件安装未完成。日志已保存在：' + $logFile) }
    $installedRoot = Join-Path $profile 'node_modules\@dickpy\dsh-imagegen'
    $installed = Get-Content -LiteralPath (Join-Path $installedRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($installed.version -ne $manifest.version) { throw '实际版本与交付包不一致，停止启动，请联系维护者。' }
    foreach ($file in $manifest.files.PSObject.Properties) {
        if ((Get-PackageSha256 (Join-Path $installedRoot $file.Name)) -ne $file.Value) { throw ('安装产物校验不一致：' + $file.Name) }
    }
    [pscustomobject]@{ Version=$installed.version; Application=$executable; DataDirectory=$DataDirectory; Backup=$backup; NewModelCalls=0; ExplicitDataDirectory=$explicitData } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $receiptRoot 'yuanchuang-latest.json') -Encoding UTF8
    Write-Host '安装成功。打开 DSH 后点击左上方「生图」进入元创平台。'
    Write-Host '首次配置请使用你自己的模型账号或 API；安装不会调用模型。'
    if (-not $NoLaunch) { Start-Process -FilePath $executable -WorkingDirectory $appRoot -WindowStyle Hidden }
} finally { $env:DSH_HOME = $previousHome }
