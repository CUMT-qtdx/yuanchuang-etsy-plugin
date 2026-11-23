import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile, lstat, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { detectImageMime } from '../image-format.ts'
import { MAX_PRODUCT_IMAGE_BYTES } from '../image-limits.ts'
import type { GeneratedImage } from '../protocol.ts'
import { imageDataRoot } from '../image-storage-path.ts'
import type { CreationGroup, EtsyProduct } from './types.ts'

export class EtsyStore {
  private readonly corrupt: Array<{ id: string; reason: string }> = []
  constructor(readonly root = path.join(imageDataRoot(), 'etsy-products')) {}
  corruptEntries(): Array<{ id: string; reason: string }> { return this.corrupt.map(item => ({ ...item })) }
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
    this.corrupt.length = 0
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const value = JSON.parse(await readFile(path.join(this.directory(entry.name), 'product.json'), 'utf8')) as EtsyProduct
        if (value.schema !== 1 || value.id !== entry.name || !Array.isArray(value.images)) throw new Error('商品档案结构错误')
        products.push(value)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        // 单条商品档案损坏时只隔离记录并保留原文件供排查，不拖垮整个 Etsy 工作台列表。
        const reason = error instanceof Error ? error.message : String(error)
        this.corrupt.push({ id: entry.name, reason })
        console.warn(`[dsh-imagegen] 已隔离损坏的商品档案 ${entry.name}：${reason}`)
      }
    }
    return products.sort((a, b) => b.createdAt - a.createdAt)
  }
  private groupsFile(): string { return path.join(this.root, 'groups.json') }
  async loadGroups(): Promise<CreationGroup[]> {
    try {
      const raw = JSON.parse(await readFile(this.groupsFile(), 'utf8')) as unknown
      if (!Array.isArray(raw)) return []
      return raw
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
        .map(item => ({
          id: typeof item.id === 'string' ? item.id.trim() : '',
          name: typeof item.name === 'string' ? item.name.trim() : '',
          createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : 0,
        }))
        .filter(item => /^[a-zA-Z0-9-]{1,80}$/.test(item.id) && item.name !== '')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      console.warn(`[dsh-imagegen] 分组文件读取失败，已回退为空列表：${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }
  async saveGroups(groups: CreationGroup[]): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const temporary = path.join(this.root, `.groups-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(groups, null, 2), { mode: 0o600 })
    await rename(temporary, this.groupsFile())
  }
  async saveImage(id: string, image: GeneratedImage): Promise<string> {
    const bytes = Buffer.from(image.b64, 'base64')
    if (bytes.length > MAX_PRODUCT_IMAGE_BYTES) throw new Error('商品图片超过 20 MiB')
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
  async export(id: string, product: EtsyProduct): Promise<{ product: EtsyProduct; files: Array<{ name: string; mime: string; base64: string }>; failures: Array<{ name: string; message: string }> }> {
    const names = [...new Set([...product.referenceFiles, ...product.images.flatMap(image => image.files), ...(product.finalDesigns ?? []).flatMap(design => [...design.materialReference?.samples.map(sample => sample.file) ?? [], ...design.directionGuides?.map(guide => guide.file) ?? []])])]
    const files: Array<{ name: string; mime: string; base64: string }> = [], failures: Array<{ name: string; message: string }> = []
    for (const name of names) {
      try {
        const image = await this.readImage(id, name)
        files.push({ name, mime: image.mime, base64: image.data.toString('base64') })
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        // 导出清单使用可理解的错误原因，避免把本机文件路径写入资料包。
        const message = code === 'ENOENT' ? '原图文件不存在' : code === 'EACCES' || code === 'EPERM' ? '没有读取原图的权限' : error instanceof Error && ['图片已损坏', '无效图片文件名'].includes(error.message) ? error.message : '原图读取失败'
        failures.push({ name, message })
      }
    }
    return { product, files, failures }
  }
}
