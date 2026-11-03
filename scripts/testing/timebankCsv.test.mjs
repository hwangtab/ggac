import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  TIMEBANK_CSV_HEADERS,
  buildTimebankCsv,
  formatKstDateTime,
  boardPilotStats,
  publicStats,
  summarizeMe,
  timebankCsvDisposition,
  toMyTransferView,
} from '../../src/lib/timebank/format.ts'

/**
 * 내 타임 내역의 화면용 모양과 CSV(계획 Task 8, 스펙 §8·§12·§15 M).
 *
 * - CSV는 `csvCell`(수식 차단) + BOM + CRLF. 분은 **양수만**이고 방향은 따로 칸.
 * - 일시는 KST.
 * - 공개 집계는 사람 수 구간이 3명 미만이면 null.
 */

const ME = 'me-1'
const OTHER = 'other-1'

const row = (over = {}) => ({
  id: 't1',
  from_account: ME,
  to_account: OTHER,
  minutes: 90,
  kind: 'exchange',
  status: 'confirmed',
  created_by: ME,
  counterparty_id: OTHER,
  decided_by: OTHER,
  decided_at: '2026-10-31T15:30:00.000Z',
  ref_type: null,
  ref_id: null,
  reverses_id: null,
  category: 'lesson',
  memo: '기타 레슨',
  from_name: '나',
  to_name: '상대',
  approved_by: null,
  created_at: '2026-10-31T10:00:00.000Z',
  updated_at: '2026-10-31T15:30:00.000Z',
  ...over,
})

function parseCsv(text) {
  assert.ok(text.startsWith('﻿'), 'BOM으로 시작한다')
  assert.ok(text.endsWith('\r\n'))
  return text
    .slice(1)
    .split('\r\n')
    .filter(Boolean)
    .map(line => line.split('","').map(c => c.replace(/^"|"$/g, '')))
}

// ── KST ─────────────────────────────────────────────────────────────────────

test('formatKstDateTime: UTC → KST 분 단위', () => {
  assert.equal(formatKstDateTime('2026-10-31T15:30:00.000Z'), '2026-11-01 00:30')
  assert.equal(formatKstDateTime('2026-01-01T00:05:00Z'), '2026-01-01 09:05')
  assert.equal(formatKstDateTime(null), '')
  assert.equal(formatKstDateTime('nonsense'), '')
})

// ── 화면용 행 ─────────────────────────────────────────────────────────────────

test('toMyTransferView: 내가 낸 행은 out, 상대 이름은 상대 쪽', () => {
  const v = toMyTransferView(row(), ME)
  assert.equal(v.direction, 'out')
  assert.equal(v.minutes, 90)
  assert.deepEqual(v.counterparty, { id: OTHER, name: '상대' })
  assert.equal(v.happened_at, '2026-10-31T15:30:00.000Z')
})

test('toMyTransferView: 받은 행은 in, 조합 계좌는 이름 "조합"·id null', () => {
  const v = toMyTransferView(
    row({
      from_account: 'coop',
      to_account: ME,
      kind: 'signup_grant',
      from_name: null,
      to_name: '나',
    }),
    ME
  )
  assert.equal(v.direction, 'in')
  assert.deepEqual(v.counterparty, { id: null, name: '조합' })
})

test('toMyTransferView: 할 수 있는 동작은 내 역할로만', () => {
  const pendingForMe = toMyTransferView(
    row({ status: 'pending', created_by: OTHER, counterparty_id: ME, decided_at: null }),
    ME
  )
  assert.deepEqual(
    [pendingForMe.can_confirm, pendingForMe.can_reject, pendingForMe.can_cancel],
    [true, true, false]
  )
  const mine = toMyTransferView(
    row({ status: 'pending', created_by: ME, counterparty_id: OTHER, decided_at: null }),
    ME
  )
  assert.deepEqual([mine.can_confirm, mine.can_reject, mine.can_cancel], [false, false, true])
  const done = toMyTransferView(row(), ME)
  assert.deepEqual([done.can_confirm, done.can_reject, done.can_cancel], [false, false, false])
  assert.equal(done.can_reverse, true, '확정 exchange는 되돌리기 요청 가능')
  assert.equal(toMyTransferView(row({ kind: 'coop_task' }), ME).can_reverse, false)
  assert.equal(
    toMyTransferView(row({ reversal_open: true }), ME).can_reverse,
    false,
    '열린 되돌림이 이미 있으면 다시 제안하지 않는다'
  )
})

test('toMyTransferView: 오래된 pending은 stale', () => {
  const now = Date.parse('2026-11-10T00:00:00Z')
  const old = toMyTransferView(
    row({ status: 'pending', decided_at: null, created_at: '2026-11-01T00:00:00Z' }),
    ME,
    now
  )
  assert.equal(old.stale, true)
  const fresh = toMyTransferView(
    row({ status: 'pending', decided_at: null, created_at: '2026-11-08T00:00:00Z' }),
    ME,
    now
  )
  assert.equal(fresh.stale, false)
  assert.equal(toMyTransferView(row(), ME, now).stale, false, '확정 행은 stale이 아니다')
})

test('toMyTransferView: 관리자 승인자 id 같은 내부 칸은 싣지 않는다', () => {
  const v = toMyTransferView(row({ approved_by: 'admin-9', decided_by: 'admin-9' }), ME)
  assert.equal('approved_by' in v, false)
  assert.equal('decided_by' in v, false)
})

// ── CSV ─────────────────────────────────────────────────────────────────────

test('CSV: 머리줄과 열 순서', () => {
  assert.deepEqual(
    [...TIMEBANK_CSV_HEADERS],
    ['일시(KST)', '방향', '분', '종류', '상대', '분류', '메모', '상태']
  )
  const [header, line] = parseCsv(buildTimebankCsv([row()], ME))
  assert.deepEqual(header, [...TIMEBANK_CSV_HEADERS])
  assert.deepEqual(line, [
    '2026-11-01 00:30',
    '줌',
    '90',
    '교환',
    '상대',
    '레슨',
    '기타 레슨',
    '확정',
  ])
})

test('CSV: 메모 =SUM(A1)은 수식이 되지 않게 이스케이프된다', () => {
  const csv = buildTimebankCsv([row({ memo: '=SUM(A1)' })], ME)
  assert.ok(csv.includes(`"'=SUM(A1)"`))
  assert.ok(!csv.includes(`"=SUM(A1)"`))
})

test('CSV: 상대 이름의 수식·따옴표도 막는다', () => {
  const csv = buildTimebankCsv([row({ to_name: '@cmd "x"' })], ME)
  assert.ok(csv.includes(`"'@cmd ""x"""`))
})

test('CSV: 분 칸에 음수가 없고 방향 칸이 받음/줌을 가른다', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'b', from_account: OTHER, to_account: ME, from_name: '상대', to_name: '나' }),
    row({ id: 'c', from_account: ME, to_account: 'coop', kind: 'redeem', to_name: null }),
  ]
  const lines = parseCsv(buildTimebankCsv(rows, ME)).slice(1)
  assert.equal(lines.length, 3)
  for (const l of lines) {
    assert.match(l[2], /^[1-9]\d*$/, `분 칸이 양의 정수가 아니다: ${l[2]}`)
  }
  assert.deepEqual(
    lines.map(l => l[1]),
    ['줌', '받음', '줌']
  )
  assert.equal(lines[2][4], '조합')
})

test('CSV: 빈 내역도 머리줄은 있다', () => {
  const lines = parseCsv(buildTimebankCsv([], ME))
  assert.equal(lines.length, 1)
})

test('CSV 파일 이름: timebank-YYYY-MM.csv', () => {
  assert.equal(timebankCsvDisposition('2026-11'), 'attachment; filename="timebank-2026-11.csv"')
})

// ── 내 요약 ───────────────────────────────────────────────────────────────────

const SETTINGS = {
  enabled: true,
  coop_tasks_enabled: false,
  terms_version: '2026-11',
  min_balance_minutes: -600,
  coop_task_monthly_cap_minutes: 480,
  redeem_monthly_cap_minutes: 480,
}

test('summarizeMe: 하한까지 남은 분·상한·동의 상태', () => {
  const s = summarizeMe({
    settings: SETTINGS,
    month: '2026-11',
    balance: -120,
    serviceUsed: 0,
    coopTaskReceived: 60,
    pending: { to_confirm: 2, awaiting_other: 1 },
    profile: { terms_version: '2026-10', agreed_at: '2026-10-02T00:00:00.000Z' },
  })
  assert.equal(s.balance_minutes, -120)
  assert.equal(s.floor_minutes, -600)
  assert.equal(s.room_to_floor_minutes, 480)
  assert.deepEqual(s.service, { used_minutes: 0, cap_minutes: 480 })
  assert.deepEqual(s.coop_task, { received_minutes: 60, cap_minutes: 480 })
  assert.deepEqual(s.pending, { to_confirm: 2, awaiting_other: 1 })
  assert.deepEqual(s.terms, {
    current_version: '2026-11',
    agreed_version: '2026-10',
    agreed_at: '2026-10-02T00:00:00.000Z',
    needs_agreement: true,
  })
  assert.equal(s.enabled, true)
})

test('summarizeMe: 하한 아래면 남은 분은 0, 미동의면 needs_agreement', () => {
  const s = summarizeMe({
    settings: SETTINGS,
    month: '2026-11',
    balance: -700,
    serviceUsed: 0,
    coopTaskReceived: 0,
    pending: { to_confirm: 0, awaiting_other: 0 },
    profile: null,
  })
  assert.equal(s.room_to_floor_minutes, 0)
  assert.equal(s.terms.agreed_version, null)
  assert.equal(s.terms.needs_agreement, true)
})

// ── 공개 집계 ─────────────────────────────────────────────────────────────────

const stats = (over = {}) => ({
  month: '2026-11',
  exchange_count: 4,
  exchange_minutes: 240,
  participants: 5,
  bidirectional_participants: 3,
  rejected_count: 1,
  canceled_count: 0,
  stale_pending_count: 0,
  coop_task_minutes: 0,
  coop_task_ratio: 0,
  redeem_minutes: 0,
  redeem_ratio: null,
  market_count: 0,
  over_soft_max_members: null,
  low_balance_members: 4,
  ...over,
})

/** 공개 집계 테스트의 기준 시각 — 2026-12(KST). `stats()`의 2026-11은 끝난 달이다. */
const NOW = new Date('2026-12-10T00:00:00.000Z')

test('publicStats: 사람 수 구간이 1~2명이면 null로 다시 가린다', () => {
  for (const n of [1, 2]) {
    const s = publicStats(
      stats({
        participants: n,
        bidirectional_participants: n,
        over_soft_max_members: n,
        low_balance_members: n,
      }),
      NOW
    )
    assert.equal(s.participants, null)
    assert.equal(s.bidirectional_participants, null)
    assert.equal(s.over_soft_max_members, null)
    assert.equal(s.low_balance_members, null)
  }
  const s = publicStats(stats(), NOW)
  assert.equal(s.participants, 5)
  assert.equal(s.bidirectional_participants, 3)
  assert.equal(s.low_balance_members, 4)
  assert.equal(s.over_soft_max_members, null)
})

test('publicStats: 정해진 칸만 내보낸다(개인 식별자 없음)', () => {
  const s = publicStats(stats({ member_ids: ['a', 'b'], top_member: 'a' }), NOW)
  assert.equal('member_ids' in s, false)
  assert.equal('top_member' in s, false)
  assert.equal(s.min_bucket, 3)
})

test('publicStats: 이번 달(KST, 끝나지 않은 달)은 교환 건수·분을 숨기고 "집계 중"', () => {
  // 2026-11-30T15:30Z는 KST로 12월 1일 — 11월은 끝났고 12월이 진행 중이다
  const boundary = new Date('2026-11-30T15:30:00.000Z')
  const current = publicStats(stats({ month: '2026-12', exchange_count: 40 }), boundary)
  assert.equal(current.exchange_count, null)
  assert.equal(current.exchange_minutes, null)
  assert.equal(current.month_complete, false)
  assert.equal(current.exchange_note, '집계 중')

  const done = publicStats(stats({ month: '2026-11', exchange_count: 40 }), boundary)
  assert.equal(done.exchange_count, 40)
  assert.equal(done.exchange_minutes, 240)
  assert.equal(done.month_complete, true)
  assert.equal(done.exchange_note, null)

  // 앞으로 올 달도 끝난 달이 아니다
  assert.equal(publicStats(stats({ month: '2027-01' }), boundary).exchange_count, null)
})

test('publicStats: 끝난 달이어도 3건 미만 건수는 null(교환 분도 함께 가린다)', () => {
  const s = publicStats(
    stats({
      exchange_count: 2,
      rejected_count: 1,
      canceled_count: 2,
      stale_pending_count: 1,
      market_count: 2,
    }),
    NOW
  )
  assert.equal(s.exchange_count, null)
  assert.equal(s.exchange_minutes, null, '건수를 가렸으면 분도 한두 사람의 거래를 드러낸다')
  assert.equal(s.rejected_count, null)
  assert.equal(s.canceled_count, null)
  assert.equal(s.stale_pending_count, null)
  assert.equal(s.market_count, null)
  assert.equal(s.exchange_note, null, '집계 중이 아니라 적어서 가린 것')

  const zero = publicStats(stats({ rejected_count: 0, exchange_count: 3 }), NOW)
  assert.equal(zero.rejected_count, null, '0도 3 미만이다')
  assert.equal(zero.exchange_count, 3)
})

test('boardPilotStats: 이사회 보고는 이번 달 교환 건수·분과 작은 건수를 그대로 본다', () => {
  const s = boardPilotStats(
    stats({ month: '2026-12', exchange_count: 2, rejected_count: 1, participants: 2 })
  )
  assert.equal(s.exchange_count, 2)
  assert.equal(s.exchange_minutes, 240)
  assert.equal(s.rejected_count, 1)
  assert.equal(s.participants, null, '사람 수 구간 가림은 예전 그대로')
})

test('공개 집계 라우트는 사용자 키 레이트리밋을 걸고, 이사회 보고는 boardPilotStats를 쓴다', () => {
  const read = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
  const route = read('src/app/api/timebank/stats/route.ts')
  assert.match(route, /timebankRateLimit\('stats', user\.id\)/)
  assert.match(route, /applyRouteRateLimit/)
  const auth = read('src/lib/server/timebankAuth.ts')
  assert.match(auth, /stats: \{\s*name: 'timebank_stats',\s*windowMs: HOUR_MS,\s*maxRequests: 30,/)
  const oversight = read('src/app/api/board-room/timebank/oversight/route.ts')
  assert.match(oversight, /boardPilotStats\(stats\)/)
  assert.doesNotMatch(oversight, /publicStats\(/)
})
