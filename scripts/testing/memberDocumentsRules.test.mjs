import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 조합원 내 문서함의 순수 규칙(docs/board-work/04-조합원-문서함.md §3·§5·§6) — 경로 봉쇄·사용량·보존·이름.
 * 두 모듈 모두 import 가 없어 직접 읽는다. 같은 보존 조건을 SQL로 쓰는 쿼리는 queriesMemberDocuments.test.mjs가 본다.
 */
const paths = await import('../../src/lib/storage/memberDocuments.ts')
const rules = await import('../../src/lib/memberDocuments/rules.ts')

const OWNER = '00000000-0000-4000-8000-00000000b002'
const OTHER = '00000000-0000-4000-8000-00000000b003'
const UP = '7d0c8f7e-1111-4000-8000-000000000001'
const DAY = 24 * 60 * 60 * 1000

// ── 경로 봉쇄 ────────────────────────────────────────────────────────────────

test('문서함 키 모양 하나만 통과한다', () => {
  assert.equal(paths.isSafeMemberDocumentPath(`member-documents/${OWNER}/${UP}/report.docx`), true)
  assert.equal(paths.isSafeMemberDocumentPath(`member-documents/${OWNER}/${UP}/a_(1)-b.hwp`), true)
})

test('같은 비공개 저장소의 다른 접두(백업·메일·이사회 서류·업무툴)는 전부 막힌다', () => {
  for (const p of [
    'backups/2026-11-04/db.sql.gz',
    `mailbox/${UP}/attachment.pdf`,
    `board-documents/${OWNER}/1730000000_x.pdf`,
    `board-work/files/${UP}/x.docx`,
    `board-work/renders/${UP}-v1.json`,
  ]) {
    assert.equal(paths.isSafeMemberDocumentPath(p), false, p)
  }
})

test('위장·상위 경로·인코딩·구간 수가 다른 키는 거짓이다', () => {
  for (const p of [
    '',
    null,
    123,
    'member-documents/',
    `member-documents/${OWNER}/${UP}`,
    `member-documents/${OWNER}/${UP}/x/y.docx`,
    `member-documents/${OWNER}/../backups/db.sql`,
    `member-documents/${OWNER}/${UP}/..`,
    `member-documents/${OWNER}/${UP}/.hidden`,
    `member-documents/${OWNER}/${UP}/a..b.docx`,
    `member-documents/not-a-uuid/${UP}/x.docx`,
    `member-documents/${OWNER}/not-a-uuid/x.docx`,
    `member-documents/${OWNER}/${UP}/%2e%2e.docx`,
    `member-documents/${OWNER}/${UP}/한글.docx`,
    `member-documents/${OWNER}/${UP}/a b.docx`,
    `member-documents/${OWNER}/${UP}/a\\b.docx`,
    `member-documents/${OWNER}/${UP}/a.docx?x=1`,
    `member-documents/${OWNER}/${UP}/a.docx#x`,
    `member-documents/${OWNER}/${UP}/a\u0000.docx`,
    `member-documents//${OWNER}/${UP}/a.docx`,
    `/member-documents/${OWNER}/${UP}/a.docx`,
    `member-documentsX/${OWNER}/${UP}/a.docx`,
    `member-documents/${OWNER}/${UP}/${'a'.repeat(300)}.docx`,
  ]) {
    assert.equal(paths.isSafeMemberDocumentPath(p), false, String(p))
  }
})

test('소유자 구간이 다르면 남의 문서함 키다', () => {
  const mine = `member-documents/${OWNER}/${UP}/x.pdf`
  assert.equal(paths.isMemberDocumentPathOf(mine, OWNER), true)
  assert.equal(paths.isMemberDocumentPathOf(mine, OWNER.toUpperCase()), true)
  assert.equal(paths.isMemberDocumentPathOf(mine, OTHER), false)
  assert.equal(paths.isMemberDocumentPathOf(mine, ''), false)
  assert.equal(paths.isMemberDocumentPathOf('backups/x', OWNER), false)
})

test('키 만들기는 규약 밖 입력에 null 을 준다', () => {
  assert.equal(
    paths.memberDocumentFilePath(OWNER, UP, 'x.docx'),
    `member-documents/${OWNER}/${UP}/x.docx`
  )
  assert.equal(paths.memberDocumentFilePath('../backups', UP, 'x.docx'), null)
  assert.equal(paths.memberDocumentFilePath(OWNER, UP, '../x'), null)
})

// ── 사용량 ────────────────────────────────────────────────────────────────────

test('사용량은 200MB 까지 — 딱 맞으면 통과, 1바이트 넘으면 거절', () => {
  const Q = rules.MEMBER_DOCUMENT_QUOTA_BYTES
  assert.equal(Q, 200 * 1024 * 1024)
  assert.equal(rules.quotaVerdict(Q - 10, 10).ok, true)
  assert.equal(rules.quotaVerdict(Q - 10, 11).ok, false)
  assert.equal(rules.quotaVerdict(0, Q + 1).ok, false)
  assert.equal(rules.quotaVerdict(Q - 10, 10).remaining, 0)
})

test('이상한 값은 넘친 것으로 본다(닫힌 쪽)', () => {
  for (const [u, a] of [
    [-1, 0],
    [0, -1],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
  ]) {
    assert.equal(rules.quotaVerdict(u, a).ok, false, `${u}+${a}`)
  }
})

test('사용량 막대 비율은 0~1', () => {
  assert.equal(rules.quotaRatio(0), 0)
  assert.equal(rules.quotaRatio(rules.MEMBER_DOCUMENT_QUOTA_BYTES / 2), 0.5)
  assert.equal(rules.quotaRatio(rules.MEMBER_DOCUMENT_QUOTA_BYTES * 3), 1)
})

// ── 보존 ──────────────────────────────────────────────────────────────────────

test('열지 않은 지 365일이면 알리고, 그 전에는 둔다', () => {
  const now = Date.UTC(2027, 10, 4)
  assert.equal(
    rules.retentionActionOf({ lastOpenedAt: now - 365 * DAY, deletionNotifiedAt: null }, now),
    'notify'
  )
  assert.equal(
    rules.retentionActionOf({ lastOpenedAt: now - 364 * DAY, deletionNotifiedAt: null }, now),
    'keep'
  )
})

test('알린 지 30일이 지나고 그 뒤로 열지 않았으면 지운다', () => {
  const notified = Date.UTC(2027, 10, 4)
  const doc = { lastOpenedAt: notified - 365 * DAY, deletionNotifiedAt: notified }
  assert.equal(rules.retentionActionOf(doc, notified + 29 * DAY), 'keep')
  assert.equal(rules.retentionActionOf(doc, notified + 30 * DAY), 'delete')
})

test('알린 뒤 열었으면 지우지 않는다(열면 알림 시각도 지워진다)', () => {
  const notified = Date.UTC(2027, 10, 4)
  const opened = { lastOpenedAt: notified + DAY, deletionNotifiedAt: notified }
  assert.equal(rules.retentionActionOf(opened, notified + 60 * DAY), 'keep')
  // 연 순간 쿼리가 deletionNotifiedAt 을 비운다 — 그 뒤로는 다시 365일부터 센다
  const reset = { lastOpenedAt: notified + DAY, deletionNotifiedAt: null }
  assert.equal(rules.retentionActionOf(reset, notified + 365 * DAY), 'keep')
  assert.equal(rules.retentionActionOf(reset, notified + 366 * DAY), 'notify')
})

test('Date 와 숫자를 같이 받는다', () => {
  const now = new Date('2027-11-04T00:00:00Z')
  const old = new Date(now.getTime() - 400 * DAY)
  assert.equal(
    rules.retentionActionOf({ lastOpenedAt: old, deletionNotifiedAt: null }, now),
    'notify'
  )
  assert.equal(rules.deletionDueAt(now).getTime(), now.getTime() + 30 * DAY)
})

// ── 이름·형식 ─────────────────────────────────────────────────────────────────

test('이름 바꾸기는 확장자를 지킨다', () => {
  assert.equal(rules.normalizeRename('회의록 최종', '안건.hwp'), '회의록 최종.hwp')
  assert.equal(rules.normalizeRename('회의록 최종.hwp', '안건.hwp'), '회의록 최종.hwp')
  assert.equal(rules.normalizeRename('회의록.docx', '안건.hwp'), '회의록.docx.hwp')
  assert.equal(rules.normalizeRename('a/b\\c', 'x.pdf'), 'a_b_c.pdf')
  assert.equal(rules.normalizeRename('  ', 'x.pdf'), null)
  assert.equal(rules.normalizeRename('...', 'x.pdf'), null)
  assert.equal(rules.normalizeRename('‮gnp.exe', 'x.pdf'), 'gnp.exe.pdf')
  assert.equal(rules.normalizeRename(42, 'x.pdf'), null)
  assert.ok(
    rules.normalizeRename('가'.repeat(500), 'x.pdf').length <= rules.MEMBER_DOCUMENT_NAME_MAX
  )
})

test('올릴 수 있는 형식 — 문서·텍스트·이미지만', () => {
  for (const n of ['a.pdf', 'a.HWP', 'a.hwpx', 'a.docx', 'a.xlsx', 'a.pptx', 'a.txt', 'a.png']) {
    assert.equal(rules.isAllowedMemberDocument(n), true, n)
  }
  for (const n of ['a.exe', 'a.html', 'a.svg', 'a.zip', 'a.js', 'noext', '.pdf']) {
    assert.equal(rules.isAllowedMemberDocument(n), false, n)
  }
})

test('새 버전은 같은 형식이나 옛/새 짝만 받고, 이름은 본체를 지킨 채 확장자만 바뀐다', () => {
  assert.equal(rules.isCompatibleVersionFile('보고서.doc', 'x.docx'), true)
  assert.equal(rules.isCompatibleVersionFile('보고서.hwp', 'x.hwpx'), true)
  assert.equal(rules.isCompatibleVersionFile('보고서.hwp', 'x.pdf'), false)
  assert.equal(rules.renameWithExtension('보고서.doc', 'saved.docx'), '보고서.docx')
  assert.equal(rules.renameWithExtension('보고서.hwp', 'saved.hwp'), '보고서.hwp')
})

test('새 문서 이름은 형식 확장자를 고정으로 붙인다', () => {
  assert.equal(rules.normalizeNewDocumentName('기획안', 'docx'), '기획안.docx')
  assert.equal(rules.normalizeNewDocumentName('기획안.xlsx', 'docx'), '기획안.docx')
  assert.equal(rules.normalizeNewDocumentName('', 'hwpx'), null)
  assert.equal(rules.isMemberNewDocumentType('hwpx'), true)
  assert.equal(rules.isMemberNewDocumentType('hwp'), false)
  assert.equal(rules.newDocumentTemplatePath('pptx'), '/doc-templates/blank.pptx')
})
