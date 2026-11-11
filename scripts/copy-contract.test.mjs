// 文案合同回归：使用合成事实与固定错误形状，不读取真实商品或模型日志。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { facts, copyValue, fixture, input } from './etsy-fixture.mjs'
import { validateCopy, separateInternalNotes, cleanListingTitle, normalizeTitleLanguages, exportProduct } from '../.etsy-test/host.js'

const withoutDecoration = value => value.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim()
function unzipPlainFiles(bytes) {
  const files = new Map()
  let offset = 0
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(bytes.readUInt16LE(offset + 8), 0, '测试只解析本项目的无压缩 ZIP')
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extraSize = bytes.readUInt16LE(offset + 28)
    const start = offset + 30 + nameSize + extraSize
    files.set(bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8'), bytes.subarray(start, start + size).toString('utf8'))
    offset = start + size
  }
  return files
}

test('无句号逐行文案：只移走内部提示，五行外观描述完整保留', () => {
  const visible = [
    'Meet a sweet puppy with a soft cream scarf 🌼',
    'A little caramel beret sits on its head 🧸',
    'The coat mixes light brown and creamy white tones ✨',
    'Its expression stays gentle and cheerful 💛',
    'The background is warm white and simple 🌿',
  ]
  const notes = [
    'This listing shows an appearance-based design draft',
    'Material and format details are still to be confirmed',
    'Please check the final details before ordering',
  ]
  const raw = { ...copyValue(), description: [...visible, ...notes].join('\n') }
  const copy = validateCopy(raw, facts)
  assert.equal(withoutDecoration(copy.description), withoutDecoration(visible.join('\n')))
  assert.ok(copy.humanConfirmation.includes(notes[0]))
  assert.ok(copy.humanConfirmation.includes(notes[1]))
  assert.ok(copy.humanConfirmation.includes(notes[2]))
  assert.doesNotMatch(copy.description, /design draft|to be confirmed|before ordering/i)
})

test('内部资料提示被硬换行时，不吞掉相邻的正常商品句子', () => {
  const value = 'A cheerful puppy with a bright expression\nActual materials and size\nneed confirmation before ordering\nA tiny scarf adds a playful accent'
  const result = separateInternalNotes(value)
  assert.equal(result.description, 'A cheerful puppy with a bright expression\nA tiny scarf adds a playful accent')
  assert.deepEqual(result.notes, ['Actual materials and size need confirmation before ordering'])
})

test('英文标题和中文译名中的草稿定位词都移除，主体主题词仍保留', () => {
  const english = cleanListingTitle('Autumn Acorn Puppy Design Draft | Cute Forest-Themed Dog Concept')
  const chinese = cleanListingTitle('秋日橡果小狗设计草稿｜可爱森林主题小狗概念')
  assert.doesNotMatch(english, /draft|concept|visual reference/i)
  assert.match(english, /Autumn Acorn Puppy/)
  assert.match(english, /Forest-Themed Dog/)
  assert.doesNotMatch(chinese, /草稿|概念|内部审核/)
  assert.match(chinese, /秋日橡果小狗/)
  assert.match(chinese, /森林主题小狗/)
  assert.equal(cleanListingTitle(english), english)
})

test('模型对调中英字段时，使用已有完整英文归位，不丢失中文译名', () => {
  const source = copyValue()
  source.titles[0] = { ...source.titles[0], title: '深蓝星夜斗篷小狗概念设计', titleZh: 'Adorable Puppy with Navy Star Cape Visual Reference' }
  const copy = validateCopy(source, facts)
  assert.equal(copy.titles[0].title, 'Adorable Puppy with Navy Star Cape')
  assert.equal(copy.titles[0].titleZh, '深蓝星夜斗篷小狗')
  assert.equal(normalizeTitleLanguages(copy.titles[0].title, copy.titles[0].titleZh).title, copy.titles[0].title)
})

test('未知中文片段不能用截掉中文的方式伪造英文标题', () => {
  const source = copyValue()
  source.titles[1] = { ...source.titles[1], title: 'Cute 卡尔利尼斯浮纹小狗造型', titleZh: '可爱卡尔利尼斯浮纹小狗造型' }
  assert.throws(() => validateCopy(source, facts), /英文/)
})

test('提示移走后确实没有商品正文时要明确失败，不把内部话当作商品稿', () => {
  const source = { ...copyValue(), description: 'Actual materials and size need confirmation. Please check final details before ordering.' }
  assert.throws(() => validateCopy(source, facts), /不能为空/)
})

test('公开导出与内部复核分文件，公开标题不带草稿词且保留中文译名文件', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'etsy-copy-contract-'))
  const context = fixture(directory)
  await context.workflow.ready
  t.after(async () => { context.workflow.dispose(); await context.workflow.idle(); await rm(directory, { recursive: true, force: true }) })
  const created = await context.workflow.start(input({ count: 1 }))
  await context.workflow.idle()
  const product = await context.workflow.get(created.id)
  product.copy.titles[0].title = 'Red Scarf Cat Design'
  product.copy.titles[0].titleZh = '红围巾小猫设计'
  product.copy.description += '\nActual materials and size need confirmation.'
  product.copy.humanConfirmation.push('Internal-only example: verify the physical sample.')
  const files = unzipPlainFiles(await exportProduct(product, context.workflow.store))
  assert.match(files.get('listing.txt'), /^Red Scarf Cat Design\n/)
  assert.doesNotMatch(files.get('listing.txt'), /Design Draft|need confirmation|Internal-only|待确认/i)
  assert.ok(files.get('review-notes.txt').includes('Internal-only example'))
  assert.ok(files.get('title-translations.txt').includes('中文译名'))
})
