// 用独立程序路径和空白数据实测真实 EXE 安装、父进程退出、重新启动与安装失败回退。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createWriteStream } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { AppUpdateService } from '../src/in-app-update.ts'
import { releaseInfo, REPOSITORY } from '../src/release-discovery.ts'
const root=path.resolve('E:/etsy/_codex_tmp/inapp-update-211/integration');await fs.mkdir(root,{recursive:true})
const source='E:/etsy/DeepSeek Harness',appRoot=path.join(root,'DSH-test');await fs.mkdir(appRoot,{recursive:true})
for(const entry of await fs.readdir(source,{withFileTypes:true})){
 const dest=path.join(appRoot,entry.name);try{await fs.access(dest);continue}catch{}
 if(entry.isFile())await fs.link(path.join(source,entry.name),dest)
 else if(['resources','locales','swiftshader'].includes(entry.name))await fs.symlink(path.join(source,entry.name),dest,'junction')
}
const app=path.join(appRoot,'DeepSeek Harness.exe'),powershell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'"
// 不复制正式配置。仅从无密钥的包清单定位现有离线旧包。
const pkg=JSON.parse(await fs.readFile('E:/etsy/desktop-data/profiles/desktop/package.json','utf8'))
const oldPackage=pkg.dependencies['@dickpy/dsh-imagegen'].replace(/^file:/,'')
const targetExe='E:/etsy/_codex_tmp/inapp-update-211/release/Update-Yuanchuang-Etsy-2.1.1.exe'
const helper=new URL('../distribution/windows/Apply-Update.ps1',import.meta.url)
async function initialize(name){
 const data=path.join(root,name);await fs.mkdir(path.join(data,'profiles/desktop'),{recursive:true});await fs.mkdir(path.join(data,'appdata'),{recursive:true})
 await fs.writeFile(path.join(data,'profiles/desktop/package.json'),JSON.stringify({name:'dsh-profile-desktop',private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}},dependencies:{}}))
 const script=path.join(data,'seed.ps1');await fs.writeFile(script,'\ufeff'+[`$env:DSH_HOME=${quote(data)}`,'$env:ELECTRON_RUN_AS_NODE=$null',`& ${quote(path.join(appRoot,'resources/runtime/cli/bin/dsh.cmd'))} plugin --profile desktop add --offline --save-exact ${quote(oldPackage)} --store-dir ${quote(path.join(data,'store'))} --config.auto-install-peers=false`,'exit $LASTEXITCODE'].join('\r\n'))
 const seeded=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',windowsHide:true,timeout:120000});await fs.writeFile(path.join(data,'seed.log'),(seeded.stdout||'')+(seeded.stderr||''));assert.equal(seeded.status,0,'隔离旧版本安装失败')
 const dummy=[{id:'imagegen',name:'@dickpy/dsh-imagegen',config:{enabled:true,channels:[],channelSecrets:{test:'isolated-test-not-real-key'}}}]
 await fs.writeFile(path.join(data,'profiles/desktop/cordis.patch.yml'),JSON.stringify(dummy,null,2))
 await fs.mkdir(path.join(data,'dsh-imagegen'),{recursive:true});await fs.writeFile(path.join(data,'dsh-imagegen/项目文件.txt'),'只用于检查更新前后保留数据')
 return data
}
async function stopClone(){
 const script=path.join(root,'stop-test.ps1');await fs.writeFile(script,"Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Where-Object {$_.ExecutablePath -ieq "+quote(app)+"} | ForEach-Object {Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null}")
 spawnSync(powershell,['-NoProfile','-ExecutionPolicy','Bypass','-File',script],{windowsHide:true,timeout:20000})
}
async function scenario(name,exe,version,shouldSucceed){
 await stopClone();const data=await initialize(name),config=path.join(data,'profiles/desktop/cordis.patch.yml'),before=await fs.readFile(config,'utf8')
 const installedRoot=path.join(data,'profiles/desktop/node_modules/@dickpy/dsh-imagegen'),previous=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8')).version
 const bytes=await fs.readFile(exe),file=`Update-Yuanchuang-Etsy-${version}.exe`
 const info=releaseInfo({tag_name:'v'+version,assets:[{name:file,size:bytes.length,digest:'sha256:'+sha(bytes),browser_download_url:`https://github.com/${REPOSITORY}/releases/download/v${version}/${file}`}]},previous)
 const heartbeat=path.join(data,'old-runtime.cjs');await fs.writeFile(heartbeat,"setInterval(()=>{},1000)")
 const old=spawn(app,[heartbeat],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_HOME:data,APPDATA:path.join(data,'appdata')},windowsHide:true,stdio:'ignore'});await new Promise(resolve=>setTimeout(resolve,300))
 const downloadServer=createServer((_req,res)=>{res.setHeader('content-length',bytes.length);res.end(bytes)});await new Promise(r=>downloadServer.listen(0,'127.0.0.1',r))
 const service=new AppUpdateService({dataDirectory:data,application:app,userDataDirectory:path.join(data,'electron-user-data'),busy:async()=>false,check:async()=>info,fetchFn:async()=>fetch('http://127.0.0.1:'+downloadServer.address().port+'/installer.exe'),helperPath:helper})
 await service.download(version);for(let i=0;i<300&&(await service.status()).phase==='downloading';i++)await new Promise(r=>setTimeout(r,20));assert.equal((await service.status()).phase,'ready');await service.restart(version)
 let final;for(let i=0;i<240;i++){final=await service.status();if(['completed','failed'].includes(final.phase))break;await new Promise(r=>setTimeout(r,500))}
 assert.equal(final.phase,shouldSucceed?'completed':'failed',JSON.stringify(final));assert.equal(shouldSucceed||final.rolledBack,true,'失败时没有恢复旧版')
 const actual=JSON.parse(await fs.readFile(path.join(installedRoot,'package.json'),'utf8')).version;assert.equal(actual,shouldSucceed?version:previous)
 assert.equal(await fs.readFile(config,'utf8'),before,'配置和测试密钥被改动');assert.equal(await fs.readFile(path.join(data,'dsh-imagegen/项目文件.txt'),'utf8'),'只用于检查更新前后保留数据')
 await new Promise(r=>setTimeout(r,1200));const restartCheck=path.join(data,'restart-check.ps1');await fs.writeFile(restartCheck,"@(Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Where-Object {$_.ExecutablePath -ieq "+quote(app)+"}).Count")
 const running=spawnSync(powershell,['-NoProfile','-File',restartCheck],{encoding:'utf8',windowsHide:true,timeout:15000});assert(Number(running.stdout.trim())>0,'安装后没有重新启动 DSH')
 await stopClone();await new Promise(resolve=>downloadServer.close(resolve));const row={scenario:name,passed:true,from:previous,to:actual,phase:final.phase,rolledBack:!!final.rolledBack,configurationUnchanged:true,dataPreserved:true,restarted:true,oldProcessExited:old.exitCode!==null||old.signalCode!==null};console.log(JSON.stringify(row));return row
}
const broken=path.join(root,'broken-installer.exe'),sourceCs=path.join(root,'Broken.cs');await fs.writeFile(sourceCs,'using System;class Broken{static int Main(string[] a){return 19;}}')
const compiled=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/target:winexe','/out:'+broken,sourceCs],{encoding:'utf8',windowsHide:true});assert.equal(compiled.status,0)
 const results=[]
try{results.push(await scenario('成功更新_独立数据',targetExe,'2.1.1',true));results.push(await scenario('失败回退_独立数据',broken,'2.1.2',false));await fs.writeFile(path.join(root,'integration-result.json'),JSON.stringify({passed:true,results},null,2))}finally{await stopClone()}
