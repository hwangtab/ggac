import { test } from 'node:test'
import assert from 'node:assert/strict'

const R = await import('../../src/lib/boardDocuments/editRules.ts')

/**
 * 이사회 서류 앱 편집의 순수 규칙(docs/board-work/05-이사회-서류-앱-편집.md §1·§2·§5).
 * 권한 판정은 **지울 수 있는 사람과 같다**(올린 사람 또는 관리자) — 라우트의 `requireBoardMember()` 다음 단계다.
 * 실제 차단은 라우트가 하고, 안전망은 e2e/authz-board-document-edit.spec.ts 다.
 */

const ME = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'

test('편집 권한: 올린 사람·관리자만 — 다른 이사는 못 고친다', () => {
  assert.equal(R.canEditBoardDocument({ uploadedBy: ME, userId: ME, isAdmin: false }), true)
  assert.equal(R.canEditBoardDocument({ uploadedBy: OTHER, userId: ME, isAdmin: false }), false)
  assert.equal(R.canEditBoardDocument({ uploadedBy: OTHER, userId: ME, isAdmin: true }), true)
})

test('편집 권한: 올린 사람이 없는 시드 서류는 관리자만, 빈 사용자 id 는 늘 거부', () => {
  assert.equal(R.canEditBoardDocument({ uploadedBy: null, userId: ME, isAdmin: false }), false)
  assert.equal(R.canEditBoardDocument({ uploadedBy: null, userId: ME, isAdmin: true }), true)
  // null === null, '' === '' 로 통과하지 않는다
  assert.equal(R.canEditBoardDocument({ uploadedBy: '', userId: '', isAdmin: false }), false)
  assert.equal(
    R.canEditBoardDocument({ uploadedBy: undefined, userId: undefined, isAdmin: false }),
    false
  )
  // isAdmin 은 정확히 true 일 때만
  assert.equal(R.canEditBoardDocument({ uploadedBy: OTHER, userId: ME, isAdmin: 'yes' }), false)
})

test('편집 판정: 없음·등급 밖 404 가 권한 403 보다 먼저다', () => {
  assert.equal(R.boardDocumentEditAccess(null, ME, true), 'not_found')
  assert.equal(R.boardDocumentEditAccess(undefined, ME, true), 'not_found')
  assert.equal(
    R.boardDocumentEditAccess({ uploadedBy: ME, visibility: 'secret' }, ME, true),
    'not_found'
  )
  assert.equal(
    R.boardDocumentEditAccess({ uploadedBy: OTHER, visibility: 'board' }, ME, false),
    'forbidden'
  )
  assert.equal(R.boardDocumentEditAccess({ uploadedBy: ME, visibility: 'board' }, ME, false), 'ok')
  // 조합원 공개 서류도 고치는 사람은 같다(조합원 자신은 게이트에서 403)
  assert.equal(
    R.boardDocumentEditAccess({ uploadedBy: OTHER, visibility: 'members' }, ME, true),
    'ok'
  )
})

test('버전 번호: 행이 없으면 지금 파일이 v1 이고 처음 저장은 v2', () => {
  assert.deepEqual(R.planNextVersion(null), { needsInitialVersion: true, latestNo: 1, nextNo: 2 })
  assert.deepEqual(R.planNextVersion(2), { needsInitialVersion: false, latestNo: 2, nextNo: 3 })
  // 이상한 값은 행이 없는 것으로(번호가 튀지 않게)
  assert.deepEqual(R.planNextVersion(0), { needsInitialVersion: true, latestNo: 1, nextNo: 2 })
  assert.deepEqual(R.planNextVersion(1.5), { needsInitialVersion: true, latestNo: 1, nextNo: 2 })
})

test('기준 버전: 최신과 다르면 낡았다, 모르면 막지 않는다', () => {
  assert.equal(R.isStaleBase(1, 1), false)
  assert.equal(R.isStaleBase(1, 2), true)
  assert.equal(R.isStaleBase(null, 5), false)
  assert.equal(R.isStaleBase(undefined, 5), false)
})

test('웹 본문: 있던 서류만 다시 만든다, 없던 서류는 그대로 NULL', () => {
  assert.deepEqual(R.bodyPlanAfterSave('# 정관'), { kind: 'regenerate' })
  assert.deepEqual(R.bodyPlanAfterSave(null), { kind: 'none' })
  assert.deepEqual(R.bodyPlanAfterSave(''), { kind: 'none' })
  assert.deepEqual(R.bodyPlanAfterSave('  \n '), { kind: 'none' })
})

test('되돌리기 본문: 그 버전의 기록이 먼저, 없으면 지금 본문이 있을 때만 다시 만든다', () => {
  assert.deepEqual(R.bodyPlanAfterRevert('v1 본문', '최신 본문'), {
    kind: 'snapshot',
    value: 'v1 본문',
  })
  assert.deepEqual(R.bodyPlanAfterRevert('v1 본문', null), { kind: 'snapshot', value: 'v1 본문' })
  // 버전이 생긴 뒤 사무국이 본문을 붙였다 — 본문을 지우지 않고 되돌린 파일에서 다시 만든다
  assert.deepEqual(R.bodyPlanAfterRevert(null, '나중에 붙인 본문'), { kind: 'regenerate' })
  assert.deepEqual(R.bodyPlanAfterRevert(null, null), { kind: 'none' })
  assert.deepEqual(R.bodyPlanAfterRevert('', ''), { kind: 'none' })
})

test('저장본 이름: 같은 형식이거나 오피스 옛 형식 → OOXML 만', () => {
  assert.equal(R.isCompatibleSavedName('회의록.docx', 'x.docx'), true)
  assert.equal(R.isCompatibleSavedName('회의록.doc', 'x.docx'), true)
  assert.equal(R.isCompatibleSavedName('회의록.docx', 'x.doc'), false)
  assert.equal(R.isCompatibleSavedName('회의록.hwp', 'x.hwp'), true)
  assert.equal(R.isCompatibleSavedName('회의록.hwp', 'x.hwpx'), false)
  assert.equal(R.isCompatibleSavedName('회의록.hwpx', 'x.hwpx'), true)
  assert.equal(R.isCompatibleSavedName('예산.xlsx', 'x.docx'), false)
  assert.equal(R.isCompatibleSavedName('결산.pdf', 'x.pdf'), false, 'PDF 는 앱 편집 대상이 아니다')
  assert.equal(R.isCompatibleSavedName('도장.png', 'x.png'), false)
  assert.equal(R.isCompatibleSavedName('회의록.docx', 'x.html'), false)
  assert.equal(R.isCompatibleSavedName('회의록', 'x'), false)
})

test('편집기 종류: HWP·HWPX 는 한글 편집기, 오피스는 오피스 편집기, 그 밖은 없음', () => {
  assert.equal(R.editorSourceFor('a.hwp'), 'hwp-editor')
  assert.equal(R.editorSourceFor('a.HWPX'), 'hwp-editor')
  assert.equal(R.editorSourceFor('a.docx'), 'office-editor')
  assert.equal(R.editorSourceFor('a.ppt'), 'office-editor')
  assert.equal(R.editorSourceFor('a.pdf'), null)
  assert.equal(R.editorSourceFor('a.txt'), null)
})

test('새 버전 이름: 본체는 그대로, 확장자만 저장본 것으로', () => {
  assert.equal(R.savedDisplayName('제9차 회의록.doc', 'blob.docx'), '제9차 회의록.docx')
  assert.equal(R.savedDisplayName('제9차 회의록.hwp', 'saved.hwp'), '제9차 회의록.hwp')
  assert.equal(R.savedDisplayName('확장자없음', 'x.docx'), '확장자없음.docx')
  assert.equal(R.savedDisplayName('회의록.docx', 'noext'), '회의록.docx')
})

test('버전 경로 값: 허용된 넷만, 화면 이름이 다 있다', () => {
  for (const s of R.BOARD_DOCUMENT_VERSION_SOURCES) {
    assert.equal(R.isBoardDocumentVersionSource(s), true)
    assert.ok(R.BOARD_DOCUMENT_SOURCE_LABEL[s])
  }
  assert.equal(R.isBoardDocumentVersionSource('editor'), false)
  assert.equal(R.isBoardDocumentVersionSource('restore'), false)
})
