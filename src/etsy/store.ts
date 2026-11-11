import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile, lstat, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { detectImageMime } from '../image-format.ts'
import type { GeneratedImage } from '../protocol.ts'
import { imageDataRoot } from '../image-storage-path.ts'
import type { EtsyProduct } from './types.ts'

export class EtsyStore {
  constructor(readonly root = path.join(imageDataRoot(), 'etsy-products')) {}
  private directory(id: string): string {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('无效商品 ID')
    return path.join(this.root, id)
  }
  async save(product: EtsyProduct, options: { bumpRevision?: boolean } = {}): Promise<void> {
    const dir = this.directory(product.id)
    await mkdir(dir, { recursive: true })
    product.updatedAt = Date.now()
    if (options.bumpRevision !== false) product.revision += 1
    const temporary = path.join(dir, `.${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(product, null, 2), { mode: 0o600 })
    await rename(temporary, path.join(dir, 'product.json'))
  }
  async remove(id: string): Promise<void> {
    const directory = path.resolve(this.directory(id)), root = path.resolve(this.root)
    if (path.dirname(directory) !== root) throw new Error('拒绝删除商品目录之外的文件')
    try {
      if ((await lstat(directory)).isSymbolicLink()) throw new Error('商品目录为链接，未执行删除')
      const resolved = await realpath(directory), resolvedRoot = await realpath(root)
      if (path.dirname(resolved) !== resolvedRoot) throw new Error('商品目录超出存储范围，未执行删除')
      // 先验证最终绝对路径，递归删除仅限当前商品的独立目录。
      await rm(resolved, { recursive: true, force: false })
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  async load(): Promise<EtsyProduct[]> {
    await mkdir(this.root, { recursive: true })
    const products: EtsyProduct[] = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const value = JSON.parse(await readFile(path.join(this.directory(entry.name), 'product.json'), 'utf8')) as EtsyProduct
        if (value.schema !== 1 || value.id !== entry.name || !Array.isArray(value.images)) throw new Error('商品档案结构错误')
        products.push(value)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        // 不以空档案覆盖损坏数据；保留文件供诊断。
        throw new Error(`无法加载商品 ${entry.name}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return products.sort((a, b) => b.createdAt - a.createdAt)
  }
  async saveImage(id: string, image: GeneratedImage): Promise<string> {
    const bytes = Buffer.from(image.b64, 'base64')
    if (bytes.length > 20 * 1024 * 1024) throw new Error('商品图片超过 20 MiB')
    const mime = detectImageMime(bytes)
    if (mime === undefined) throw new Error('商品图片格式无法识别')
    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]
    const file = `${randomUUID()}.${ext}`
    await mkdir(this.directory(id), { recursive: true })
    await writeFile(path.join(this.directory(id), file), bytes, { flag: 'wx', mode: 0o600 })
    return file
  }
  async readImage(id: string, file: string): Promise<{ data: Buffer; mime: string }> {
    if (!/^[a-zA-Z0-9-]+\.(png|jpg|webp|gif|bmp)$/.test(file)) throw new Error('无效图片文件名')
    const data = await readFile(path.join(this.directory(id), file))
    const mime = detectImageMime(data)
    if (mime === undefined) throw new Error('图片已损坏')
    return { data, mime }
  }
  async dataUrl(id: string, file: string): Promise<string> {
    const image = await this.readImage(id, file)
    return `data:${image.mime};base64,${image.data.toString('base64')}`
  }
  async export(id: string, product: EtsyProduct): Promise<{ product: EtsyProduct; files: Array<{ name: string; mime: string; base64: string }> }> {
    const names = [...new Set([...product.referenceFiles, ...product.images.flatMap(image => image.files), ...(product.finalDesigns ?? []).flatMap(design => [...design.materialReference?.samples.map(sample => sample.file) ?? [], ...design.directionGuides?.map(guide => guide.file) ?? []])])]
    const files = await Promise.all(names.map(async name => {
      const image = await this.readImage(id, name)
      return { name, mime: image.mime, base64: image.data.toString('base64') }
    }))
    return { product, files }
  }
}
