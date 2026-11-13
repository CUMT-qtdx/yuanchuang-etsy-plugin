// 全部使用隔离文件和模拟响应，不调用生图或真实安装进程。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { AppUpdateService } from '../src/in-app-update.ts'
import { compareReleaseVersions, releaseInfo, REPOSITORY } from '../src/release-discovery.ts'
import { checkForUpdate, clearUpdateCache } from '../src/updater.ts'
const bytes=Buffer.from('MZ-isolated-installer-fixture'),sha=createHash('sha256').update(bytes).digest('hex')
function release(version='2.1.2'){
 const name=`Update-Yuanchuang-Etsy-${version}.exe`
 return {tag_name:'v'+version,body:'新版内容',draft:false,prerelease:false,assets:[{name,size:bytes.length,digest:'sha256:'+sha,browser_download_url:`https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`}]}
}
async function setup(t,extra={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'update-service-test-'))
 t.after(()=>fs.rm(root,{recursive:true,force:true}))
 const app=path.join(root,'DSH','DeepSeek Harness.exe');await fs.mkdir(path.join(root,'DSH/resources/runtime/cli/bin'),{recursive:true});await fs.writeFile(app,'fixture');await fs.writeFile(path.join(root,'DSH/resources/runtime/cli/bin/dsh.cmd'),'fixture')
 await fs.mkdir(path.join(root,'profiles/desktop/node_modules/@dickpy/dsh-imagegen'),{recursive:true});await fs.writeFile(path.join(root,'profiles/desktop/node_modules/@dickpy/dsh-imagegen/package.json'),'{"version":"2.1.1"}')
 const service=new AppUpdateService({dataDirectory:root,application:app,busy:async()=>false,check:async()=>releaseInfo(release(),'2.1.1'),fetchFn:async()=>new Response(bytes),helperPath:new URL('../distribution/windows/Apply-Update.ps1',import.meta.url),...extra})
 return {root,service,app}
}
async function settled(service){for(let i=0;i<200;i++){const s=await service.status();if(s.phase!=='downloading')return s;await new Promise(r=>setTimeout(r,10))}throw Error('下载未结束')}
test('历史后缀与纯数字版本正确比较',()=>{
 for(const[a,b]of [['2.0.0-etsy.10','2.0.0-etsy.9'],['2.0.10-etsy','2.0.0-etsy.9'],['2.1.1','2.0.10-etsy'],['2.1.10','2.1.9'],['2.2.1','2.1.10']])assert(compareReleaseVersions(a,b)>0)
 assert.equal(compareReleaseVersions('v2.1.1','2.1.1'),0)
})
test('只接受该仓库唯一的带校验值EXE；拒绝其他主机和多附件',()=>{
 assert.equal(releaseInfo(release(),'2.1.1').installer.sha256,sha)
 const missing=release();delete missing.assets[0].digest;assert.throws(()=>releaseInfo(missing,'2.1.1'),/SHA-256/)
 const foreign=release();foreign.assets[0].browser_download_url='https://evil.example/file.exe';assert.throws(()=>releaseInfo(foreign,'2.1.1'),/不属于/)
 const extra=release();extra.assets.push({...extra.assets[0],name:'extra.zip'});assert.throws(()=>releaseInfo(extra,'2.1.1'),/单个 EXE/)
})
test('检测缓存支持手动刷新并正确识别新版',async()=>{
 clearUpdateCache();let calls=0;const fetchFn=async url=>{assert.equal(url,`https://api.github.com/repos/${REPOSITORY}/releases/latest`);calls++;return new Response(JSON.stringify(release()))}
 const first=await checkForUpdate(fetchFn,100);assert.equal(first.updateAvailable,true);await checkForUpdate(fetchFn,101);assert.equal(calls,1);await checkForUpdate(fetchFn,102,true);assert.equal(calls,2)
})
test('真实流读取、文件大小与哈希通过后才进入ready；重复点击不重复下载',async t=>{
 let fetchCount=0;const{service}=await setup(t,{fetchFn:async()=>{fetchCount++;return new Response(new ReadableStream({start(c){c.enqueue(bytes.subarray(0,8));setTimeout(()=>{c.enqueue(bytes.subarray(8));c.close()},40)}}))}})
 await service.download('2.1.2');await service.download('2.1.2');const result=await settled(service);assert.equal(result.phase,'ready');assert.equal(result.receivedBytes,bytes.length);assert.equal(fetchCount,1)
})
test('损坏的下载被拒绝，不启动安装进程',async t=>{
 let launched=0;const{service}=await setup(t,{fetchFn:async()=>new Response(Buffer.from('corrupted')),launch:async()=>{launched++}})
 await service.download('2.1.2');assert.equal((await settled(service)).phase,'failed');await assert.rejects(service.restart('2.1.2'),/请先下载/);assert.equal(launched,0)
})
test('进行中的任务阻止更新，完成后写入受控计划并交接一次',async t=>{
 let busy=true,launched=0,plan
 const{service}=await setup(t,{busy:async()=>busy,launch:async(_helper,file)=>{launched++;plan=JSON.parse(await fs.readFile(file,'utf8'))}})
 await service.download('2.1.2');await settled(service);await assert.rejects(service.restart('2.1.2'),/任务进行中/);assert.equal(launched,0)
 busy=false;assert.equal((await service.restart('2.1.2')).phase,'restarting');assert.equal(plan.version,'2.1.2');assert.equal(plan.sha256,sha);assert.equal(launched,1);await assert.rejects(service.restart('2.1.2'),/已经开始/)
})
test('下载后文件被改动，交接前再次校验并拒绝',async t=>{
 const{service,root}=await setup(t);await service.download('2.1.2');await settled(service)
 const dirs=await fs.readdir(path.join(root,'plugin-updates/yuanchuang/downloads'));await fs.appendFile(path.join(root,'plugin-updates/yuanchuang/downloads',dirs[0],'Update-Yuanchuang-Etsy-2.1.2.exe'),'tamper')
 await assert.rejects(service.restart('2.1.2'),/已变化/)
})
test('下载中断可重新尝试；重启后读到独立进程的结果',async t=>{
 let calls=0;const{service,root}=await setup(t,{fetchFn:async()=>{if(!calls++)throw Error('网络断开');return new Response(bytes)}})
 await service.download('2.1.2');assert.equal((await settled(service)).phase,'failed');await service.download('2.1.2');assert.equal((await settled(service)).phase,'ready')
 const file=path.join(root,'plugin-updates/yuanchuang/state.json');await fs.writeFile(file,'\ufeff'+JSON.stringify({phase:'failed',version:'2.1.2',message:'已恢复旧版',rolledBack:true,receivedBytes:0,totalBytes:0,updatedAt:Date.now()}))
 const other=new AppUpdateService({dataDirectory:root,busy:async()=>false});assert.equal((await other.status()).rolledBack,true)
})
