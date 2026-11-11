// 桌面版交付只包含插件和正式安装器，不创建独立浏览器配置。
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {zipFiles} from '../.etsy-test/host.js'
const root=path.resolve(import.meta.dirname,'..'),top=path.resolve(root,'..')
const manifest=JSON.parse(await fs.readFile(path.join(top,'releases/release.json'),'utf8'))
if(manifest.profile!=='desktop')throw new Error('当前交付仅支持DSH桌面版')
const files=[
 {name:manifest.package,data:await fs.readFile(path.join(top,'releases',manifest.package))},
 {name:'release.json',data:Buffer.from(JSON.stringify(manifest,null,2))},
 {name:'install-plugin.ps1',data:Buffer.from('\ufeff'+(await fs.readFile(path.join(root,'distribution/install-plugin.ps1'),'utf8')).replace(/^\ufeff/,''))},
 {name:'双击安装元创插件.cmd',data:await fs.readFile(path.join(root,'distribution/Install-Plugin.cmd'))},
]
const output=path.join(top,'releases',`Studio2-${manifest.version}-DSH`);await fs.mkdir(output,{recursive:true});for(const file of files)await fs.writeFile(path.join(output,file.name),file.data)
const zip=zipFiles(files),target=path.join(top,'releases',`元创EtsyStudio2_${manifest.version}_DSH桌面安装包.zip`);await fs.writeFile(target,zip)
const report={version:manifest.version,profile:'desktop',zip:target,sha256:createHash('sha256').update(zip).digest('hex'),accountsIncluded:false,projectsIncluded:false};await fs.writeFile(path.join(top,'evidence/desktop-integration/delivery.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
