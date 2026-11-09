import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseDecisionInput,
  parseListingInput,
  parseListingQuery,
  parseListingStatus,
  parseProfileInput,
} from '../../src/lib/timebank/validate.ts'

/**
 * 타임뱅크 게시판·프로필 입력 파서(`src/lib/timebank/validate.ts`, 스펙 §3·§4·§7.1).
 * 메시지는 화면에 그대로 뜨므로 실패 쪽은 `error`가 문자열인지까지 본다.
 */

const base = (over = {}) => ({
  kind: 'offer',
  category: 'lesson',
  title: '기타 레슨 해 드려요',
  description: '초급 코드 잡는 법부터',
  estimated_minutes: 60,
  ...over,
})

test('정상 입력은 다듬어진 값으로 돌아온다', () => {
  const r = parseListingInput(base({ title: '  기타 레슨  ' }))
  assert.equal(r.error, null)
  assert.deepEqual(r.value, {
    kind: 'offer',
    category: 'lesson',
    title: '기타 레슨',
    description: '초급 코드 잡는 법부터',
    estimated_minutes: 60,
  })
})

test('kind는 offer·request만 받는다 — coop_task는 관리자 화면 안내', () => {
  assert.equal(parseListingInput(base({ kind: 'request' })).error, null)
  const coop = parseListingInput(base({ kind: 'coop_task' }))
  assert.equal(coop.value, null)
  assert.equal(coop.error, '조합 업무는 관리자 화면에서 올립니다.')
  for (const kind of [undefined, '', 'exchange', 'OFFER', 1]) {
    const r = parseListingInput(base({ kind }))
    assert.equal(r.value, null, `kind=${String(kind)}`)
    assert.equal(typeof r.error, 'string')
  }
})

test('제목은 1~80자', () => {
  assert.equal(parseListingInput(base({ title: '가' })).error, null)
  assert.equal(parseListingInput(base({ title: 'a'.repeat(80) })).error, null)
  assert.equal(parseListingInput(base({ title: '   ' })).value, null)
  assert.equal(parseListingInput(base({ title: 'a'.repeat(81) })).value, null)
  assert.equal(parseListingInput(base({ title: 3 })).value, null)
})

test('설명은 1~3000자', () => {
  assert.equal(parseListingInput(base({ description: '가' })).error, null)
  assert.equal(parseListingInput(base({ description: 'a'.repeat(3000) })).error, null)
  assert.equal(parseListingInput(base({ description: '' })).value, null)
  assert.equal(parseListingInput(base({ description: 'a'.repeat(3001) })).value, null)
})

test('estimated_minutes는 30분 배수 또는 null(미정)', () => {
  for (const v of [null, undefined, '']) {
    const r = parseListingInput(base({ estimated_minutes: v }))
    assert.equal(r.error, null)
    assert.equal(r.value.estimated_minutes, null)
  }
  assert.equal(parseListingInput(base({ estimated_minutes: 30 })).value.estimated_minutes, 30)
  assert.equal(parseListingInput(base({ estimated_minutes: '90' })).value.estimated_minutes, 90)
  assert.equal(parseListingInput(base({ estimated_minutes: 480 })).value.estimated_minutes, 480)
  for (const v of [0, 45, -30, 1.5, 510, 'abc', true]) {
    assert.equal(parseListingInput(base({ estimated_minutes: v })).value, null, `v=${String(v)}`)
  }
})

test('분류 목록 밖은 거부', () => {
  assert.equal(parseListingInput(base({ category: 'etc' })).error, null)
  for (const category of [undefined, '', 'music', 'LESSON']) {
    assert.equal(parseListingInput(base({ category })).value, null)
  }
})

test('본문에 없는 칸(author_id·status·is_deleted)은 결과에 들어오지 않는다', () => {
  const r = parseListingInput(base({ author_id: 'x', status: 'closed', is_deleted: true }))
  assert.deepEqual(Object.keys(r.value).sort(), [
    'category',
    'description',
    'estimated_minutes',
    'kind',
    'title',
  ])
})

test('parseListingStatus: open·closed만', () => {
  assert.equal(parseListingStatus('open'), 'open')
  assert.equal(parseListingStatus('closed'), 'closed')
  assert.equal(parseListingStatus('done'), null)
  assert.equal(parseListingStatus(undefined), null)
})

test('parseListingQuery: 모르는 값은 버리고 page는 1 이상', () => {
  const q = parseListingQuery(
    new URLSearchParams('kind=coop_task&category=moving&status=open&page=3&mine=1')
  )
  assert.deepEqual(q, {
    kind: 'coop_task',
    category: 'moving',
    status: 'open',
    page: 3,
    mine: true,
  })
  const bad = parseListingQuery(new URLSearchParams('kind=x&category=y&status=z&page=-1'))
  assert.deepEqual(bad, {
    kind: undefined,
    category: undefined,
    status: undefined,
    page: 1,
    mine: false,
  })
})

test('parseProfileInput: 준 칸만, 하나도 없으면 에러', () => {
  const r = parseProfileInput({
    offers: ' 레슨 ',
    needs: '',
    categories: ['lesson', 'lesson', 'daily'],
    visible: true,
    member_id: 'x',
  })
  assert.equal(r.error, null)
  assert.deepEqual(r.value, {
    offers: '레슨',
    needs: '',
    categories: ['lesson', 'daily'],
    visible: true,
  })
  assert.deepEqual(parseProfileInput({ visible: false }).value, { visible: false })
  assert.equal(parseProfileInput({}).value, null)
  assert.equal(parseProfileInput({ terms_version: '2026-11' }).value, null)
})

test('parseProfileInput: 길이·분류·타입 오류', () => {
  assert.equal(parseProfileInput({ offers: 'a'.repeat(1001) }).value, null)
  assert.equal(parseProfileInput({ needs: 5 }).value, null)
  assert.equal(parseProfileInput({ categories: ['music'] }).value, null)
  assert.equal(parseProfileInput({ categories: 'lesson' }).value, null)
  assert.equal(parseProfileInput({ visible: 'true' }).value, null)
})

test('parseDecisionInput: 본문 없음·빈 사유는 사유 없음, 글자·상한을 본다', () => {
  assert.deepEqual(parseDecisionInput(null).value, { memo: null })
  assert.deepEqual(parseDecisionInput(undefined).value, { memo: null })
  assert.deepEqual(parseDecisionInput({}).value, { memo: null })
  assert.deepEqual(parseDecisionInput({ memo: '   ' }).value, { memo: null })
  assert.deepEqual(parseDecisionInput({ memo: ' 사실과 달라요 ' }).value, { memo: '사실과 달라요' })
  // 다른 칸은 버린다.
  assert.deepEqual(parseDecisionInput({ memo: 'x', status: 'confirmed' }).value, { memo: 'x' })
  assert.equal(parseDecisionInput({ memo: 5 }).value, null)
  assert.equal(parseDecisionInput({ memo: 'a'.repeat(501) }).value, null)
  assert.equal(parseDecisionInput([]).value, null)
  assert.equal(typeof parseDecisionInput('x').error, 'string')
})
