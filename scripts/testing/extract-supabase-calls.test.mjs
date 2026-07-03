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

test('extractCallsFromSource: 동적 테이블명은 skip에 기록한다', () => {
  const { usages, skips } = extractCallsFromSource(
    `await supabase.from(tableName).select('*')`,
    'test.ts'
  )
  assert.equal(usages.length, 0)
  assert.equal(skips.length, 1)
  assert.match(skips[0].reason, /동적/)
})
