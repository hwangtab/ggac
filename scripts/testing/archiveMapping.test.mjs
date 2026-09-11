import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

const { ASSEMBLY_DOCS, BOARD_MINUTES } = await import('../import/mapping.mjs')

test('총회 세 건, 이사회 아홉 건이다', () => {
  assert.equal(ASSEMBLY_DOCS.length, 3)
  assert.equal(BOARD_MINUTES.length, 9)
})

test('열람 범위는 허용값만 쓴다', () => {
  for (const d of ASSEMBLY_DOCS) {
    assert.ok(['board', 'members'].includes(d.visibility), `${d.file}: ${d.visibility}`)
  }
})

test('회의 날짜가 겹치지 않는다 (한 회의에 회의록은 하나다)', () => {
  const dates = BOARD_MINUTES.map(m => m.date)
  assert.equal(new Set(dates).size, dates.length)
})

test('원본이 있는 컴퓨터라면 경로가 전부 실재한다', { skip: !existsSync('docs/이사회') }, () => {
  for (const entry of [...ASSEMBLY_DOCS, ...BOARD_MINUTES]) {
    assert.ok(existsSync(entry.file), `없는 경로: ${entry.file}`)
  }
})
