import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 업무툴 파일(2a)의 순수 규칙 — 비공개 Blob 경로 봉쇄·Range·Content-Disposition·업로드 토큰·승격 판정.
 * 설계: docs/board-work/01-설계.md §7. DB·저장소 없이 돈다(쿼리 규칙은 queriesBoardWorkFiles.test.mjs).
 *
 * 경로 봉쇄가 가장 중요하다: 같은 비공개 저장소에 조합 DB 전체 덤프(`backups/`)와 메일 첨부(`mailbox/`)가 있다.
 */
const {
  isSafeBoardWorkPath,
  boardWorkFilePath,
  boardWorkThumbPath,
  uploadIdOfBoardWorkPath,
  parseByteRange,
  parseContentRange,
  contentRangeValue,
  rangeHeaderValue,
  contentDispositionValue,
} = await import('../../src/lib/storage/boardWork.ts')
const { buildUploadPath, sanitizeFileName, isSafeAttachmentPath, thumbPathOf } = await import(
  '../../src/work/lib/files/paths.ts'
)
const { checkPromotable, decideUploadToken, storedContentTypeMatches } = await import(
  '../../src/work/lib/files/upload-rules.ts'
)
const { renderCachePath, layoutManifestPath, layoutPagePath, layoutTooBigPath } = await import(
  '../../src/work/lib/files/render-types.ts'
)

const UPLOAD = '3f2b8c1e-7d4a-4c2b-9e1f-0a1b2c3d4e5f'
const ATTACH = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

test('경로 봉쇄: 업무툴 파일 키·썸네일·렌더 캐시만 통과한다', () => {
  const file = boardWorkFilePath(UPLOAD, 'report.pdf')
  assert.equal(file, `board-work/files/${UPLOAD}/report.pdf`)
  assert.equal(isSafeBoardWorkPath(file), true)
  assert.equal(isSafeBoardWorkPath(boardWorkThumbPath(file)), true)
  assert.equal(uploadIdOfBoardWorkPath(file), UPLOAD)
  for (const p of [
    renderCachePath(ATTACH, 'kordoc4.24.15-r3'),
    layoutManifestPath(ATTACH, 'kordoc4.24.15-L2'),
    layoutPagePath(ATTACH, 'kordoc4.24.15-L2', 3),
    layoutTooBigPath(ATTACH, 'kordoc4.24.15-L2', 12),
  ]) {
    assert.ok(p.startsWith('board-work/renders/'), p)
    assert.equal(isSafeBoardWorkPath(p), true, p)
  }
})

test('경로 봉쇄: 다른 영역(backups·mailbox·board-documents)과 접두어 위장은 전부 거부한다', () => {
  const denied = [
    'backups/ggac-prod-2026-11-01.sql.gz',
    'mailbox/2026/11/abc/attachment.pdf',
    `board-documents/${UPLOAD}/minutes.pdf`,
    `board-workx/files/${UPLOAD}/a.pdf`,
    `/board-work/files/${UPLOAD}/a.pdf`,
    `board-work/files/${UPLOAD}/../../backups/dump.sql`,
    `board-work/../backups/dump.sql`,
    `board-work/files/../../mailbox/x.pdf`,
    `board-work//files/${UPLOAD}/a.pdf`,
    `board-work/files/${UPLOAD}/./a.pdf`,
    `board-work/files/${UPLOAD}/..`,
    `board-work/files/${UPLOAD}/a/b.pdf`,
    `board-work/files/not-a-uuid/a.pdf`,
    `board-work/files/${UPLOAD}/%2e%2e%2fbackups`,
    `board-work/files/${UPLOAD}/a.pdf?x=1`,
    `board-work/files/${UPLOAD}/a.pdf#frag`,
    `board-work/files/${UPLOAD}/a\\..\\b.pdf`,
    `board-work/files/${UPLOAD}/a\u0000.pdf`,
    `board-work/files/${UPLOAD}/한글.pdf`,
    `board-work/files/${UPLOAD}/a b.pdf`,
    `board-work/files/${UPLOAD}/.hidden`,
    `board-work/renders/backups.json`,
    `board-work/renders/${ATTACH}-v1.exe`,
    `board-work/renders/${ATTACH}-../x.json`,
    `board-work/other/${UPLOAD}/a.pdf`,
    'board-work/',
    '',
    `https://store.private.blob.vercel-storage.com/board-work/files/${UPLOAD}/a.pdf`,
  ]
  for (const p of denied) assert.equal(isSafeBoardWorkPath(p), false, `통과하면 안 된다: ${p}`)
  assert.equal(isSafeBoardWorkPath(null), false)
  assert.equal(isSafeBoardWorkPath(42), false)
  assert.equal(isSafeBoardWorkPath(`board-work/files/${UPLOAD}/${'a'.repeat(600)}`), false)
  // 첨부 행 검사는 파일 키만(렌더 캐시를 첨부로 위장한 행도 막는다)
  assert.equal(isSafeAttachmentPath(renderCachePath(ATTACH, 'v1')), false)
  assert.equal(isSafeAttachmentPath(boardWorkFilePath(UPLOAD, 'a.pdf')), true)
})

test('업로드 키: 어떤 원래 이름이 와도 서버가 만든 키는 봉쇄 검사를 통과하고 다른 영역으로 나가지 않는다', () => {
  const names = [
    '이사회 회의록 (2026.11).hwp',
    '../../backups/dump.sql',
    '..\\..\\mailbox\\x.pdf',
    '%2e%2e%2f.pdf',
    '.env',
    'a?b#c.pdf',
    '‮gnp.exe',
    '   ',
    '정관.',
    `${'가'.repeat(300)}.pdf`,
    'CON',
    '((()))',
  ]
  for (const name of names) {
    const key = buildUploadPath(UPLOAD, name)
    assert.ok(key.startsWith(`board-work/files/${UPLOAD}/`), key)
    assert.equal(isSafeBoardWorkPath(key), true, `${name} → ${key}`)
    assert.equal(isSafeAttachmentPath(key), true)
    assert.equal(isSafeBoardWorkPath(thumbPathOf(key)), true)
  }
  assert.equal(sanitizeFileName('이사회 회의록.hwp'), 'file.hwp')
  assert.equal(sanitizeFileName('report final.PDF'), 'report_final.PDF')
})

test('Range: 단일 bytes=a-b·a-·-n 만 받고, 크기 밖은 416, 여러 범위·잘못된 모양은 무시(전체 200)', () => {
  const size = 1000
  assert.deepEqual(parseByteRange(null, size), { kind: 'none' })
  assert.deepEqual(parseByteRange('bytes=0-99', size), { kind: 'range', start: 0, end: 99 })
  assert.deepEqual(parseByteRange('bytes=900-', size), { kind: 'range', start: 900, end: 999 })
  assert.deepEqual(parseByteRange('bytes=-100', size), { kind: 'range', start: 900, end: 999 })
  assert.deepEqual(parseByteRange('bytes=-5000', size), { kind: 'range', start: 0, end: 999 })
  // 끝이 크기를 넘으면 마지막 바이트로 줄인다
  assert.deepEqual(parseByteRange('bytes=500-99999', size), { kind: 'range', start: 500, end: 999 })
  assert.deepEqual(parseByteRange('bytes=1000-', size), { kind: 'unsatisfiable' })
  assert.deepEqual(parseByteRange('bytes=1000-1001', size), { kind: 'unsatisfiable' })
  assert.deepEqual(parseByteRange('bytes=-0', size), { kind: 'unsatisfiable' })
  assert.deepEqual(parseByteRange('bytes=0-', 0), { kind: 'unsatisfiable' })
  for (const ignored of [
    'bytes=0-1,5-9',
    'bytes=9-1',
    'items=0-9',
    'bytes=',
    'bytes=-',
    'bytes=abc-def',
    'bytes=0x10-20',
    `bytes=${'9'.repeat(40)}-`,
  ]) {
    assert.deepEqual(parseByteRange(ignored, size), { kind: 'none' }, ignored)
  }
  assert.equal(rangeHeaderValue({ start: 5, end: 9 }), 'bytes=5-9')
  assert.equal(contentRangeValue({ start: 5, end: 9 }, 1000), 'bytes 5-9/1000')
})

test('206 판정: 저장소 응답의 content-range 만 본다(get()의 statusCode 는 늘 200)', () => {
  assert.deepEqual(parseContentRange('bytes 0-99/1000'), { start: 0, end: 99, size: 1000 })
  assert.deepEqual(parseContentRange('bytes 10-19/*'), { start: 10, end: 19, size: null })
  for (const bad of [null, '', 'bytes */1000', 'bytes 9-1/10', 'items 0-1/2', 'bytes 0-1']) {
    assert.equal(parseContentRange(bad), null, String(bad))
  }
})

test('Content-Disposition: 한글 이름은 RFC 5987 로 싣고, 따옴표·줄바꿈으로 헤더를 깨지 못한다', () => {
  assert.equal(
    contentDispositionValue('inline', '회의록.pdf'),
    `inline; filename="___.pdf"; filename*=UTF-8''%ED%9A%8C%EC%9D%98%EB%A1%9D.pdf`
  )
  const evil = contentDispositionValue('attachment', 'a"\r\nSet-Cookie: x=1\\.pdf')
  assert.ok(evil.startsWith('attachment; filename="a_'), evil)
  assert.doesNotMatch(evil, /[\r\n]/)
  assert.equal((evil.match(/"/g) ?? []).length, 2, '따옴표는 감싸는 두 개뿐이어야 한다')
  assert.match(evil, /filename\*=UTF-8''a%22%0D%0ASet-Cookie%3A%20x%3D1%5C\.pdf$/)
  assert.match(
    contentDispositionValue('attachment', "it's (1).txt"),
    /filename\*=UTF-8''it%27s%20%281%29\.txt$/
  )
  assert.match(contentDispositionValue('inline', ''), /filename="file"/)
})

test('승격 판정: 업로드 미완료·상한 초과·크기 불일치·형식 위장은 거부한다', () => {
  const row = { size: 1234, mime: 'application/pdf' }
  const max = 10_000
  assert.deepEqual(checkPromotable(row, { size: 1234, contentType: 'application/pdf' }, max), {
    ok: true,
  })
  // 저장소가 형식을 비우거나 octet-stream 이면 브라우저가 그리지 않으므로 통과(원본과 같다)
  assert.equal(checkPromotable(row, { size: 1234, contentType: null }, max).ok, true)
  assert.equal(
    checkPromotable(row, { size: 1234, contentType: 'application/octet-stream' }, max).ok,
    true
  )
  assert.equal(
    checkPromotable(row, { size: 1234, contentType: 'application/pdf; charset=binary' }, max).ok,
    true
  )
  assert.equal(checkPromotable(row, null, max).reason, 'incomplete')
  assert.equal(
    checkPromotable(row, { size: 20_000, contentType: 'application/pdf' }, max).reason,
    'too_large'
  )
  assert.equal(
    checkPromotable(row, { size: 1233, contentType: 'application/pdf' }, max).reason,
    'size_mismatch'
  )
  // 행에는 PDF 라 적고 객체는 HTML 로 올리면, 행 기준으로 inline 을 허용하는 라우트가 HTML 을 그대로 연다
  assert.equal(
    checkPromotable(row, { size: 1234, contentType: 'text/html' }, max).reason,
    'type_mismatch'
  )
  assert.equal(storedContentTypeMatches('IMAGE/PNG', 'image/png'), true)
  assert.equal(storedContentTypeMatches('image/svg+xml', 'image/png'), false)
})

test('업로드 토큰: 본인 행·같은 키·지금 멤버일 때만, 그 형식·알린 크기까지만 준다', () => {
  const key = boardWorkFilePath(UPLOAD, 'a.pdf')
  const pending = { blobPath: key, mime: 'application/pdf', size: 1234, draftMeta: null }
  const ok = decideUploadToken({ pathname: key, pending, canPost: true, maxBytes: 10_000 })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.grant, { allowedContentTypes: ['application/pdf'], maximumSizeInBytes: 1234 })

  // 없는·남의 업로드 id → 404(행 조회가 본인 것만 돌려준다)
  assert.equal(
    decideUploadToken({ pathname: key, pending: null, canPost: true, maxBytes: 10_000 }).status,
    404
  )
  // 다른 키로 토큰을 받으려 하면 403 — 비공개 저장소의 다른 영역에 쓰지 못한다
  for (const other of [
    'backups/dump.sql',
    `board-work/files/${UPLOAD}/b.pdf`,
    `board-work/renders/${ATTACH}-v1.json`,
  ]) {
    assert.equal(
      decideUploadToken({ pathname: other, pending, canPost: true, maxBytes: 10_000 }).status,
      403,
      other
    )
  }
  // 준비 뒤 채널에서 빠졌거나 보관됨 → 403
  assert.equal(
    decideUploadToken({ pathname: key, pending, canPost: false, maxBytes: 10_000 }).status,
    403
  )
  // 문서 초안 행(3단계)에는 일반 토큰을 주지 않는다
  assert.equal(
    decideUploadToken({
      pathname: key,
      pending: { ...pending, draftMeta: { kind: 'doc-edit' } },
      canPost: true,
      maxBytes: 10_000,
    }).status,
    403
  )
  assert.equal(
    decideUploadToken({
      pathname: key,
      pending: { ...pending, size: 20_000 },
      canPost: true,
      maxBytes: 10_000,
    }).status,
    400
  )
  // 0바이트는 상한 0(=상한 없음으로 읽힐 수 있다) 대신 1
  assert.equal(
    decideUploadToken({
      pathname: key,
      pending: { ...pending, size: 0 },
      canPost: true,
      maxBytes: 10_000,
    }).grant.maximumSizeInBytes,
    1
  )
})

test('CSP: 브라우저 직접 업로드 호스트(https://vercel.com)가 prod·dev connect-src 에 있다', async () => {
  const { createRequire } = await import('node:module')
  const { buildCsp } = createRequire(import.meta.url)('../../src/config/cspPolicy.js')
  for (const dev of [false, true]) {
    const line = buildCsp({ dev })
      .split('; ')
      .find(d => d.startsWith('connect-src '))
    assert.match(line, /https:\/\/vercel\.com(\s|$)/)
  }
})

test('파일 라우트: PDF 미리보기 라우트만 같은 출처 프레임을 허용하고, 나머지는 DENY 다', () => {
  const display = readFileSync('src/app/api/board-room/work/files/[id]/[name]/route.ts', 'utf8')
  const stream = readFileSync('src/app/api/board-room/work/files/[id]/route.ts', 'utf8')
  const shared = readFileSync('src/work/lib/files/file-response.ts', 'utf8')
  assert.match(display, /SAME_ORIGIN_FRAMEABLE/)
  assert.doesNotMatch(stream, /SAME_ORIGIN_FRAMEABLE|TEXT_FRAMEABLE/)
  assert.match(
    shared,
    /'X-Frame-Options': 'SAMEORIGIN',\s*'Content-Security-Policy': "frame-ancestors 'self'"/
  )
  assert.match(
    shared,
    /'X-Frame-Options': 'DENY',\s*'Content-Security-Policy': "frame-ancestors 'none'"/
  )
  // 모든 파일 응답은 캐시하지 않는다(권한을 요청마다 다시 판정한다)
  assert.match(shared, /'Cache-Control': 'private, no-store'/)
})
