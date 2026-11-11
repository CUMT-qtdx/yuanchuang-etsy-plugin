// 文案质量回归使用合成资料，不调用模型，也不读取真实商品。
import test from 'node:test'
import assert from 'node:assert/strict'
import { facts, copyValue } from './etsy-fixture.mjs'
import { validateCopy, listingUsesEnglish, formatProductDescription, cleanListingTitle } from '../.etsy-test/host.js'

test('生成稿移除错误材料和单位，但保留合格外观描述及标题', () => {
  const raw = copyValue()
  raw.description = 'A cheerful cat wears a red scarf. Made from cotton. Size: 10 inches.'
  const copy = validateCopy(raw, facts, { mode: 'generated' })
  assert.match(copy.description, /cheerful cat/)
  assert.doesNotMatch(copy.description, /cotton|inches/)
  assert.ok(copy.fieldIssues.some(issue => issue.field === 'description'))
  assert.ok(listingUsesEnglish(copy))
})

test('人工修改参数冲突必须报错，不能静默丢掉员工输入', () => {
  for (const description of ['Made from cotton.', 'Size: 10 inches.']) {
    assert.throws(() => validateCopy({ ...copyValue(), description }, facts, { mode: 'edit' }), /材料|尺寸|单位/)
  }
})

test('未确认承诺移出生成稿，合法外观表述不受影响', () => {
  const unknown = { ...facts, type: 'unspecified', confirmed: false, materials: '', dimensions: '', packaging: '', processing: '', delivery: '', personalization: '' }
  const raw = copyValue()
  raw.titles = raw.titles.map((row, index) => ({ ...row, title: `Red Scarf Cat ${['Figure', 'Design', 'Character', 'Decoration', 'Style'][index]}` }))
  raw.tags = ['cat figure']; raw.sellingPoints = ['Soft visual texture']; raw.factsUsed = {}
  raw.description = 'A cheerful cat has a wool-like visual texture. Safe for newborn babies. Non toxic and washable. Handmade with care. Delivery is guaranteed.'
  const copy = validateCopy(raw, unknown, { mode: 'generated' })
  assert.match(copy.description, /wool-like visual texture/)
  assert.doesNotMatch(copy.description, /newborn|non toxic|washable|handmade|guaranteed/i)
})

test('已确认材料、单位、包装和制作期不被误删', () => {
  const raw = { ...copyValue(), description: 'Made from wool. Size: 10 cm. Packed in a paper box. Processing time: 5 days.' }
  const copy = validateCopy(raw, facts, { mode: 'generated' })
  assert.match(copy.description, /wool/)
  assert.match(copy.description, /10 cm/)
  assert.match(copy.description, /paper box/)
  assert.match(copy.description, /5 days/)
})

test('坏标题与缺失中文译名只影响对应槽位，其他公开字段仍可用', () => {
  const raw = copyValue()
  raw.titles[0].title = 'Cute Кот Cat Figure'
  raw.titles[1].titleZh = 'This is not Chinese'
  raw.tags = ['felt cat', 'cat кот']
  const copy = validateCopy(raw, facts, { mode: 'generated' })
  assert.equal(copy.titles.length, 5)
  assert.equal(copy.titles[0].title, '')
  assert.equal(copy.titles[1].titleZh, undefined)
  assert.equal(copy.selectedTitle, 1)
  assert.deepEqual(copy.tags, ['felt cat'])
  assert.ok(copy.fieldIssues.some(issue => issue.field === 'titles.0'))
  assert.ok(copy.fieldIssues.some(issue => issue.field === 'titleZh.1'))
  assert.ok(listingUsesEnglish(copy))
  assert.doesNotThrow(() => validateCopy(copy, facts, { mode: 'edit' }))
})

test('缺正文或标签不丢失合格标题，完全没有公开内容才失败', () => {
  const raw = { ...copyValue(), description: '고양이', tags: [] }
  const copy = validateCopy(raw, facts, { mode: 'generated' })
  assert.equal(copy.description, '')
  assert.ok(listingUsesEnglish(copy))
  assert.throws(() => validateCopy({ ...raw, titles: [] }, facts, { mode: 'generated' }), /没有|未返回/)
})

test('生成和读取使用一致语言规则，概念措辞不会误报为非英文', () => {
  const copy = validateCopy({ ...copyValue(), description: 'A charming design concept with a red scarf.' }, facts, { mode: 'generated' })
  assert.ok(listingUsesEnglish(copy))
  assert.match(copy.description, /red scarf/)
  assert.equal(cleanListingTitle('Brown Draft Horse Figure'), 'Brown Draft Horse Figure')
})

test('正文保留自然完整句子，不强制补表情或在十词处断行，格式化幂等', () => {
  const sentence = 'This lovely little cat has a cheerful soft red scarf ✨'
  const formatted = formatProductDescription(sentence)
  assert.equal(formatted, sentence)
  assert.equal(formatProductDescription('A cheerful cat wears a red scarf.'), 'A cheerful cat wears a red scarf.')
  const crowded = formatProductDescription('🌟 🌿 🧸 🌼 💛 ✨ A cheerful cat wears a red scarf.')
  assert.ok([...crowded.matchAll(/\p{Extended_Pictographic}/gu)].length <= 1)
  assert.equal(formatProductDescription(crowded), crowded)
  assert.ok(crowded.split('\n').every(line => !line.trim() || /[A-Za-z]/.test(line)))
})

test('中文常见事实与等效单位可用，否定材料和不同承诺不能互相授权', () => {
  const chineseFacts = { ...facts, materials: '羊毛', dimensions: '10厘米', packaging: '纸盒', processing: '5天' }
  const raw = { ...copyValue(), description: 'Made from wool. Size: 100 mm. Packed in a paper box. Processing time: 5 days.' }
  const valid = validateCopy(raw, chineseFacts, { mode: 'generated' })
  assert.match(valid.description, /wool/)
  assert.match(valid.description, /100 mm/)
  assert.match(valid.description, /paper box/)
  assert.match(valid.description, /5 days/)
  for (const [overrides, description] of [
    [{ materials: 'wool, non toxic' }, 'Safe for newborn babies.'],
    [{ materials: 'wool, non toxic' }, 'Hypoallergenic for daily use.'],
    [{ materials: 'wool, washable' }, 'Waterproof for daily use.'],
    [{ materials: 'wool, not waterproof' }, 'Waterproof for daily use.'],
    [{ delivery: 'free shipping' }, 'Commercial use is included.'],
    [{ delivery: 'free shipping' }, 'Delivery is guaranteed.'],
    [{ materials: 'wool, no cotton' }, 'Made from cotton.'],
    [{ materials: '羊毛，不含棉' }, 'Made from cotton.'],
    [{ packaging: 'paper box' }, 'Packed in a gift box.'],
  ]) assert.throws(() => validateCopy({ ...copyValue(), description }, { ...facts, ...overrides }, { mode: 'edit' }))
  assert.doesNotThrow(() => validateCopy({ ...copyValue(), description: 'A cat in cotton candy pink tones.' }, facts, { mode: 'edit' }))
})
