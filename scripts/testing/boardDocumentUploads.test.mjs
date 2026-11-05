import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const R = await import('../../src/lib/boardDocuments/uploadRules.ts')

/**
 * 이사회 서류 브라우저 직접 업로드의 순수 판정(`src/lib/boardDocuments/uploadRules.ts`) — 준비(①)·토큰(②)·JSON 등록(③)·
 * 저장소 메타(④). 예전 multipart 업로드는 Vercel 함수 본문 4.5MB 한도에 걸려 "최대 50MB" 약속을 지키지 못했다.
 * 실제 차단은 라우트가 하고, 안전망은 e2e/authz-board-document-edit.spec.ts 의 '서류 직접 업로드' 묶음이다.
 */

const ME = '9f8b1c2d-3e4f-4a6b-8c8d-9e0f1a2b3c4d'
const OTHER = '00000000-0000-4000-8000-000000000002'
const MB = 1024 * 1024
const opts = { now: 1762300000000, random: 'abcdef012345' }
const prepare = over => ({
  type: 'prepare',
  name: '회의록.pdf',
  size: 6 * MB,
  mime: 'application/pdf',
  ...over,
})

test('준비: 내 폴더에 서버가 정한 키를 주고, 8MB 를 넘으면 multipart', () => {
  const r = R.prepareBoardDocumentUpload(ME, prepare(), opts)
  assert.equal(r.ok, true)
  assert.equal(r.data.filePath, `${ME}/${opts.now}_${opts.random}_회의록.pdf`)
  assert.equal(r.data.pathname, `board-documents/${r.data.filePath}`)
  assert.equal(r.data.mime, 'application/pdf')
  assert.equal(r.data.multipart, false)
  assert.equal(
    R.prepareBoardDocumentUpload(ME, prepare({ size: 9 * MB }), opts).data.multipart,
    true
  )
  // 서버가 정한 키는 같은 판정(토큰·등록)을 지난다
  assert.equal(R.isOwnBoardDocumentFilePath(ME, r.data.filePath), true)
  assert.equal(R.decideBoardDocumentUploadToken(ME, r.data.pathname).ok, true)
})

test('준비: 50MB 상한 — 딱 50MB 는 되고 1바이트 넘으면 413', () => {
  assert.equal(R.prepareBoardDocumentUpload(ME, prepare({ size: 50 * MB }), opts).ok, true)
  const over = R.prepareBoardDocumentUpload(ME, prepare({ size: 50 * MB + 1 }), opts)
  assert.equal(over.ok, false)
  assert.equal(over.status, 413)
  assert.match(over.error, /50MB/)
})

test('준비: 허용 밖 형식은 415, 크기·이름·종류가 이상하면 400', () => {
  for (const mime of [
    'text/html',
    'application/zip',
    'image/svg+xml',
    'application/x-msdownload',
  ]) {
    const r = R.prepareBoardDocumentUpload(ME, prepare({ name: 'a.html', mime }), opts)
    assert.equal(r.ok, false, mime)
    assert.equal(r.status, 415, mime)
  }
  for (const body of [
    prepare({ size: 0 }),
    prepare({ size: 1.5 }),
    prepare({ size: '100' }),
    prepare({ name: '' }),
    prepare({ name: 'a'.repeat(256) }),
    prepare({ type: 'blob.generate-client-token' }),
    null,
  ]) {
    const r = R.prepareBoardDocumentUpload(ME, body, opts)
    assert.equal(r.ok, false, JSON.stringify(body))
    assert.equal(r.status, 400, JSON.stringify(body))
  }
})

test('준비: 이름을 안전하게 — 경로 구분자·특수 문자·NFD 한글·긴 이름·맞지 않는 확장자', () => {
  const traversal = R.prepareBoardDocumentUpload(ME, prepare({ name: '../../backups/x.pdf' }), opts)
  assert.equal(traversal.ok, true)
  assert.equal(traversal.data.filePath.split('/').length, 2)
  assert.ok(traversal.data.filePath.startsWith(`${ME}/`))
  // macOS 가 넘기는 자모 분리(NFD) 한글도 한글로 남는다
  const nfd = R.prepareBoardDocumentUpload(
    ME,
    prepare({ name: '회의록.pdf'.normalize('NFD') }),
    opts
  )
  assert.ok(nfd.data.filePath.endsWith('_회의록.pdf'))
  // 확장자가 형식과 맞지 않으면 대표 확장자를 붙인다(토큰 단계가 확장자를 본다)
  const noExt = R.prepareBoardDocumentUpload(ME, prepare({ name: 'scan' }), opts)
  assert.ok(noExt.data.filePath.endsWith('_scan.pdf'))
  const long = R.prepareBoardDocumentUpload(ME, prepare({ name: `${'가'.repeat(250)}.pdf` }), opts)
  assert.equal(long.ok, true)
  assert.ok(long.data.filePath.endsWith('.pdf'))
  assert.ok(long.data.filePath.split('/')[1].length <= 150)
})

test('준비: 브라우저가 형식을 비워 보내면(HWP) 확장자로 추정하고, 추정도 허용 목록 안이어야 한다', () => {
  const hwp = R.prepareBoardDocumentUpload(ME, prepare({ name: '정관.hwp', mime: '' }), opts)
  assert.equal(hwp.ok, true)
  assert.equal(hwp.data.mime, 'application/haansofthwp')
  assert.equal(
    R.prepareBoardDocumentUpload(ME, prepare({ name: 'a.exe', mime: '' }), opts).status,
    415
  )
})

test('토큰: 내 폴더만 — 다른 사람 폴더·seed·앱 편집 버전·다른 영역은 403', () => {
  const ok = R.decideBoardDocumentUploadToken(ME, `board-documents/${ME}/1_abc_회의록.pdf`)
  assert.equal(ok.ok, true)
  assert.equal(ok.data.maximumSizeInBytes, 50 * MB)
  assert.deepEqual(
    [...ok.data.allowedContentTypes].sort(),
    [...R.BOARD_DOCUMENT_ALLOWED_MIME_TYPES].sort()
  )
  for (const pathname of [
    `board-documents/${OTHER}/1_abc_a.pdf`,
    `board-documents/${ME.toUpperCase()}/1_abc_a.pdf`,
    'board-documents/seed/a.pdf',
    `board-documents/versions/${OTHER}/${OTHER}/a.docx`,
    `board-documents/${ME}/sub/a.pdf`,
    `board-documents/${ME}/../${OTHER}/a.pdf`,
    `board-documents/${ME}/%2e%2e.pdf`,
    `board-documents/${ME}/a.pdf?x=1`,
    `backups/${ME}/a.pdf`,
    `member-documents/${ME}/a.pdf`,
    `${ME}/a.pdf`,
    `/board-documents/${ME}/a.pdf`,
    '',
    null,
  ]) {
    const r = R.decideBoardDocumentUploadToken(ME, pathname)
    assert.equal(r.ok, false, String(pathname))
    assert.equal(r.status, 403, String(pathname))
  }
})

test('토큰: 파일 이름 확장자가 허용 형식이 아니면 403', () => {
  for (const name of ['a.html', 'a.svg', 'a.exe', 'a.hwpx', 'noext', 'a.pdf.js']) {
    const r = R.decideBoardDocumentUploadToken(ME, `board-documents/${ME}/1_abc_${name}`)
    assert.equal(r.ok, false, name)
    assert.equal(r.status, 403, name)
  }
  for (const name of ['a.PDF', 'b.jpeg', 'c.hwp', 'd.xlsx', 'e.txt']) {
    assert.equal(
      R.decideBoardDocumentUploadToken(ME, `board-documents/${ME}/1_abc_${name}`).ok,
      true,
      name
    )
  }
})

const reg = over => ({
  filePath: `${ME}/1_abc_회의록.pdf`,
  fileName: '제1차 회의록.pdf',
  title: ' 제1차 이사회 회의록 ',
  category: '기타',
  visibility: 'board',
  ...over,
})

test('등록: 제목·분류·열람 범위·경로를 보고, 제목은 앞뒤 공백을 걷는다', () => {
  const r = R.validateBoardDocumentRegistration(ME, false, reg())
  assert.equal(r.ok, true)
  assert.deepEqual(r.data, {
    filePath: `${ME}/1_abc_회의록.pdf`,
    fileName: '제1차 회의록.pdf',
    title: '제1차 이사회 회의록',
    category: '기타',
    visibility: 'board',
  })
  // 열람 범위를 빼면 이사회(닫힘)
  assert.equal(
    R.validateBoardDocumentRegistration(ME, false, reg({ visibility: undefined })).data.visibility,
    'board'
  )
  // 정기총회 분류도 같은 라우트로 들어온다
  assert.equal(R.validateBoardDocumentRegistration(ME, false, reg({ category: '총회' })).ok, true)
})

test('등록: 조합원 공개(members)는 관리자만 — 이사는 403', () => {
  const director = R.validateBoardDocumentRegistration(ME, false, reg({ visibility: 'members' }))
  assert.equal(director.ok, false)
  assert.equal(director.status, 403)
  assert.equal(
    R.validateBoardDocumentRegistration(ME, true, reg({ visibility: 'members' })).ok,
    true
  )
  // isAdmin 은 정확히 true 일 때만
  assert.equal(
    R.validateBoardDocumentRegistration(ME, 'yes', reg({ visibility: 'members' })).status,
    403
  )
})

test('등록: 남의 폴더·seed·버전·이탈 경로는 400 — 관리자도 남의 업로드를 자기 서류로 등록하지 못한다', () => {
  for (const filePath of [
    `${OTHER}/1_abc_a.pdf`,
    'seed/doc_0.pdf',
    `versions/${OTHER}/${OTHER}/a.docx`,
    `${ME}/../${OTHER}/a.pdf`,
    `${ME}/a/b.pdf`,
    `board-documents/${ME}/a.pdf`,
    `${ME}/`,
    undefined,
    42,
  ]) {
    for (const isAdmin of [false, true]) {
      const r = R.validateBoardDocumentRegistration(ME, isAdmin, reg({ filePath }))
      assert.equal(r.ok, false, String(filePath))
      assert.equal(r.status, 400, String(filePath))
    }
  }
})

test('등록: 입력 오류 — 빈 제목·없는 분류·이상한 열람 범위·빈 파일 이름', () => {
  for (const [over, status] of [
    [{ title: '   ' }, 400],
    [{ title: undefined }, 400],
    [{ category: '비밀' }, 400],
    [{ visibility: 'public' }, 400],
    [{ fileName: '' }, 400],
    [{ fileName: 'a'.repeat(256) }, 400],
  ]) {
    const r = R.validateBoardDocumentRegistration(ME, true, reg(over))
    assert.equal(r.ok, false, JSON.stringify(over))
    assert.equal(r.status, status, JSON.stringify(over))
  }
  assert.equal(R.validateBoardDocumentRegistration(ME, true, null).status, 400)
})

test('저장소 메타: 50MB·허용 형식만, charset 은 걷는다', () => {
  assert.deepEqual(R.checkStoredBoardDocument({ size: 6 * MB, contentType: 'application/pdf' }), {
    ok: true,
    data: { size: 6 * MB, mime: 'application/pdf' },
  })
  assert.equal(
    R.checkStoredBoardDocument({ size: 10, contentType: 'text/plain; charset=utf-8' }).data.mime,
    'text/plain'
  )
  for (const meta of [
    { size: 50 * MB + 1, contentType: 'application/pdf' },
    { size: 0, contentType: 'application/pdf' },
    { size: 10, contentType: 'text/html' },
    { size: 10, contentType: null },
  ]) {
    assert.equal(R.checkStoredBoardDocument(meta).ok, false, JSON.stringify(meta))
  }
})

test('브라우저 사전 거름: 50MB 초과·허용 밖 형식은 올리기 전에 문구를 준다', () => {
  assert.equal(
    R.boardDocumentClientRejection({ name: 'a.pdf', size: MB, type: 'application/pdf' }),
    null
  )
  assert.equal(R.boardDocumentClientRejection({ name: 'a.hwp', size: MB, type: '' }), null)
  assert.match(
    R.boardDocumentClientRejection({ name: 'a.pdf', size: 51 * MB, type: 'application/pdf' }),
    /50MB/
  )
  assert.match(
    R.boardDocumentClientRejection({ name: 'a.zip', size: MB, type: 'application/zip' }),
    /지원하지 않는/
  )
})

// 업로드 라우트가 kordoc 을 끌어오면 함수 번들이 250MB 를 넘는다(boardDocumentEditBundle.test.mjs 와 같은 이유)
const HEAVY = [
  "'@/lib/boardDocuments/versions'",
  "'./versions'",
  "'@work/lib/files/extract-text'",
  "'@work/lib/files/editor-save-inspect'",
  "'@work/lib/files/extract-schedule'",
  "'kordoc'",
]

for (const file of [
  'src/app/api/board-room/documents/uploads/route.ts',
  'src/lib/boardDocuments/uploadRules.ts',
  'src/lib/boardDocuments/uploadClient.ts',
]) {
  test(`${file} 는 kordoc 을 부르는 모듈을 import 하지 않는다`, () => {
    const src = readFileSync(file, 'utf8')
    for (const h of HEAVY) {
      assert.ok(!src.includes(`from ${h}`), `${file} 가 ${h} 를 import 한다`)
    }
  })
}

test('업로드 라우트는 next.config.js KORDOC_ROUTES 에 없다', () => {
  const config = readFileSync('next.config.js', 'utf8')
  const block = config.slice(config.indexOf('const KORDOC_ROUTES = ['))
  const list = block.slice(0, block.indexOf(']\n'))
  assert.ok(list.length > 0)
  assert.ok(!list.includes('documents/uploads'))
})
