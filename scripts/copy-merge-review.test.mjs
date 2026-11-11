// 从实际校验产物构造部分文案，覆盖定点补齐时的交叉字段边界。
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCopy, mergeCopyRepair } from '../.etsy-test/host.js'
import { facts, copyValue } from './etsy-fixture.mjs'
const generated = value => validateCopy(value, facts, { mode: 'generated' })
const hasIssue = (copy, field) => copy.fieldIssues?.some(issue => issue.field === field) ?? false

test('定点补齐补回策略说明，成功前不能提前移除问题标记', () => {
  const raw = copyValue(); raw.titles[2].strategy = ''; raw.titles[2].explanationZh = ''
  const previous = generated(raw), field = 'titles.2.metadata'
  assert.ok(hasIssue(previous, field))
  const stillMissing = mergeCopyRepair(previous, generated(raw))
  assert.ok(hasIssue(stillMissing, field))
  const repaired = mergeCopyRepair(previous, generated(copyValue()))
  assert.equal(repaired.titles[2].title, previous.titles[2].title)
  assert.ok(repaired.titles[2].strategy)
  assert.ok(repaired.titles[2].explanationZh)
  assert.equal(hasIssue(repaired, field), false)
})

test('补中文译名时不能把另一英文标题的中文译名贴到原英文上', () => {
  const raw = copyValue(); raw.titles[0].titleZh = ''
  const previous = generated(raw)
  const changed = copyValue(); changed.titles[0].title = 'Blue Scarf Dog Figure'; changed.titles[0].titleZh = '蓝围巾小狗摆件'
  const result = mergeCopyRepair(previous, generated(changed))
  assert.equal(result.titles[0].title, previous.titles[0].title)
  assert.notEqual(result.titles[0].titleZh, '蓝围巾小狗摆件')
  assert.ok(hasIssue(result, 'titleZh.0'))
})

test('补齐失败不会把未采用的新正文错误标记传给原来的合格正文', () => {
  const raw = copyValue(); raw.titles[3].title = '纯中文坏标题'
  const previous = generated(raw)
  const badRepair = copyValue(); badRepair.description = 'Made from cotton. Size: 10 inches.'
  const returned = generated(badRepair)
  assert.ok(hasIssue(returned, 'description'))
  const result = mergeCopyRepair(previous, returned)
  assert.equal(result.description, previous.description)
  assert.equal(hasIssue(result, 'description'), false)
  assert.ok(result.titles[3].title)
})

test('补回一个标题不能与保留的合格标题重复', () => {
  const raw = copyValue(); raw.titles[3].title = '纯中文坏标题'
  const previous = generated(raw), duplicate = previous.titles[0].title
  const changed = copyValue()
  changed.titles[0].title = 'A Different Scarf Cat Figure'
  changed.titles[3].title = duplicate
  const returned = generated(changed)
  assert.equal(returned.titles[3].title, duplicate, '返回自身五个标题并不重复，问题发生在合并阶段')
  const result = mergeCopyRepair(previous, returned)
  assert.equal(result.titles[0].title, duplicate)
  const titles = result.titles.map(row => row.title.toLowerCase()).filter(Boolean)
  assert.equal(new Set(titles).size, titles.length)
  assert.ok(hasIssue(result, 'titles.3'))
})
