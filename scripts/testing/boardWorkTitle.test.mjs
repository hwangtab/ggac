import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 업무툴 직함(03 §10 R4) — 업무 화면에만 보이는 직함(`work_member_prefs.work_title`)과 이사회 직함으로 떨어지는 규칙,
 * 설정 폼의 입력 검증(0~50자, 앞뒤 공백 제거, 빈 값 → null). DB 왕복은 queriesBoardWork.test.mjs가 본다.
 */
const { resolveWorkTitle } = await import('../../src/work/lib/staff/work-title.ts')
const { staffProfileSchema, titleSchema } = await import(
  '../../src/work/lib/auth/profile-schema.ts'
)

test('표시 직함 = 업무툴 직함 → 이사회 직함 → 없음', () => {
  assert.equal(resolveWorkTitle('총무 담당', '이사'), '총무 담당')
  assert.equal(resolveWorkTitle(null, '이사'), '이사')
  assert.equal(resolveWorkTitle(undefined, '감사'), '감사')
  // 공백뿐인 업무툴 직함은 없는 것으로 본다(이사회 직함으로 떨어진다)
  assert.equal(resolveWorkTitle('   ', '이사'), '이사')
  assert.equal(resolveWorkTitle('  편집 담당 ', null), '편집 담당')
  assert.equal(resolveWorkTitle(null, null), null)
  assert.equal(resolveWorkTitle('', '  '), null)
})

test('직함 입력: 앞뒤 공백을 자르고, 비면 null, 50자까지', () => {
  assert.equal(titleSchema.parse('  총무 담당  '), '총무 담당')
  assert.equal(titleSchema.parse(''), null)
  assert.equal(titleSchema.parse('    '), null)
  assert.equal(titleSchema.parse('가'.repeat(50)), '가'.repeat(50))
  const over = titleSchema.safeParse('가'.repeat(51))
  assert.equal(over.success, false)
  assert.match(over.error.issues[0].message, /50자/)

  const ok = staffProfileSchema.safeParse({ displayName: '이사1', title: '' })
  assert.equal(ok.success, true)
  assert.equal(ok.data.title, null)
  assert.equal(staffProfileSchema.safeParse({ displayName: '이사1', title: 7 }).success, false)
})
