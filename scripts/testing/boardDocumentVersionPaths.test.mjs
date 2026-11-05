import { test } from 'node:test'
import assert from 'node:assert/strict'

const {
  BOARD_DOCUMENT_PREFIX,
  isSafeBoardDocumentFilePath,
  isSafeBoardDocumentVersionPath,
  isBoardDocumentVersionPathOf,
  isBoardDocumentVersionBlobPathOf,
  isSafeBoardDocumentBlobPath,
  boardDocumentVersionFilePath,
  boardDocumentVersionsBlobPrefix,
  blobPathForBoardDocument,
} = await import('../../src/lib/storage/boardDocuments.ts')

/**
 * 이사회 서류 앱 편집의 버전 파일 경로 봉쇄(docs/board-work/05-이사회-서류-앱-편집.md §3).
 * 버전 파일은 `board-documents/versions/<서류 uuid>/<버전 uuid>/<ASCII 안전 이름>`에만 산다. 같은 비공개 저장소에
 * DB 백업(`backups/`)·메일 첨부·업무툴·내 문서함이 함께 있으므로, 이 판정이 새면 회원 명부가 나간다.
 */

const DOC = '0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const OTHER_DOC = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const VER = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a'

test('버전 파일 모양: versions/<서류>/<버전>/<안전 이름>만 통과한다', () => {
  const ok = `versions/${DOC}/${VER}/minutes_2026.docx`
  assert.equal(isSafeBoardDocumentFilePath(ok), true)
  assert.equal(isSafeBoardDocumentVersionPath(ok), true)
  assert.equal(isBoardDocumentVersionPathOf(ok, DOC), true)
  // 대소문자만 다른 서류 id 는 같은 서류다
  assert.equal(isBoardDocumentVersionPathOf(ok, DOC.toUpperCase()), true)
  assert.equal(blobPathForBoardDocument(ok), `${BOARD_DOCUMENT_PREFIX}/${ok}`)
})

test('예전 2구간 모양(올린 사람/파일)은 그대로 통과하되 버전 파일로는 보지 않는다', () => {
  for (const legacy of ['seed/doc_0.pdf', `${DOC}/1750000000000_계약서.pdf`]) {
    assert.equal(isSafeBoardDocumentFilePath(legacy), true, legacy)
    assert.equal(isSafeBoardDocumentVersionPath(legacy), false, legacy)
    assert.equal(isBoardDocumentVersionPathOf(legacy, DOC), false, legacy)
  }
})

test('남의 서류 id 구간을 가진 버전 경로는 그 서류의 것이 아니다', () => {
  const p = `versions/${OTHER_DOC}/${VER}/a.docx`
  assert.equal(isSafeBoardDocumentVersionPath(p), true)
  assert.equal(isBoardDocumentVersionPathOf(p, DOC), false)
  assert.equal(isBoardDocumentVersionPathOf(p, 'not-a-uuid'), false)
  assert.equal(isBoardDocumentVersionPathOf(p, null), false)
})

test('버전 경로: 구간 수·UUID·이름 구간이 규약 밖이면 막는다', () => {
  for (const bad of [
    `versions/${DOC}/a.docx`, // 구간 셋
    `versions/${DOC}/${VER}/x/a.docx`, // 구간 다섯
    `versions/not-uuid/${VER}/a.docx`,
    `versions/${DOC}/not-uuid/a.docx`,
    `versions/${DOC}/${VER}/계약서.docx`, // 한글 — 서버는 ASCII 안전 이름만 쓴다
    `versions/${DOC}/${VER}/a b.docx`,
    `versions/${DOC}/${VER}/.hidden`,
    `versions/${DOC}/${VER}/..`,
    `versions/${DOC}/${VER}/a..docx`,
    `versions/${DOC}/${VER}/`,
    `versions//${VER}/a.docx`,
    `Versions/${DOC}/${VER}/a.docx`, // 접두는 소문자 리터럴만
    `versions/${DOC}/${VER}/a%2e%2e.docx`,
    `versions/${DOC}/${VER}/a.docx?x=1`,
    `versions/${DOC}/${VER}/a.docx#x`,
    `versions/${DOC}/${VER}/a\\b.docx`,
    `versions/${DOC}/${VER}/a\u0000.docx`,
    `/versions/${DOC}/${VER}/a.docx`,
    `versions/${DOC}/../${VER}/a.docx`,
    `versions/${DOC}/${VER}/${'a'.repeat(201)}.docx`,
  ]) {
    assert.equal(isSafeBoardDocumentFilePath(bad), false, JSON.stringify(bad))
    assert.equal(isSafeBoardDocumentVersionPath(bad), false, JSON.stringify(bad))
  }
})

test('versions 접두를 다른 영역으로 위장해도 통과하지 못한다', () => {
  for (const bad of [
    'versions/../backups/db.sql.gz',
    'backups/versions/db.sql.gz',
    `versions/${DOC}/${VER}/../../backups/x`,
    'versions',
    'versions/',
  ]) {
    assert.equal(isSafeBoardDocumentFilePath(bad), false, bad)
  }
})

test('버전 파일 경로 조립: 규약 밖 입력이면 null', () => {
  assert.equal(boardDocumentVersionFilePath(DOC, VER, 'a.docx'), `versions/${DOC}/${VER}/a.docx`)
  assert.equal(boardDocumentVersionFilePath(DOC, VER, '계약서.docx'), null)
  assert.equal(boardDocumentVersionFilePath(DOC, VER, '../a.docx'), null)
  assert.equal(boardDocumentVersionFilePath('x', VER, 'a.docx'), null)
  assert.equal(boardDocumentVersionFilePath(DOC, 'x', 'a.docx'), null)
})

test('저장소 전체 pathname 판정: board-documents/ 아래 안전한 경로만', () => {
  const full = `${BOARD_DOCUMENT_PREFIX}/versions/${DOC}/${VER}/a.docx`
  assert.equal(isSafeBoardDocumentBlobPath(full), true)
  assert.equal(isBoardDocumentVersionBlobPathOf(full, DOC), true)
  assert.equal(isBoardDocumentVersionBlobPathOf(full, OTHER_DOC), false)
  assert.equal(isSafeBoardDocumentBlobPath(`${BOARD_DOCUMENT_PREFIX}/seed/doc_0.pdf`), true)
  // 업로드 토큰은 버전 파일에만 준다 — 예전 2구간 경로로는 받지 못한다
  assert.equal(
    isBoardDocumentVersionBlobPathOf(`${BOARD_DOCUMENT_PREFIX}/${DOC}/a.docx`, DOC),
    false
  )
  for (const bad of [
    `versions/${DOC}/${VER}/a.docx`, // 접두 없음
    `backups/versions/${DOC}/${VER}/a.docx`,
    `member-documents/${DOC}/${VER}/a.docx`,
    `board-work/files/${VER}/a.docx`,
    `${BOARD_DOCUMENT_PREFIX}versions/${DOC}/${VER}/a.docx`,
    `${BOARD_DOCUMENT_PREFIX}/../backups/x`,
    `${BOARD_DOCUMENT_PREFIX}/`,
    null,
    42,
  ]) {
    assert.equal(isSafeBoardDocumentBlobPath(bad), false, String(bad))
    assert.equal(isBoardDocumentVersionBlobPathOf(bad, DOC), false, String(bad))
  }
})

test('삭제용 접두: 서류 id 가 UUID 일 때만', () => {
  assert.equal(boardDocumentVersionsBlobPrefix(DOC), `${BOARD_DOCUMENT_PREFIX}/versions/${DOC}/`)
  assert.equal(boardDocumentVersionsBlobPrefix('../backups'), null)
  assert.equal(boardDocumentVersionsBlobPrefix(''), null)
})
