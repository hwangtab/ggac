import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  BOARD_DOCUMENT_PREFIX,
  isSafeBoardDocumentFilePath,
  blobPathForBoardDocument,
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
//
// 아래 두 테스트는 조립된 문자열이 아니라, 실제 요청에 쓰이는 것과 같은
// WHATWG URL 파서로 정규화한 뒤의 pathname을 검사한다. `blobPathForBoardDocument`가
// 항상 `board-documents/` 접두어를 문자열로 붙이는 이상 `p.startsWith(...)` 같은
// 문자열 단언은 구현상 자명하게 참이라 아무것도 지키지 못한다 — `..?`·`..#`처럼
// 세그먼트 수만 2개인 값이 문자열 조립에서는 접두어 안에 있는 것처럼 보여도, 실제
// `@vercel/blob`이 이 문자열을 URL에 보간할 때는 `?`·`#`에서 경로가 끊기고 `..`가
// 접혀 `board-documents/` 밖으로(심하면 `/`까지) 나갈 수 있다(리뷰에서 실측).
// `isSafeBoardDocumentFilePath`가 이제 첫 세그먼트를 UUID/`seed`로 강제하므로
// 이런 입력은 애초에 `assertSafe`에서 막혀 `blobPathForBoardDocument` 자체가 던진다.
function blobRequestPathname(filePath) {
  return new URL(
    'https://store.private.blob.vercel-storage.com/' + blobPathForBoardDocument(filePath)
  ).pathname
}

test('제공자 계층에 넘길 Blob 경로는 URL 정규화 후에도 접두어 안에 있다', () => {
  const cases = [
    'seed/doc_0.pdf',
    'seed/doc_13.png',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/1_a.pdf',
  ]
  for (const filePath of cases) {
    const pathname = blobRequestPathname(filePath)
    assert.ok(pathname.startsWith('/board-documents/'), `접두어 이탈: ${filePath} → ${pathname}`)
    assert.ok(!pathname.startsWith('/board-documents/backups'), `백업 영역 침범: ${pathname}`)
  }
})

test('세그먼트 수만 2개인 이탈 시도(.., ?, #)는 봉쇄에서 막힌다', () => {
  // `..?/x.pdf`, `..#/x.pdf`는 split('/').length === 2라 옛 봉쇄를 통과했었고,
  // WHATWG URL 파서가 `?`·`#`에서 경로를 끊고 `..`를 접어 실제 요청 경로가
  // `/`가 됐다(리뷰 실측). 첫 세그먼트 UUID/`seed` 강제로 애초에 막힌다.
  for (const evil of ['..?/x.pdf', '..#/x.pdf', 'notauuid/x.pdf']) {
    assert.throws(() => blobPathForBoardDocument(evil), /안전하지 않은/, `통과됨: ${evil}`)
  }
})

test('백업 경로를 file_path로 위장해도 봉쇄에서 막힌다', () => {
  // `backups/20260813.sql.gz`는 세그먼트가 2개라 예전엔 봉쇄 판정만으로는
  // 통과했고(접두어 조립이 갈라놓는 게 유일한 방어선이었다), 이제는 첫
  // 세그먼트가 UUID도 `seed`도 아니라서 애초에 봉쇄에서 막힌다.
  for (const evil of [
    'backups/20260813.sql.gz',
    '../backups/20260813.sql.gz',
    'board-documents/../backups/x.sql.gz',
  ]) {
    assert.throws(() => blobPathForBoardDocument(evil), /안전하지 않은/, `통과됨: ${evil}`)
  }
})
