import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'

import {
  parseMonthParam,
  parseMyTransfersQuery,
  parseTransferAction,
  parseTransferInput,
} from '../../src/lib/timebank/validate.ts'
import {
  LEDGER_REJECTION_RESPONSES,
  TRANSFER_STATE_RESPONSES,
  describeLedgerError,
} from '../../src/lib/timebank/format.ts'
import { TIMEBANK_CHANNELS, TIMEBANK_KINDS } from '../../src/constants/timebank.ts'

/**
 * 기록·확인 라우트의 순수 부분(계획 Task 8, 스펙 §5·§7.1·§8).
 *
 * - `parseTransferInput`: 본문은 정해진 칸만 읽는다. `kind`·`from_account`·
 *   `to_account`·`coop`은 결과에 들어갈 자리가 없다 — 방향은 `directionFor`가
 *   요청자·상대·역할에서 만든다.
 * - 사유 → 문구 표: `LedgerRejection`·`TransferStateCode`의 **모든 값**이 문구와
 *   상태 코드를 가져야 한다. 타입(`Record<…>`)이 컴파일 시점에, 이 파일이
 *   런타임에 같은 것을 확인한다 — 원장 쪽 유니온에 사유를 하나 더하고 표를
 *   안 고치면 여기서 깨진다.
 */

const CP = '5f0c3a9e-1b2c-4d3e-8f40-123456789abc'
const LISTING = '7a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d'
const ORIG = '0d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a'

const body = (over = {}) => ({ counterparty_id: CP, role: 'received', minutes: 60, ...over })

// ── parseTransferInput ──────────────────────────────────────────────────────

test('정상 교환 입력 → exchange, 정해진 칸만', () => {
  const r = parseTransferInput(
    body({ category: 'lesson', memo: '  기타 레슨  ', listing_id: LISTING })
  )
  assert.equal(r.error, null)
  assert.deepEqual(r.value, {
    kind: 'exchange',
    counterparty_id: CP,
    role: 'received',
    minutes: 60,
    category: 'lesson',
    memo: '기타 레슨',
    listing_id: LISTING,
    reverses_id: null,
  })
})

test('본문의 kind·from_account·to_account·coop은 결과에 없다', () => {
  const r = parseTransferInput(
    body({
      kind: 'coop_task',
      from_account: 'coop',
      to_account: 'someone-else',
      coop: true,
      status: 'confirmed',
      created_by: 'x',
    })
  )
  assert.equal(r.error, null)
  assert.equal(r.value.kind, 'exchange')
  for (const key of ['from_account', 'to_account', 'coop', 'status', 'created_by']) {
    assert.equal(key in r.value, false, `${key}가 결과에 남았다`)
  }
  assert.deepEqual(Object.keys(r.value).sort(), [
    'category',
    'counterparty_id',
    'kind',
    'listing_id',
    'memo',
    'minutes',
    'reverses_id',
    'role',
  ])
})

test("kind: 'market'·'reversal'을 본문에 적어도 kind를 정하지 못한다", () => {
  assert.equal(parseTransferInput(body({ kind: 'market' })).value.kind, 'exchange')
  assert.equal(parseTransferInput(body({ kind: 'reversal' })).value.kind, 'exchange')
})

test('reverses_id가 있으면 reversal, role은 무시하고 관련 글도 떼어 낸다', () => {
  const r = parseTransferInput({
    counterparty_id: CP,
    minutes: 90,
    reverses_id: ORIG,
    role: 'nonsense',
    listing_id: LISTING,
    kind: 'exchange',
  })
  assert.equal(r.error, null)
  assert.equal(r.value.kind, 'reversal')
  assert.equal(r.value.role, null)
  assert.equal(r.value.reverses_id, ORIG)
  assert.equal(r.value.listing_id, null)
})

test('되돌림 minutes는 30분 단위가 아니어도 양의 정수면 받는다(원 이동과 같은지는 원장이 본다)', () => {
  assert.equal(parseTransferInput(body({ reverses_id: ORIG, minutes: 45 })).error, null)
  assert.equal(typeof parseTransferInput(body({ reverses_id: ORIG, minutes: 0 })).error, 'string')
  assert.equal(typeof parseTransferInput(body({ reverses_id: ORIG, minutes: -30 })).error, 'string')
})

test('교환 minutes: 30분 단위 30~480, 숫자 문자열도 받는다', () => {
  assert.equal(parseTransferInput(body({ minutes: '120' })).value.minutes, 120)
  for (const bad of [0, 15, 45, 510, -60, 1.5, '1e2', null, undefined, 'abc']) {
    const r = parseTransferInput(body({ minutes: bad }))
    assert.equal(typeof r.error, 'string', `minutes=${bad}`)
    assert.equal(r.value, null)
  }
})

test('역할이 없거나 틀리면 교환은 거부', () => {
  assert.equal(typeof parseTransferInput(body({ role: undefined })).error, 'string')
  assert.equal(typeof parseTransferInput(body({ role: 'paid' })).error, 'string')
  assert.equal(parseTransferInput(body({ role: 'gave' })).value.role, 'gave')
})

test('상대: 비었거나 조합 계좌거나 이상한 문자면 거부', () => {
  for (const bad of [undefined, '', '   ', 'coop', 42, 'a b', 'x'.repeat(65), "'; DROP"]) {
    assert.equal(typeof parseTransferInput(body({ counterparty_id: bad })).error, 'string', bad)
  }
})

test('분류·메모·관련 글·되돌림 id 형식', () => {
  assert.equal(typeof parseTransferInput(body({ category: 'nope' })).error, 'string')
  assert.equal(parseTransferInput(body({ category: '' })).value.category, null)
  assert.equal(parseTransferInput(body({ memo: '   ' })).value.memo, null)
  assert.equal(typeof parseTransferInput(body({ memo: 3 })).error, 'string')
  assert.equal(typeof parseTransferInput(body({ memo: 'x'.repeat(501) })).error, 'string')
  assert.equal(typeof parseTransferInput(body({ listing_id: 'not-a-uuid' })).error, 'string')
  assert.equal(typeof parseTransferInput(body({ reverses_id: 'not-a-uuid' })).error, 'string')
})

test('본문이 객체가 아니면 거부', () => {
  for (const bad of [null, undefined, [], 'x']) {
    assert.equal(typeof parseTransferInput(bad).error, 'string')
  }
})

// ── 결정 action ───────────────────────────────────────────────────────────────

test('action은 confirm·reject·cancel만', () => {
  assert.equal(parseTransferAction('confirm'), 'confirm')
  assert.equal(parseTransferAction('reject'), 'reject')
  assert.equal(parseTransferAction('cancel'), 'cancel')
  for (const bad of ['approve', 'CONFIRM', '', undefined, 'constructor', 'toString']) {
    assert.equal(parseTransferAction(bad), null)
  }
})

// ── 내역 쿼리 ─────────────────────────────────────────────────────────────────

test('내역 쿼리: channel·month·page만 읽고 member_id 같은 칸은 버린다', () => {
  const q = parseMyTransfersQuery(
    new URLSearchParams(
      'member_id=other&user_id=other&memberId=x&channel=exchange&month=2026-11&page=2'
    )
  )
  assert.deepEqual(q, { channel: 'exchange', kinds: ['exchange'], month: '2026-11', page: 2 })
})

test('내역 쿼리: 모르는 값은 필터 없음으로', () => {
  const q = parseMyTransfersQuery(new URLSearchParams('channel=all&month=2026-13&page=-1'))
  assert.deepEqual(q, { channel: null, kinds: null, month: null, page: 1 })
})

test('채널 묶음이 모든 kind를 한 번씩 덮는다', () => {
  const covered = Object.values(TIMEBANK_CHANNELS).flat()
  assert.deepEqual([...covered].sort(), [...TIMEBANK_KINDS].sort())
})

test('parseMonthParam: YYYY-MM만', () => {
  assert.equal(parseMonthParam('2026-01'), '2026-01')
  for (const bad of ['2026-1', '2026-00', '2026-13', '26-01', '', null, '2026-01-01']) {
    assert.equal(parseMonthParam(bad), null)
  }
})

// ── 사유 → 문구 표 ────────────────────────────────────────────────────────────

/** 원장 소스에서 유니온의 문자열 리터럴을 뽑는다(타입은 런타임에 사라지므로). */
function unionMembers(file, typeName, endMarker) {
  const src = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
  const start = src.indexOf(`export type ${typeName} =`)
  assert.ok(start >= 0, `${typeName}을 ${file}에서 찾지 못했다`)
  const end = src.indexOf(endMarker, start + 1)
  const block = src
    .slice(start, end)
    .split('\n')
    .filter(line => !line.trim().startsWith('/**') && !line.trim().startsWith('*'))
    .join('\n')
  return [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}

const transferRejections = unionMembers('src/lib/timebank/rules.ts', 'TransferRejection', '\n\n')
const ledgerRejections = [
  ...transferRejections,
  ...unionMembers('src/db/queries/timebankLedger.ts', 'LedgerRejection', 'export class'),
]
const stateCodes = unionMembers('src/db/queries/timebankLedger.ts', 'TransferStateCode', '\n')

test('소스에서 사유를 제대로 뽑았다(표 검사의 전제)', () => {
  assert.ok(transferRejections.includes('below_floor'))
  assert.ok(transferRejections.length >= 9)
  assert.ok(ledgerRejections.includes('pair_blocked'))
  assert.ok(ledgerRejections.includes('self_approval'))
  assert.deepEqual([...stateCodes].sort(), [
    'not_counterparty',
    'not_found',
    'not_pending',
    'not_recorder',
  ])
})

test('모든 LedgerRejection에 문구와 4xx 상태가 있다(빠진 키가 있으면 실패)', () => {
  const missing = ledgerRejections.filter(r => !(r in LEDGER_REJECTION_RESPONSES))
  assert.deepEqual(missing, [])
  for (const r of ledgerRejections) {
    const { status, message } = LEDGER_REJECTION_RESPONSES[r]
    assert.ok(status >= 400 && status < 500, `${r}: ${status}`)
    assert.ok(typeof message === 'string' && message.length > 0, r)
    assert.ok(!/[a-z]+_[a-z]+/.test(message), `${r}: 사유 키가 문구에 샜다`)
  }
  // 표에 원장에 없는 사유가 남아 있지도 않다.
  assert.deepEqual(
    Object.keys(LEDGER_REJECTION_RESPONSES).filter(k => !ledgerRejections.includes(k)),
    []
  )
})

test('모든 TransferStateCode에 문구와 상태가 있다', () => {
  assert.deepEqual(
    stateCodes.filter(c => !(c in TRANSFER_STATE_RESPONSES)),
    []
  )
  assert.equal(TRANSFER_STATE_RESPONSES.not_found.status, 404)
  assert.equal(TRANSFER_STATE_RESPONSES.not_pending.status, 409)
  assert.equal(TRANSFER_STATE_RESPONSES.not_counterparty.status, 403)
  assert.equal(TRANSFER_STATE_RESPONSES.not_recorder.status, 403)
})

// ── describeLedgerError(실제 오류 클래스) ─────────────────────────────────────

const DB_PATH = 'scripts/testing/.timebank-transfer-route-test.db'
after(() => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

async function ledgerErrors() {
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  return import('../../src/db/queries/timebankLedger.ts')
}

test('describeLedgerError: 하한 문구는 설정의 하한을 사람 말로', async () => {
  const { TransferRejectedError } = await ledgerErrors()
  const d = describeLedgerError(new TransferRejectedError('below_floor'), {
    floorMinutes: -600,
  })
  assert.deepEqual(d, {
    status: 409,
    code: 'below_floor',
    message: '확정하면 잔액이 한도(−10시간)를 넘습니다.',
  })
  assert.match(
    describeLedgerError(new TransferRejectedError('below_floor'), { floorMinutes: -90 }).message,
    /한도\(−1시간 30분\)/
  )
})

test('describeLedgerError: 모든 사유·상태 코드를 실제 오류 객체로 바꾼다', async () => {
  const { TransferRejectedError, TransferStateError } = await ledgerErrors()
  for (const r of ledgerRejections) {
    const d = describeLedgerError(new TransferRejectedError(r), { floorMinutes: -600 })
    assert.equal(d.code, r)
    assert.equal(d.status, LEDGER_REJECTION_RESPONSES[r].status)
    assert.ok(!d.message.includes('{'), `${r}: 자리표시자가 남았다`)
  }
  for (const c of stateCodes) {
    const d = describeLedgerError(new TransferStateError(c))
    assert.equal(d.code, c)
    assert.equal(d.status, TRANSFER_STATE_RESPONSES[c].status)
  }
})

test('describeLedgerError: 원장 오류가 아니면 null(500으로 흘려보낸다)', () => {
  assert.equal(describeLedgerError(new Error('boom')), null)
  assert.equal(describeLedgerError({ name: 'TransferRejectedError', reason: 'nope' }), null)
  assert.equal(describeLedgerError(null), null)
})
