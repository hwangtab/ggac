import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findMatchingParen,
  scanChain,
  parseSelectColumns,
  extractCallsFromSource,
} from './extract-supabase-calls.mjs'

test('findMatchingParen: 문자열 안의 괄호를 무시하고 짝을 찾는다', () => {
  const src = `fn("a)b", (1))`
  assert.equal(findMatchingParen(src, 2), src.length - 1)
})

test('scanChain: 메서드 체인을 인자 텍스트와 함께 추출한다', () => {
  const src = `.from('posts').select('id, title').eq('status', 'published')`
  const { calls } = scanChain(src, 0)
  assert.deepEqual(
    calls.map(c => c.method),
    ['from', 'select', 'eq']
  )
  assert.equal(calls[1].args, `'id, title'`)
})

test('parseSelectColumns: 별칭·캐스트·중첩 관계를 처리한다', () => {
  const parsed = parseSelectColumns(`'id, alias:title, count::int, author:users(id, name), *'`)
  assert.deepEqual(parsed.columns, ['id', 'title', 'count'])
  assert.deepEqual(parsed.relations, [{ name: 'users', columns: ['id', 'name'] }])
  assert.equal(parsed.dynamic, false)
})

test('parseSelectColumns: 템플릿 보간은 dynamic으로 표시한다', () => {
  const parsed = parseSelectColumns('`id, ${cols}`')
  assert.equal(parsed.dynamic, true)
})

test('extractCallsFromSource: from 체인에서 테이블·컬럼 사용을 수집한다', () => {
  const src = `
    const { data } = await supabase
      .from('posts')
      .select('id, title')
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
    await supabase.from('comments').insert({ post_id: id, content: text })
    await supabase.rpc('increment_view_count', { post_id: id })
  `
  const { usages, skips } = extractCallsFromSource(src, 'test.ts')
  const posts = usages.find(u => u.table === 'posts')
  assert.deepEqual(posts.columns.sort(), ['author_id', 'created_at', 'id', 'title'])
  const comments = usages.find(u => u.table === 'comments')
  assert.deepEqual(comments.columns.sort(), ['content', 'post_id'])
  assert.ok(usages.some(u => u.rpc === 'increment_view_count'))
  assert.equal(skips.length, 0)
})

test('extractCallsFromSource: JS 내장 생성자의 from은 무시한다', () => {
  const src = `
    const arr = Array.from(items)
    const buf = Buffer.from('hello')
    await supabase.from('posts').select('id')
  `
  const { usages, skips } = extractCallsFromSource(src, 'test.ts')
  // Array.from(items) → skip 노이즈 금지, Buffer.from('hello') → 유령 테이블 금지
  assert.equal(skips.length, 0)
  assert.equal(usages.length, 1)
  assert.equal(usages[0].table, 'posts')
})

test('extractCallsFromSource: write 옵션 인자의 키는 컬럼으로 세지 않는다', () => {
  const src = `await supabase.from('posts').upsert({ id: 1, meta: { a: 1 } }, { onConflict: 'id' })`
  const { usages, skips } = extractCallsFromSource(src, 'test.ts')
  const posts = usages.find(u => u.table === 'posts')
  assert.deepEqual(posts.columns.sort(), ['id', 'meta'])
  assert.equal(skips.length, 0)
})

test('extractCallsFromSource: 배열 값 뒤의 최상위 키가 탈락하지 않는다', () => {
  const src = `await supabase.from('posts').insert({ tags: [1, 2], title: 'x' })`
  const { usages, skips } = extractCallsFromSource(src, 'test.ts')
  const posts = usages.find(u => u.table === 'posts')
  assert.deepEqual(posts.columns.sort(), ['tags', 'title'])
  assert.equal(skips.length, 0)
})

test('extractCallsFromSource: 배열 페이로드 객체의 키는 배열 값 뒤에도 수집한다', () => {
  const src = `await supabase.from('posts').insert([{ a: [1], b: 2 }])`
  const { usages } = extractCallsFromSource(src, 'test.ts')
  const posts = usages.find(u => u.table === 'posts')
  assert.deepEqual(posts.columns.sort(), ['a', 'b'])
})

test('extractCallsFromSource: shorthand 프로퍼티도 컬럼 키로 인정한다', () => {
  const src = `await supabase.from('posts').insert({ title, content, category: 'news' })`
  const { usages, skips } = extractCallsFromSource(src, 'test.ts')
  const posts = usages.find(u => u.table === 'posts')
  assert.deepEqual(posts.columns.sort(), ['category', 'content', 'title'])
  assert.equal(skips.length, 0)
})

test('extractCallsFromSource: update 페이로드의 shorthand도 수집한다', () => {
  const src = `await supabase.from('posts').update({ id: 1, name })`
  const { usages, skips } = extractCallsFromSource(src, 'test.ts')
  const posts = usages.find(u => u.table === 'posts')
  assert.deepEqual(posts.columns.sort(), ['id', 'name'])
  assert.equal(skips.length, 0)
})

test('extractCallsFromSource: spread 페이로드는 키 수집과 함께 skip을 기록한다', () => {
  const src = `await supabase.from('posts').insert({ ...base, title })`
  const { usages, skips } = extractCallsFromSource(src, 'test.ts')
  const posts = usages.find(u => u.table === 'posts')
  assert.deepEqual(posts.columns, ['title'])
  assert.equal(skips.length, 1)
  assert.match(skips[0].reason, /spread/)
})

test('extractCallsFromSource: 동적 테이블명은 skip에 기록한다', () => {
  const { usages, skips } = extractCallsFromSource(
    `await supabase.from(tableName).select('*')`,
    'test.ts'
  )
  assert.equal(usages.length, 0)
  assert.equal(skips.length, 1)
  assert.match(skips[0].reason, /동적/)
})
