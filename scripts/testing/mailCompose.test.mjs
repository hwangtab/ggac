import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  COMPOSE_LIMITS,
  isTestRecipientAddress,
  normalizeAddress,
  sanitizeAttachmentName,
  validateAttachments,
  validateCompose,
} from '../../src/lib/mail/composeValidation.ts'
import {
  DEFAULT_DAILY_OUTBOUND_LIMIT,
  DEFAULT_DAILY_TOTAL_GUARD,
  dailyOutboundLimit,
  dailyTotalGuard,
  evaluateQuota,
  isComposeEnabled,
} from '../../src/lib/mail/composeQuota.ts'
import {
  blobPathForSentAttachment,
  isSafeMailboxAttachmentPath,
  isSafeSentMailboxAttachmentPath,
} from '../../src/lib/storage/mailboxAttachments.ts'

const OUT = '0f9b1c3a-1111-4222-8333-444455556666'
const ATT = 'aa11bb22-3333-4444-8555-666677778888'

// ── 주소 ─────────────────────────────────────────────────────────────────────

test('주소는 소문자로 정규화하고 합법적인 특수문자를 받는다', () => {
  assert.equal(normalizeAddress('  Foo.Bar@Example.COM '), 'foo.bar@example.com')
  assert.equal(normalizeAddress("o'brien+tag@example.co.kr"), "o'brien+tag@example.co.kr")
})

test('끝의 공백·개행은 다듬어 깨끗한 주소가 된다', () => {
  assert.equal(normalizeAddress('a@b.com\r\n'), 'a@b.com')
})

test('표시이름·쉼표·세미콜론·공백·개행이 든 주소는 거부한다', () => {
  for (const bad of [
    'Name <a@b.com>',
    'a@b.com, c@d.com',
    'a@b.com;c@d.com',
    'a b@c.com',
    'a@b.com\nBcc: x@y.com',
    'a@b.com\r\nBcc: x@y.com',
    'a@\nb.com',
    'a@b',
    '.a@b.com',
    'a..b@b.com',
    '@b.com',
    '',
    42,
    null,
  ]) {
    assert.equal(normalizeAddress(bad), null, `${JSON.stringify(bad)}가 통과했다`)
  }
})

// ── 작성 검증 ────────────────────────────────────────────────────────────────

test('정상 입력은 정규화되고 수신자 수가 센다', () => {
  const r = validateCompose({
    to: ['A@x.com'],
    cc: ['b@x.com'],
    bcc: ['c@x.com'],
    subject: ' 안녕 ',
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value, {
    to: ['a@x.com'],
    cc: ['b@x.com'],
    bcc: ['c@x.com'],
    subject: '안녕',
    recipientCount: 3,
  })
})

test('같은 주소가 여러 칸에 있으면 앞 칸이 이기고 한 번만 센다', () => {
  const r = validateCompose({
    to: ['a@x.com'],
    cc: ['a@x.com', 'b@x.com'],
    bcc: ['b@x.com', 'c@x.com'],
    subject: 's',
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.cc, ['b@x.com'])
  assert.deepEqual(r.value.bcc, ['c@x.com'])
  assert.equal(r.value.recipientCount, 3)
})

test('받는 사람이 없으면 거부한다', () => {
  assert.equal(validateCompose({ to: [], subject: 's' }).ok, false)
  assert.equal(validateCompose({ subject: 's' }).ok, false)
})

test('칸별 한도와 합계 한도를 지킨다', () => {
  const many = n => Array.from({ length: n }, (_, i) => `u${i}@x.com`)
  assert.equal(validateCompose({ to: many(COMPOSE_LIMITS.maxTo + 1), subject: 's' }).ok, false)
  assert.equal(
    validateCompose({ to: ['a@x.com'], cc: many(COMPOSE_LIMITS.maxCc + 1), subject: 's' }).ok,
    false
  )
  assert.equal(
    validateCompose({ to: ['a@x.com'], bcc: many(COMPOSE_LIMITS.maxBcc + 1), subject: 's' }).ok,
    false
  )
  // 5+5+5가 아니라 서로 다른 주소 11명
  const r = validateCompose({
    to: many(5),
    cc: many(10).slice(5),
    bcc: ['z1@x.com', 'z2@x.com'],
    subject: 's',
  })
  assert.equal(r.ok, false)
  assert.match(r.error, /10명/)
})

test('배열이 아닌 수신자 칸은 거부한다', () => {
  assert.equal(validateCompose({ to: 'a@x.com', subject: 's' }).ok, false)
})

test('제목의 개행은 공백으로 바뀌고(헤더 주입 방지) 빈 제목·긴 제목은 거부한다', () => {
  const r = validateCompose({ to: ['a@x.com'], subject: '안녕\r\nBcc: evil@x.com' })
  assert.equal(r.ok, true)
  assert.equal(r.value.subject.includes('\n'), false)
  assert.equal(validateCompose({ to: ['a@x.com'], subject: '   ' }).ok, false)
  assert.equal(
    validateCompose({ to: ['a@x.com'], subject: 'x'.repeat(COMPOSE_LIMITS.subjectMax + 1) }).ok,
    false
  )
  assert.equal(
    validateCompose({ to: ['a@x.com'], subject: 'x'.repeat(COMPOSE_LIMITS.subjectMax) }).ok,
    true
  )
})

test('@test.local과 실주소를 섞으면 거부하고 테스트 주소만이면 통과한다', () => {
  assert.equal(isTestRecipientAddress('authz-admin@test.local'), true)
  assert.equal(isTestRecipientAddress('x@a.test.local'), true)
  assert.equal(isTestRecipientAddress('x@nottest.local'), false)
  assert.equal(
    validateCompose({ to: ['authz-admin@test.local', 'real@gmail.com'], subject: 's' }).ok,
    false
  )
  assert.equal(
    validateCompose({ to: ['authz-admin@test.local'], bcc: ['real@gmail.com'], subject: 's' }).ok,
    false
  )
  assert.equal(
    validateCompose({ to: ['authz-admin@test.local', 'authz-owner@test.local'], subject: 's' }).ok,
    true
  )
})

// ── 첨부 ─────────────────────────────────────────────────────────────────────

test('첨부 파일명은 경로 구분자·제어문자를 제거한다', () => {
  assert.equal(sanitizeAttachmentName('../../etc/passwd'), '.._.._etc_passwd')
  assert.equal(sanitizeAttachmentName('a\nb.pdf'), 'ab.pdf')
  assert.equal(sanitizeAttachmentName('   '), 'attachment')
})

test('첨부 개수·합계 용량·빈 파일을 검사한다', () => {
  const ok = [{ name: 'a.pdf', size: 1000 }]
  assert.equal(validateAttachments(ok).ok, true)
  assert.equal(validateAttachments([]).ok, true)
  assert.equal(
    validateAttachments(Array.from({ length: COMPOSE_LIMITS.maxAttachments + 1 }, () => ok[0])).ok,
    false
  )
  assert.equal(validateAttachments([{ name: 'a.pdf', size: 0 }]).ok, false)
  assert.equal(
    validateAttachments([
      { name: 'a.pdf', size: COMPOSE_LIMITS.maxAttachmentTotalBytes },
      { name: 'b.pdf', size: 1 },
    ]).ok,
    false
  )
  assert.equal(
    validateAttachments([{ name: 'a.pdf', size: COMPOSE_LIMITS.maxAttachmentTotalBytes }]).ok,
    true
  )
})

test('실행 파일 확장자는 대소문자와 무관하게 거부한다', () => {
  for (const name of ['setup.exe', 'RUN.BAT', 'x.js', 'a.b.scr', 'm.ps1']) {
    assert.equal(validateAttachments([{ name, size: 10 }]).ok, false, name)
  }
  assert.equal(validateAttachments([{ name: 'exe', size: 10 }]).ok, true)
})

// ── 보낸 첨부 경로 봉쇄 ───────────────────────────────────────────────────────

test('보낸 첨부 경로는 mailbox-sent 아래 세 조각이다', () => {
  const p = blobPathForSentAttachment(OUT, ATT, 'report.PDF')
  assert.equal(p, `mailbox-sent/${OUT}/${ATT}.pdf`)
  assert.equal(isSafeSentMailboxAttachmentPath(p), true)
})

test('파일명이 보낸 첨부 경로를 바꾸지 못한다', () => {
  const p = blobPathForSentAttachment(OUT, ATT, '../../backups/dump.sql')
  assert.equal(p, `mailbox-sent/${OUT}/${ATT}.sql`)
})

test('받은 첨부 판정과 보낸 첨부 판정은 서로의 경로를 통과시키지 않는다', () => {
  const sent = `mailbox-sent/${OUT}/${ATT}`
  const received = `mailbox/${OUT}/${ATT}`
  assert.equal(isSafeMailboxAttachmentPath(sent), false)
  assert.equal(isSafeSentMailboxAttachmentPath(received), false)
  assert.equal(isSafeMailboxAttachmentPath(received), true)
})

test('보낸 첨부 경로 판정은 이탈 시도를 전부 거부한다', () => {
  for (const bad of [
    'backups/dump.sql',
    `mailbox-sent/../backups/x`,
    `mailbox-sent/${OUT}/../x`,
    `mailbox-sent//${ATT}`,
    `/mailbox-sent/${OUT}/${ATT}`,
    `mailbox-sent/${OUT}/${ATT}?x=1`,
    `mailbox-sent/${OUT}/%2e%2e`,
    `mailbox-sent\\${OUT}\\${ATT}`,
    `mailbox-sent/${OUT}`,
    `mailbox-sent/${OUT}/${ATT}/extra`,
    '',
  ]) {
    assert.equal(isSafeSentMailboxAttachmentPath(bad), false, bad)
  }
})

// ── 킬스위치·한도 ─────────────────────────────────────────────────────────────

test('작성 기능은 정확히 "true"일 때만 켜진다', () => {
  assert.equal(isComposeEnabled({}), false)
  assert.equal(isComposeEnabled({ MAILBOX_COMPOSE_ENABLED: '' }), false)
  assert.equal(isComposeEnabled({ MAILBOX_COMPOSE_ENABLED: '1' }), false)
  assert.equal(isComposeEnabled({ MAILBOX_COMPOSE_ENABLED: 'TRUE' }), false)
  assert.equal(isComposeEnabled({ MAILBOX_COMPOSE_ENABLED: ' true ' }), true)
})

test('한도 환경변수는 양의 정수만 받고 아니면 기본값이다', () => {
  assert.equal(dailyOutboundLimit({}), DEFAULT_DAILY_OUTBOUND_LIMIT)
  assert.equal(dailyTotalGuard({}), DEFAULT_DAILY_TOTAL_GUARD)
  assert.equal(dailyOutboundLimit({ MAILBOX_DAILY_OUTBOUND_LIMIT: '7' }), 7)
  for (const bad of ['0', '-3', 'abc', '1.5', '']) {
    assert.equal(
      dailyOutboundLimit({ MAILBOX_DAILY_OUTBOUND_LIMIT: bad }),
      DEFAULT_DAILY_OUTBOUND_LIMIT,
      bad
    )
  }
})

test('발신 상한: 이번 요청을 포함해 넘으면 막고 정확히 상한이면 통과한다', () => {
  const limits = { outbound: 20, total: 70 }
  assert.deepEqual(evaluateQuota(20, 0, limits), { allowed: true, pressure: true })
  assert.deepEqual(evaluateQuota(21, 0, limits), { allowed: false, reason: 'outbound_limit' })
})

test('총량 가드: 수신이 많은 날은 발신이 상한 아래여도 막는다', () => {
  const limits = { outbound: 20, total: 70 }
  assert.deepEqual(evaluateQuota(10, 60, limits), { allowed: true, pressure: true })
  assert.deepEqual(evaluateQuota(11, 60, limits), { allowed: false, reason: 'total_guard' })
})

test('여유가 크면 경고도 없다', () => {
  assert.deepEqual(evaluateQuota(1, 5, { outbound: 20, total: 70 }), {
    allowed: true,
    pressure: false,
  })
})
