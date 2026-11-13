param([Parameter(Mandatory=$true)][string]$Plan)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
# DSH 可能从 PowerShell 7 启动；为此子进程补齐 Windows PowerShell 自带模块路径。
$systemModules=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules'
$env:PSModulePath=$systemModules+';'+$env:PSModulePath
Write-Output '更新程序已启动'
# 独立进程负责更新交接，父 DSH 退出后仍能运行。仅操作同一用户、同一程序路径。
$job=$null
$validated=$false
$pathsValidated=$false
function Hash([string]$File){
  $stream=[IO.File]::OpenRead($File);$algorithm=[Security.Cryptography.SHA256]::Create()
  try{return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}
  finally{$algorithm.Dispose();$stream.Dispose()}
}
function State([string]$Phase,[string]$Message,[bool]$RolledBack=$false){
  $body=@{phase=$Phase;version=$job.version;receivedBytes=0;totalBytes=0;message=$Message;updatedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();rolledBack=$RolledBack}
  $temp=$job.stateFile+'.'+[Guid]::NewGuid().ToString('N')+'.tmp'
  $body|ConvertTo-Json|Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $job.stateFile -Force
}
function SameAppProcesses{
  $owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach($p in @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction Stop)){
    if($p.ExecutablePath -ine $job.application){continue}
    $identity=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid -ErrorAction SilentlyContinue
    if($identity.Sid -eq $owner){$p}
  }
}
try{
  $job=Get-Content -LiteralPath $Plan -Raw -Encoding UTF8|ConvertFrom-Json
  if($job.schema -ne 1 -or $job.version -notmatch '^\d+\.\d+\.\d+(?:-etsy(?:\.\d+)?)?$' -or $job.sha256 -notmatch '^[a-f0-9]{64}$'){throw '更新计划无效'}
  $data=[IO.Path]::GetFullPath($job.dataDirectory)
  $updateRoot=Join-Path $data 'plugin-updates\yuanchuang'
  foreach($file in @($Plan,$job.installer,$job.stateFile,$job.receipt,$job.logFile)){
    if(-not [IO.Path]::GetFullPath($file).StartsWith($updateRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '更新文件超出本机更新目录'}
  }
  $pathsValidated=$true
  if([IO.Path]::GetFileName($job.application) -ine 'DeepSeek Harness.exe' -or -not(Test-Path -LiteralPath $job.application)){throw 'DSH 程序路径无效'}
  if((Hash $job.installer) -ne $job.sha256){throw '安装器 SHA-256 校验失败'}
  $validated=$true
  $profile=Join-Path $data 'profiles\desktop'
  $oldManifest=Get-Content -LiteralPath (Join-Path $profile 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json
  $oldSpec=$oldManifest.dependencies.'@dickpy/dsh-imagegen';$oldPackage=$null
  if($oldSpec -like 'file:*'){
    $candidate=$oldSpec.Substring(5)
    if(-not [IO.Path]::IsPathRooted($candidate)){$candidate=Join-Path $profile $candidate}
    if(Test-Path -LiteralPath $candidate -PathType Leaf){$oldPackage=[IO.Path]::GetFullPath($candidate)}
  }
  $oldStore=$null;$modules=Join-Path $profile 'node_modules\.modules.yaml'
  if(Test-Path -LiteralPath $modules){$m=Get-Content -LiteralPath $modules -Raw -Encoding UTF8;try{$oldStore=($m|ConvertFrom-Json).storeDir}catch{if($m -match '(?m)^storeDir:\s*(.+?)\s*$'){$oldStore=$Matches[1].Trim().Trim('"').Trim("'")}}}
  if($oldStore -and [IO.Path]::GetFileName($oldStore.TrimEnd('\','/')) -match '^v\d+$'){$oldStore=Split-Path -Parent $oldStore}
  # 先让接口返回，再尝试关闭窗口；残留托盘进程只限当前用户的这份 DSH。
  Start-Sleep -Milliseconds 1200
  foreach($p in @(SameAppProcesses)){try{[void](Get-Process -Id $p.ProcessId -ErrorAction Stop).CloseMainWindow()}catch{}}
  Start-Sleep -Milliseconds 1800
  foreach($p in @(SameAppProcesses)){Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop}
  $deadline=[DateTime]::UtcNow.AddSeconds(15)
  while(@(SameAppProcesses).Count -gt 0){if([DateTime]::UtcNow -gt $deadline){throw 'DSH 未能完全退出，安装未开始'};Start-Sleep -Milliseconds 300}
  State 'installing' '正在安装新版插件'
  $args=@('--silent','--no-launch','--app',('"'+$job.application+'"'),'--data',('"'+$data+'"'),'--result',('"'+$job.receipt+'"'))
  $process=Start-Process -FilePath $job.installer -ArgumentList $args -WindowStyle Hidden -Wait -PassThru
  $receipt=if(Test-Path -LiteralPath $job.receipt){Get-Content -LiteralPath $job.receipt -Raw -Encoding UTF8|ConvertFrom-Json}else{$null}
  $actual=Get-Content -LiteralPath (Join-Path $profile 'node_modules\@dickpy\dsh-imagegen\package.json') -Raw -Encoding UTF8|ConvertFrom-Json
  if($process.ExitCode -ne 0 -or -not $receipt.success -or $actual.version -ne $job.version){throw '新版安装未完成，正在恢复旧版'}
  State 'completed' ('已更新到 '+$actual.version)
}catch{
  $message=$_.Exception.Message;$rolledBack=$false
  Write-Output ('更新交接失败：'+$message)
  if($job -and $pathsValidated -and -not $validated){State 'failed' ('更新未开始：'+$message)}
  if($job -and $validated){
    $message|Set-Content -LiteralPath $job.logFile -Encoding UTF8
    if($oldPackage){try{
      $env:DSH_HOME=$job.dataDirectory;$env:ELECTRON_RUN_AS_NODE=$null
      $cli=Join-Path (Split-Path -Parent $job.application) 'resources\runtime\cli\bin\dsh.cmd'
      $args=@('plugin','--profile','desktop','add','--save-exact','--offline',$oldPackage,'--config.auto-install-peers=false')
      if($oldStore){$args+=@('--store-dir',$oldStore)}
      & $cli @args >> $job.logFile 2>&1
      $restored=Get-Content -LiteralPath (Join-Path $job.dataDirectory 'profiles\desktop\node_modules\@dickpy\dsh-imagegen\package.json') -Raw -Encoding UTF8|ConvertFrom-Json
      $rolledBack=$LASTEXITCODE -eq 0 -and $restored.version -eq $job.previousVersion
    }catch{}}
    State 'failed' ($(if($rolledBack){'更新未完成，已恢复旧版。'}else{'更新未完成：'+$message})) $rolledBack
  }
}finally{
  if($job -and $validated -and (Test-Path -LiteralPath $job.application)){
    $env:ELECTRON_RUN_AS_NODE=$null;$env:DSH_HOME=$job.dataDirectory
    if($job.userDataDirectory){
      Start-Process -FilePath $job.application -ArgumentList ('--user-data-dir="'+[IO.Path]::GetFullPath($job.userDataDirectory)+'"') -WorkingDirectory (Split-Path -Parent $job.application) -WindowStyle Normal
    }else{
      Start-Process -FilePath $job.application -WorkingDirectory (Split-Path -Parent $job.application) -WindowStyle Normal
    }
  }
}
