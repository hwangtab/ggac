import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  BOARD_DOCUMENT_PREFIX,
  isSafeBoardDocumentFilePath,
  blobPathForBoardDocument,
  supabaseLocationForBoardDocument,
  contentDispositionAttachment,
} = await import('../../src/lib/storage/boardDocuments.ts')

// 봉쇄 판정: 이 함수가 통과시킨 값만 저장소 경로로 조립된다. 비공개 Blob
// 저장소에는 조합 DB 전체 덤프가 backups/ 접두어로 함께 들어 있으므로, 여기서
// 새어 나가면 회원 명부 전체가 노출된다.

test('정상 경로: 시드 문서와 업로드 문서를 모두 통과시킨다', () => {
  assert.equal(isSafeBoardDocumentFilePath('seed/doc_0.pdf'), true)
  assert.equal(
    isSafeBoardDocumentFilePath('9f8b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d/1750000000000_계약서.pdf'),
    true
  )
})

test('경로 이탈: .. 를 어떤 형태로도 통과시키지 않는다', () => {
  assert.equal(isSafeBoardDocumentFilePath('../backups/20260813.sql.gz'), false)
  assert.equal(isSafeBoardDocumentFilePath('seed/../../backups/20260813.sql.gz'), false)
  assert.equal(isSafeBoardDocumentFilePath('seed/..'), false)
  assert.equal(isSafeBoardDocumentFilePath('..'), false)
})

test('경로 이탈: 퍼센트 인코딩된 .. 도 막는다', () => {
  assert.equal(isSafeBoardDocumentFilePath('%2e%2e/backups/20260813.sql.gz'), false)
  assert.equal(isSafeBoardDocumentFilePath('seed/%2E%2E/x.pdf'), false)
})

test('절대 경로·프로토콜·호스트 형태를 막는다', () => {
  assert.equal(isSafeBoardDocumentFilePath('/backups/20260813.sql.gz'), false)
  assert.equal(isSafeBoardDocumentFilePath('https://evil.example/x.pdf'), false)
  assert.equal(isSafeBoardDocumentFilePath('//evil.example/x.pdf'), false)
  assert.equal(isSafeBoardDocumentFilePath('\\\\evil\\x.pdf'), false)
})

test('백슬래시·널바이트·제어문자를 막는다', () => {
  assert.equal(isSafeBoardDocumentFilePath('seed\\doc_0.pdf'), false)
  assert.equal(isSafeBoardDocumentFilePath('seed/doc\u00000.pdf'), false)
  assert.equal(isSafeBoardDocumentFilePath('seed/doc\n0.pdf'), false)
})

test('빈 값·비문자열·과도한 길이를 막는다', () => {
  assert.equal(isSafeBoardDocumentFilePath(''), false)
  assert.equal(isSafeBoardDocumentFilePath(null), false)
  assert.equal(isSafeBoardDocumentFilePath(undefined), false)
  assert.equal(isSafeBoardDocumentFilePath(123), false)
  assert.equal(isSafeBoardDocumentFilePath('a/' + 'x'.repeat(600)), false)
})

test('세그먼트가 정확히 2개가 아니면 막는다', () => {
  assert.equal(isSafeBoardDocumentFilePath('doc_0.pdf'), false)
  assert.equal(isSafeBoardDocumentFilePath('a/b/c.pdf'), false)
  assert.equal(isSafeBoardDocumentFilePath('seed/'), false)
  assert.equal(isSafeBoardDocumentFilePath('/seed/doc_0.pdf'), false)
})

test('Blob 경로는 board-documents/ 접두어를 붙인다', () => {
  assert.equal(BOARD_DOCUMENT_PREFIX, 'board-documents')
  assert.equal(blobPathForBoardDocument('seed/doc_0.pdf'), 'board-documents/seed/doc_0.pdf')
})

test('Blob 경로 조립은 봉쇄를 통과하지 못한 값에 대해 던진다', () => {
  assert.throws(() => blobPathForBoardDocument('../backups/x.sql.gz'), /안전하지 않은/)
  assert.throws(() => blobPathForBoardDocument(''), /안전하지 않은/)
})

test('Supabase 위치는 버킷과 키로 나뉜다', () => {
  assert.deepEqual(supabaseLocationForBoardDocument('seed/doc_0.pdf'), {
    bucket: 'board-documents',
    key: 'seed/doc_0.pdf',
  })
})

test('Supabase 위치 조립도 봉쇄를 통과하지 못한 값에 대해 던진다', () => {
  assert.throws(() => supabaseLocationForBoardDocument('seed/../x'), /안전하지 않은/)
})

test('Content-Disposition: ASCII 파일명은 그대로, 한글은 RFC 5987로', () => {
  assert.equal(
    contentDispositionAttachment('report.pdf'),
    `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`
  )
  const korean = contentDispositionAttachment('정관.pdf')
  assert.match(korean, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/)
  assert.ok(korean.includes(encodeURIComponent('정관.pdf')))
})

test('Content-Disposition: 따옴표·개행이 헤더를 깨지 못한다', () => {
  const nasty = contentDispositionAttachment('a"b\r\nX-Injected: 1.pdf')
  assert.ok(!nasty.includes('\r'))
  assert.ok(!nasty.includes('\n'))
  // ASCII 폴백에는 따옴표가 남지 않아야 한다
  const asciiPart = nasty.slice(nasty.indexOf('filename="') + 10, nasty.indexOf('";'))
  assert.ok(!asciiPart.includes('"'))
})

test('Content-Disposition: 파일명이 비어도 기본값을 쓴다', () => {
  assert.match(contentDispositionAttachment(''), /filename="download"/)
  assert.match(contentDispositionAttachment(null), /filename="download"/)
})

// --- 제공자 계층 경로 조립 ---

test('제공자 계층에 넘길 Blob 경로는 항상 접두어 안에 있다', () => {
  const cases = [
    'seed/doc_0.pdf',
    'seed/doc_13.png',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/1_a.pdf',
  ]
  for (const filePath of cases) {
    const p = blobPathForBoardDocument(filePath)
    assert.ok(p.startsWith('board-documents/'), `접두어 이탈: ${p}`)
    assert.ok(!p.includes('/../'), `상위 이동 포함: ${p}`)
    assert.ok(!p.startsWith('board-documents/backups'), `백업 영역 침범: ${p}`)
  }
})

test('백업 경로를 file_path로 위장해도 실제 백업 객체에 닿지 못한다', () => {
  // `backups/20260813.sql.gz`는 세그먼트가 2개라 봉쇄 판정 자체는 통과한다.
  // 그러나 접두어가 붙어 `board-documents/backups/...`가 되므로 실제 백업 객체
  // (`backups/20260813.sql.gz`)와는 다른 경로다 — 닿지 못한다.
  assert.equal(
    blobPathForBoardDocument('backups/20260813.sql.gz'),
    'board-documents/backups/20260813.sql.gz'
  )
  // 접두어를 벗어나려고 상위 이동을 섞은 형태는 봉쇄에서 막힌다.
  for (const evil of ['../backups/20260813.sql.gz', 'board-documents/../backups/x.sql.gz']) {
    assert.throws(() => blobPathForBoardDocument(evil), /안전하지 않은/, `통과됨: ${evil}`)
  }
})
