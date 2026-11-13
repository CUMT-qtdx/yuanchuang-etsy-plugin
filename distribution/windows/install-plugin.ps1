param([string]$AppPath,[string]$DataDirectory,[string]$ResultFile,[switch]$NoLaunch,[switch]$CheckOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$OutputEncoding=[Console]::OutputEncoding
$receipt=$null
function Hash([string]$File) {
  $stream=[IO.File]::OpenRead($File);$algorithm=[Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
  finally {$algorithm.Dispose();$stream.Dispose()}
}
function Find-App {
  if($AppPath) {
    $candidate=$AppPath.Trim().Trim('"')
    if(Test-Path -LiteralPath $candidate -PathType Container){$candidate=Join-Path $candidate 'DeepSeek Harness.exe'}
    if(Test-Path -LiteralPath $candidate -PathType Leaf){return [IO.Path]::GetFullPath($candidate)}
    throw '指定的 DeepSeek Harness.exe 不存在。'
  }
  $candidates=@()
  foreach($process in @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)){
    try {if($process.Path){$candidates+=$process.Path}}catch{}
  }
  foreach($base in @($env:LOCALAPPDATA,$env:ProgramFiles,${env:ProgramFiles(x86)})){
    if($base){$candidates+=Join-Path $base 'DeepSeek Harness\DeepSeek Harness.exe';$candidates+=Join-Path $base 'Programs\DeepSeek Harness\DeepSeek Harness.exe'}
  }
  $shell=New-Object -ComObject WScript.Shell
  try {
    foreach($dir in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'))){
      if($dir -and (Test-Path -LiteralPath $dir)){
        foreach($link in @(Get-ChildItem -LiteralPath $dir -Filter '*Harness*.lnk' -Recurse -ErrorAction SilentlyContinue)){
          $candidates+=$shell.CreateShortcut($link.FullName).TargetPath
        }
      }
    }
  } finally {[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)}
  foreach($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')){
    foreach($entry in @(Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue)){
      $item=Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
      if($item.DisplayName -like '*DeepSeek Harness*' -and $item.InstallLocation){$candidates+=Join-Path $item.InstallLocation 'DeepSeek Harness.exe'}
    }
  }
  foreach($candidate in ($candidates|Select-Object -Unique)){
    if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)){return [IO.Path]::GetFullPath($candidate)}
  }
  throw '未找到 DeepSeek Harness 主程序。请先安装随附的官方主程序，打开一次后再运行本安装器；已安装可点击「选择主程序」。'
}
try {
  $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if($manifest.package -notmatch '^dickpy-dsh-imagegen-[A-Za-z0-9.-]+\.tgz$'){throw '安装清单无效。'}
  $package=Join-Path $PSScriptRoot $manifest.package
  if((Hash $package) -ne $manifest.sha256){throw '安装包校验失败，请重新获取完整安装包。'}
  $exe=Find-App
  if([IO.Path]::GetFileName($exe) -ne 'DeepSeek Harness.exe'){throw '请选择 DeepSeek Harness.exe。'}
  $appRoot=Split-Path -Parent $exe
  $cli=Join-Path $appRoot 'resources\runtime\cli\bin\dsh.cmd'
  if(-not(Test-Path -LiteralPath $cli -PathType Leaf)){throw '此主程序缺少官方插件安装工具，请更新 DeepSeek Harness。'}
  if(-not $DataDirectory){$DataDirectory=$env:DSH_HOME}
  if(-not $DataDirectory){$DataDirectory=[Environment]::GetEnvironmentVariable('DSH_HOME','User')}
  if(-not $DataDirectory){$DataDirectory=Join-Path $env:USERPROFILE '.dsh'}
  $DataDirectory=[IO.Path]::GetFullPath($DataDirectory)
  $profile=Join-Path $DataDirectory 'profiles\desktop'
  if($CheckOnly){
    $receipt=@{success=$true;version=$manifest.version;application=$exe;dataDirectory=$DataDirectory;checkOnly=$true}
  } else {
    $active=@(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue|Where-Object {try{$_.Path -eq $exe}catch{$false}})
    if($active.Count -gt 0){throw '请先保存任务，在 DeepSeek Harness 的「应用 → 退出」中完全退出，再点击安装。'}
    if(-not(Test-Path -LiteralPath (Join-Path $profile 'package.json'))){throw '请先打开 DeepSeek Harness 一次，再从「应用 → 退出」退出，然后重新安装。'}
    Write-Output ('正在安装元创插件 '+$manifest.version)
    Write-Output ('主程序：'+$exe)
    Write-Output '离线安装依赖，请保持窗口打开。'
    $stamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    $backup=Join-Path $DataDirectory ('plugin-backups\yuanchuang-offline-'+$stamp)
    New-Item -ItemType Directory -Path $backup -Force|Out-Null
    foreach($name in @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.patch.yml')){
      $source=Join-Path $profile $name
      if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $backup $name)}
    }
    $packageDir=Join-Path $DataDirectory ('plugin-packages\yuanchuang\offline-'+$manifest.sha256.Substring(0,12))
    $logs=Join-Path $DataDirectory 'plugin-install-receipts'
    New-Item -ItemType Directory -Path $packageDir,$logs -Force|Out-Null
    $savedPackage=Join-Path $packageDir $manifest.package
    if(Test-Path -LiteralPath $savedPackage){if((Hash $savedPackage) -ne $manifest.sha256){throw '本机的安装源校验失败，请联系维护者。'}}
    else{Copy-Item -LiteralPath $package -Destination $savedPackage}
    $store=$null
    $modules=Join-Path $profile 'node_modules\.modules.yaml'
    if(Test-Path -LiteralPath $modules){
      $text=Get-Content -LiteralPath $modules -Raw -Encoding UTF8
      try{$store=($text|ConvertFrom-Json).storeDir}catch{if($text -match '(?m)^storeDir:\s*(.+?)\s*$'){$store=$Matches[1].Trim().Trim('"').Trim("'")}}
      if($store -and [IO.Path]::IsPathRooted($store) -and [IO.Path]::GetFileName($store.TrimEnd('\','/')) -match '^v[0-9]+$'){$store=Split-Path -Parent $store}
    }
    if(-not $store){$store=Join-Path $DataDirectory 'plugin-cache\pnpm'}
    $log=Join-Path $logs ('yuanchuang-offline-'+$stamp+'.log')
    $previousHome=$env:DSH_HOME;$previousElectron=$env:ELECTRON_RUN_AS_NODE
    try {
      $env:DSH_HOME=$DataDirectory;$env:ELECTRON_RUN_AS_NODE=$null
      # 使用主程序自带的官方 CLI；离线选项保证安装不依赖 npm 下载。
      $arguments=@('plugin','--profile','desktop','add','--offline','--save-exact',$savedPackage,'--store-dir',$store,'--config.auto-install-peers=false')
      & $cli @arguments *> $log
      if($LASTEXITCODE -ne 0){throw ('官方安装工具执行失败，详细日志：'+$log)}
    }finally{$env:DSH_HOME=$previousHome;$env:ELECTRON_RUN_AS_NODE=$previousElectron}
    $installed=Join-Path $profile 'node_modules\@dickpy\dsh-imagegen'
    $actual=Get-Content -LiteralPath (Join-Path $installed 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($actual.version -ne $manifest.version){throw '安装后的插件版本不一致。'}
    foreach($file in $manifest.files.PSObject.Properties){
      if($file.Name -notmatch '^lib/[A-Za-z0-9_.-]+\.js$'){throw '安装清单包含无效文件路径。'}
      if((Hash (Join-Path $installed $file.Name)) -ne $file.Value){throw ('安装结果校验失败：'+$file.Name)}
    }
    foreach($dependency in $manifest.bundledDependencies.PSObject.Properties){
      $p=Join-Path $installed ('node_modules\'+$dependency.Name+'\package.json')
      if((Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json).version -ne $dependency.Value){throw ('依赖版本校验失败：'+$dependency.Name)}
    }
    $receipt=@{success=$true;version=$actual.version;installerRevision='single-exe-1';application=$exe;dataDirectory=$DataDirectory;backup=$backup;log=$log;offline=$true;modelCalls=0}
    $receipt|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $logs 'yuanchuang-offline-latest.json') -Encoding UTF8
    Write-Output ('安装成功：'+$actual.version)
    Write-Output '打开 DeepSeek Harness，点击「生图」即可使用。'
    if(-not $NoLaunch){Start-Process -FilePath $exe -WorkingDirectory $appRoot -WindowStyle Normal}
  }
  if($ResultFile){$receipt|ConvertTo-Json|Set-Content -LiteralPath $ResultFile -Encoding UTF8}
  exit 0
}catch{
  $message=$_.Exception.Message
  Write-Output ('安装未完成：'+$message)
  if($ResultFile){@{success=$false;error=$message}|ConvertTo-Json|Set-Content -LiteralPath $ResultFile -Encoding UTF8}
  exit 1
}
