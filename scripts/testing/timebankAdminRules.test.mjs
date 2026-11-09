import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'
import { judgeCoopCredit } from '../../src/lib/timebank/rules.ts'
import { partitionRestorableSettings } from '../../src/lib/server/settingsRestore.ts'

/**
 * 관리자·이사회 API의 판정 부분(계획 Task 9, 스펙 §6·§7.3·§9.2).
 *
 * - `judgeCoopCredit`(`rules.ts`): 조합 업무 지급 조건. 자원자 아님·철회자·본인·
 *   미확인 체크·판정 1 실패가 **각각 다른 사유**다 — 관리자 화면이 무엇을 고쳐야
 *   하는지 알려 줄 수 있어야 한다. 원장(`creditCoopTask`)이 트랜잭션 안에서 이
 *   함수로 판정한다(파일 DB 테스트는 `queriesTimebankLedger.test.mjs`).
 * - `planTimebankSettingsChange`(`adminRules.ts`): 설정 PUT. 의결 근거 필수,
 *   수치를 바꾸면 이용규칙 판도 올려야 하고, 범위를 벗어난 값은 **조용히 기본값으로
 *   떨어뜨리지 않고 거부한다**.
 * - `partitionRestorableSettings`: 설정 백업 복원이 `timebank_features`를 건너뛴다
 *   (백업 하나로 이사회 의결을 우회하지 못한다).
 */

registerAliasResolveHook(import.meta.url)

const {
  buildAccountsReport,
  parseAdjustInput,
  parseAdminCancelInput,
  parseCoopCreditInput,
  parseCoopTaskInput,
  planTimebankSettingsChange: planWithRealTerms,
  TERMS_MISSING_MESSAGE,
} = await import('../../src/lib/timebank/adminRules.ts')
/** 아래 테스트의 '2027-01'은 가상의 판이다 — 본문 존재 검사는 따로 한 건만 실제 표로 본다. */
const planTimebankSettingsChange = input => planWithRealTerms({ termsExists: () => true, ...input })
const { TIMEBANK_DEFAULTS } = await import('../../src/lib/timebank/settings.ts')

// ── 조합 업무 지급 판정 ─────────────────────────────────────────────────────

const facts = (over = {}) => ({
  actorId: 'admin-1',
  memberId: 'm-1',
  memo: '행사 준비 도움',
  notPaidElsewhere: true,
  minutesValid: true,
  listingFound: true,
  volunteer: 'active',
  eligible: true,
  alreadyCredited: false,
  ...over,
})

test('지급 판정: 조건을 다 채우면 null', () => {
  assert.equal(judgeCoopCredit(facts()), null)
})

test('지급 판정: 자원자 아님·철회자·본인·미확인 체크·판정 1 실패가 각각 다른 사유다', () => {
  const reasons = {
    not_volunteer: judgeCoopCredit(facts({ volunteer: 'none' })),
    volunteer_withdrawn: judgeCoopCredit(facts({ volunteer: 'withdrawn' })),
    self: judgeCoopCredit(facts({ memberId: 'admin-1' })),
    paid_elsewhere_unconfirmed: judgeCoopCredit(facts({ notPaidElsewhere: false })),
    not_participant: judgeCoopCredit(facts({ eligible: false })),
  }
  for (const [expected, actual] of Object.entries(reasons)) assert.equal(actual, expected)
  assert.equal(new Set(Object.values(reasons)).size, 5)
})

test('지급 판정: memo·분량·글·중복', () => {
  assert.equal(judgeCoopCredit(facts({ memo: '   ' })), 'memo_required')
  assert.equal(judgeCoopCredit(facts({ memo: null })), 'memo_required')
  assert.equal(judgeCoopCredit(facts({ minutesValid: false })), 'bad_minutes')
  assert.equal(judgeCoopCredit(facts({ listingFound: false })), 'not_coop_task')
  assert.equal(judgeCoopCredit(facts({ alreadyCredited: true })), 'already_credited')
})

test('지급 판정: 확인 체크는 정확히 true여야 한다(문자열·1은 아니다)', () => {
  for (const v of ['true', 1, undefined, null]) {
    assert.equal(
      judgeCoopCredit(facts({ notPaidElsewhere: v })),
      'paid_elsewhere_unconfirmed',
      String(v)
    )
  }
})

// ── 입력 파서 ───────────────────────────────────────────────────────────────

test('지급 본문: 확인 체크는 true일 때만 true로 넘어가고, 계좌·글 칸은 담지 않는다', () => {
  const ok = parseCoopCreditInput({
    member_id: 'm-1',
    minutes: 60,
    memo: '  행사 준비  ',
    not_paid_elsewhere: true,
    listing_id: 'x',
    to_account: 'coop',
  })
  assert.equal(ok.error, null)
  assert.deepEqual(ok.value, {
    member_id: 'm-1',
    minutes: 60,
    memo: '행사 준비',
    not_paid_elsewhere: true,
  })
  assert.equal(
    parseCoopCreditInput({ member_id: 'm-1', minutes: 60, memo: 'a', not_paid_elsewhere: 'true' })
      .value.not_paid_elsewhere,
    false
  )
  assert.ok(parseCoopCreditInput({ member_id: 'coop', minutes: 60, memo: 'a' }).error)
  assert.ok(parseCoopCreditInput({ member_id: 'm-1', minutes: -30, memo: 'a' }).error)
  assert.ok(parseCoopCreditInput({ member_id: 'm-1', minutes: 60, memo: 'x'.repeat(501) }).error)
})

test('조정 본문: 방향은 credit·debit만, 분쟁은 결정 근거를 함께 넘긴다', () => {
  const ok = parseAdjustInput({
    member_id: 'm-1',
    direction: 'debit',
    minutes: 90,
    memo: '정정',
    dispute: true,
    resolution_ref: '2026-11-20 이사회 3호',
  })
  assert.equal(ok.error, null)
  assert.deepEqual(ok.value, {
    member_id: 'm-1',
    direction: 'debit',
    minutes: 90,
    memo: '정정',
    dispute: { resolution_ref: '2026-11-20 이사회 3호' },
  })
  const plain = parseAdjustInput({ member_id: 'm-1', direction: 'credit', minutes: 30, memo: 'a' })
  assert.equal(plain.value.dispute, null)
  // 분쟁인데 근거가 비면 원장이 resolution_required로 막도록 빈 근거를 넘긴다
  assert.deepEqual(
    parseAdjustInput({
      member_id: 'm-1',
      direction: 'credit',
      minutes: 30,
      memo: 'a',
      dispute: true,
    }).value.dispute,
    { resolution_ref: '' }
  )
  assert.ok(parseAdjustInput({ member_id: 'm-1', direction: 'move', minutes: 30, memo: 'a' }).error)
  assert.ok(parseAdjustInput({ member_id: 'coop', direction: 'credit', minutes: 30 }).error)
})

test('관리자 취소 본문: memo는 글자여야 하고 상한을 넘지 않는다', () => {
  assert.deepEqual(parseAdminCancelInput({ memo: '  분쟁 정리  ' }), {
    error: null,
    value: { memo: '분쟁 정리' },
  })
  assert.ok(parseAdminCancelInput({ memo: 3 }).error)
  assert.ok(parseAdminCancelInput({ memo: 'x'.repeat(501) }).error)
})

test('조합 업무 글: 글 칸을 검사하고 kind는 항상 coop_task, 날짜는 YYYY-MM-DD', () => {
  const ok = parseCoopTaskInput({
    category: 'admin_help',
    title: ' 정기공연 안내 데스크 ',
    description: '자원 참여입니다.',
    estimated_minutes: 120,
    task_date: '2026-12-05',
    kind: 'offer',
  })
  assert.equal(ok.error, null)
  assert.deepEqual(ok.value, {
    kind: 'coop_task',
    category: 'admin_help',
    title: '정기공연 안내 데스크',
    description: '자원 참여입니다.',
    estimated_minutes: 120,
    task_date: '2026-12-05',
  })
  assert.equal(
    parseCoopTaskInput({ category: 'etc', title: 't', description: 'd' }).value.task_date,
    null
  )
  assert.ok(parseCoopTaskInput({ category: 'etc', title: '', description: 'd' }).error)
  assert.ok(
    parseCoopTaskInput({ category: 'etc', title: 't', description: 'd', task_date: '2026-13-01' })
      .error
  )
})

// ── 설정 PUT ────────────────────────────────────────────────────────────────

const REF = '2026-11-20 이사회 3호 안건'

test('설정 PUT: 사유 없음·짧은 사유 → 400', () => {
  for (const ref of [undefined, '', '    ', 'abc', 'x'.repeat(201), 12345]) {
    const plan = planTimebankSettingsChange({
      current: TIMEBANK_DEFAULTS,
      body: { settings: { enabled: true }, resolution_ref: ref },
    })
    assert.equal(plan.ok, false, String(ref))
    assert.equal(plan.status, 400)
    assert.match(plan.message, /의결 근거/)
  }
})

test('설정 PUT: 수치 변경 + 판 그대로 → 400', () => {
  const plan = planTimebankSettingsChange({
    current: TIMEBANK_DEFAULTS,
    body: { settings: { signup_grant_minutes: 60 }, resolution_ref: REF },
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.status, 400)
  assert.equal(plan.message, '수치를 바꾸면 이용규칙 판도 올려야 합니다.')
})

test('설정 PUT: 수치 변경 + 새 판 → 허용, 바뀐 칸을 보고한다', () => {
  const plan = planTimebankSettingsChange({
    current: TIMEBANK_DEFAULTS,
    body: { settings: { signup_grant_minutes: 60, terms_version: '2027-01' }, resolution_ref: REF },
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.next.signup_grant_minutes, 60)
  assert.equal(plan.next.terms_version, '2027-01')
  assert.deepEqual([...plan.changed].sort(), ['signup_grant_minutes', 'terms_version'])
  assert.equal(plan.resolution_ref, REF)
})

test('설정 PUT: 스위치만 변경 + 판 그대로 → 허용, 나머지 값은 현재 값 그대로', () => {
  const current = { ...TIMEBANK_DEFAULTS, soft_max_minutes: 1500 }
  const plan = planTimebankSettingsChange({
    current,
    body: { settings: { enabled: true, coop_tasks_enabled: true }, resolution_ref: `  ${REF}  ` },
  })
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.next, { ...current, enabled: true, coop_tasks_enabled: true })
  assert.equal(plan.resolution_ref, REF)
})

test('설정 PUT: 범위를 벗어난 값은 기본값으로 떨어뜨리지 않고 거부한다', () => {
  for (const settings of [
    { min_balance_minutes: -1230, terms_version: '2027-01' },
    { soft_max_minutes: 45, terms_version: '2027-01' },
    { signup_grant_minutes: '60', terms_version: '2027-01' },
    { enabled: 'true' },
    { terms_version: '' },
  ]) {
    const plan = planTimebankSettingsChange({
      current: TIMEBANK_DEFAULTS,
      body: { settings, resolution_ref: REF },
    })
    assert.equal(plan.ok, false, JSON.stringify(settings))
    assert.equal(plan.status, 400)
  }
})

test('설정 PUT: 모르는 칸·빈 설정·바뀐 것 없음 → 400', () => {
  for (const settings of [{ enabled: true, extra: 1 }, {}, null, [], { enabled: false }]) {
    const plan = planTimebankSettingsChange({
      current: TIMEBANK_DEFAULTS,
      body: { settings, resolution_ref: REF },
    })
    assert.equal(plan.ok, false, JSON.stringify(settings))
    assert.equal(plan.status, 400)
  }
})

test('설정 PUT: 판만 올리는 것은 허용한다(재동의 요청)', () => {
  const plan = planTimebankSettingsChange({
    current: TIMEBANK_DEFAULTS,
    body: { settings: { terms_version: '2027-01' }, resolution_ref: REF },
  })
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.changed, ['terms_version'])
})

test('설정 PUT: 본문이 배포되지 않은 판으로 바꾸면 400(전원 잠금 방지), 있는 판은 허용', () => {
  const missing = planWithRealTerms({
    current: TIMEBANK_DEFAULTS,
    body: { settings: { terms_version: '2027-01' }, resolution_ref: REF },
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.status, 400)
  assert.equal(missing.message, TERMS_MISSING_MESSAGE)

  const back = planWithRealTerms({
    current: { ...TIMEBANK_DEFAULTS, terms_version: '2099-01' },
    body: { settings: { terms_version: '2026-11' }, resolution_ref: REF },
  })
  assert.equal(back.ok, true)
})

// ── 잔액표 ──────────────────────────────────────────────────────────────────

test('잔액표: soft_max 초과·low_balance_flag 이하에 플래그, coop은 발행잔액으로 뺀다', () => {
  const names = new Map([
    ['rich', { display_name: '부자' }],
    ['poor', { display_name: '가난' }],
    ['edge', { display_name: '경계' }],
  ])
  const report = buildAccountsReport({
    balances: [
      { account: 'coop', balance_minutes: -1830 },
      { account: 'rich', balance_minutes: 1830 },
      { account: 'poor', balance_minutes: -480 },
      { account: 'edge', balance_minutes: 1800 },
      { account: 'ghost', balance_minutes: 0 },
    ],
    names,
    settings: TIMEBANK_DEFAULTS,
  })
  assert.equal(report.coop_outstanding_minutes, 1830)
  const by = Object.fromEntries(report.accounts.map(a => [a.member_id, a]))
  assert.equal(by.coop, undefined)
  assert.deepEqual(by.rich.flags, ['over_soft_max'])
  assert.deepEqual(by.poor.flags, ['low_balance'])
  assert.deepEqual(by.edge.flags, [])
  assert.equal(by.rich.display_name, '부자')
  assert.equal(by.ghost.display_name, null)
  assert.equal(report.flagged_count, 2)
})

// ── 백업 복원 ───────────────────────────────────────────────────────────────

test('백업 복원: timebank_features는 건너뛰고 건너뛴 키를 보고한다', () => {
  const { restorable, skipped } = partitionRestorableSettings([
    { category: 'site', setting_key: 'site_title', setting_value: { v: 1 } },
    { category: 'features', setting_key: 'timebank_features', setting_value: { enabled: true } },
    // 카테고리를 바꿔 끼워도 키로 막는다
    { category: 'site', setting_key: 'timebank_features', setting_value: { enabled: true } },
    { category: 'features', setting_key: 'funding_features', setting_value: { enabled: true } },
  ])
  assert.deepEqual(
    restorable.map(s => `${s.category}.${s.setting_key}`),
    ['site.site_title', 'features.funding_features']
  )
  assert.deepEqual(skipped, ['features.timebank_features', 'site.timebank_features'])
})

test('백업 복원 라우트가 partitionRestorableSettings를 거쳐 쓰고 skipped를 응답에 싣는다', () => {
  const src = readFileSync(
    new URL('../../src/app/api/admin/settings/backup/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(src, /partitionRestorableSettings\(/)
  assert.match(src, /skipped/)
  // 쓰기 루프는 걸러진 목록만 돈다
  assert.doesNotMatch(src, /for \(const setting of backupSettings\)/)
})
