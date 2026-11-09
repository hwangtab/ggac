import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import JSZip from 'jszip'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)
const require = createRequire(import.meta.url)

/**
 * 이사회 업무툴 3단계(문서 버전·앱 안 편집)의 순수 규칙 — 편집기가 돌려준 저장본 검사(매직 바이트·크기·확장자),
 * HWP·HWPX 저장본 서버 검증(kordoc 으로 다시 읽기·블록 수·쪽 수 허용치·누름틀·개체 수), 편집기 출처 env 해석과 CSP.
 * 픽스처는 원본 kosmart-work `public/doc-templates/blank.*`(빈 서식)와 rhwp 저장소의 작은 공개 HWP 표본(`sample.hwp`)이다.
 * 개인 파일은 쓰지 않는다.
 */
const officeEdit = await import('../../src/work/lib/files/office-edit.ts')
const hwpEditor = await import('../../src/work/lib/files/hwp-editor.ts')
const docEdit = await import('../../src/work/lib/files/doc-edit.ts')
const types = await import('../../src/work/lib/files/doc-edit-types.ts')
const rules = await import('../../src/work/lib/files/version-rules.ts')
const createRules = await import('../../src/work/lib/files/create-rules.ts')

const FIXTURES = new URL('./fixtures/board-work/', import.meta.url)
const fixture = name => new Uint8Array(readFileSync(new URL(name, FIXTURES)))

function withEnv(vars, fn) {
  const saved = {}
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
  try {
    return fn()
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

// ── 오피스 편집기 저장본 검사 ────────────────────────────────────────────────

test('오피스 저장본: ZIP 매직·크기·확장자를 보고 이름·MIME 은 원본 기준으로 다시 만든다', async () => {
  const docx = fixture('blank.docx')
  const ok = await officeEdit.checkSavedOfficeFile(
    new File([docx], 'blank.docx', { type: 'text/plain' }),
    '안건.docx'
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.file.name, '안건.docx')
  assert.equal(
    ok.file.type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '편집기가 알려 준 MIME 을 믿지 않는다'
  )
  // 옛 형식(doc)은 OOXML 로 저장된다 — 이름의 확장자도 바뀐다
  const fromDoc = await officeEdit.checkSavedOfficeFile(new File([docx], 'x.docx'), '회의록.doc')
  assert.equal(fromDoc.ok, true)
  assert.equal(fromDoc.file.name, '회의록.docx')

  // 거부: Blob 아님·빈 파일·매직 불일치·확장자 불일치·상한 초과
  assert.equal((await officeEdit.checkSavedOfficeFile('nope', 'a.docx')).ok, false)
  assert.equal((await officeEdit.checkSavedOfficeFile(new File([], 'a.docx'), 'a.docx')).ok, false)
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
  const notZip = await officeEdit.checkSavedOfficeFile(new File([html], 'a.docx'), 'a.docx')
  assert.equal(notZip.ok, false)
  assert.match(notZip.error, /형식/)
  const wrongExt = await officeEdit.checkSavedOfficeFile(
    new File([fixture('blank.xlsx')], 'a.xlsx'),
    'a.docx'
  )
  assert.equal(wrongExt.ok, false)
  const huge = new Uint8Array(officeEdit.OFFICE_EDIT_MAX_BYTES + 1)
  huge.set([0x50, 0x4b, 0x03, 0x04])
  assert.equal(
    (await officeEdit.checkSavedOfficeFile(new File([huge], 'a.docx'), 'a.docx')).ok,
    false
  )
})

test('오피스 편집 진입 조건: 출처 env·확장자·50MB, 출처는 https(로컬은 http)만 받고 경로는 버린다', () => {
  withEnv({ NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: 'https://ggac-office.vercel.app/editor/' }, () => {
    assert.equal(officeEdit.getOfficeEditorOrigin(), 'https://ggac-office.vercel.app')
  })
  withEnv({ NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: 'http://evil.example' }, () => {
    assert.equal(officeEdit.getOfficeEditorOrigin(), null, '원격 http 는 받지 않는다')
  })
  withEnv({ NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: 'http://localhost:5173' }, () => {
    assert.equal(officeEdit.getOfficeEditorOrigin(), 'http://localhost:5173')
  })
  withEnv({ NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: undefined }, () => {
    assert.equal(officeEdit.getOfficeEditorOrigin(), null, 'env 가 없으면 기능을 숨긴다')
  })
  const origin = 'https://ggac-office.vercel.app'
  assert.equal(officeEdit.canOfferOfficeEdit({ fileName: 'a.pptx', size: 10, origin }), true)
  assert.equal(officeEdit.canOfferOfficeEdit({ fileName: 'a.hwp', size: 10, origin }), false)
  assert.equal(officeEdit.canOfferOfficeEdit({ fileName: 'a.docx', size: 10, origin: null }), false)
  assert.equal(
    officeEdit.canOfferOfficeEdit({
      fileName: 'a.docx',
      size: officeEdit.OFFICE_EDIT_MAX_BYTES + 1,
      origin,
    }),
    false
  )
  const src = officeEdit.officeEditorSrc(origin, 'http://127.0.0.1:3101')
  assert.equal(
    src,
    'https://ggac-office.vercel.app/editor?embed=1&embedOrigin=http%3A%2F%2F127.0.0.1%3A3101'
  )
  // 편집기 iframe 은 최상위 이동·팝업 탈출·폼 제출을 허용하지 않는다
  assert.doesNotMatch(officeEdit.OFFICE_IFRAME_SANDBOX, /top-navigation|escape-sandbox|allow-forms/)
  assert.doesNotMatch(officeEdit.OFFICE_IFRAME_SANDBOX, /allow-popups/)
  // 한글 편집기는 인쇄 미리보기 새 창만 더 연다 — 그 창도 sandbox 를 물려받는다(탈출·최상위 이동·폼 제출은 여전히 없다)
  assert.match(hwpEditor.HWP_IFRAME_SANDBOX, /(^| )allow-popups( |$)/)
  assert.doesNotMatch(hwpEditor.HWP_IFRAME_SANDBOX, /top-navigation|escape-sandbox|allow-forms/)
})

// ── HWP·HWPX 편집기 저장본 검사 ──────────────────────────────────────────────

test('HWP 저장본(브라우저): OLE2 매직·크기, 쪽 수 재확인 실패는 저장을 막는다', () => {
  const hwp = fixture('sample.hwp')
  const ok = hwpEditor.checkHwpExport(hwp, '보고서.hwp')
  assert.equal(ok.ok, true)
  assert.equal(ok.file.name, '보고서.hwp')
  assert.equal(hwpEditor.checkHwpExport(fixture('blank.hwpx'), '보고서.hwp').ok, false)
  assert.equal(hwpEditor.checkHwpExport(new Uint8Array(0), '보고서.hwp').ok, false)
  assert.equal(hwpEditor.checkHwpExport('x', '보고서.hwp').ok, false)

  assert.equal(
    hwpEditor.checkHwpVerify({ recovered: true, pageCountBefore: 6, pageCountAfter: 6 }),
    null
  )
  assert.equal(
    hwpEditor.checkHwpVerify({ recovered: true, pageCountBefore: 6, pageCountAfter: 7 }),
    hwpEditor.HWP_UNSAVABLE_MESSAGE
  )
  assert.equal(
    hwpEditor.checkHwpVerify({ recovered: false, pageCountBefore: 6, pageCountAfter: 6 }),
    hwpEditor.HWP_UNSAVABLE_MESSAGE
  )

  const hwpx = hwpEditor.checkHwpxExport(fixture('blank.hwpx'), '새 문서.hwpx')
  assert.equal(hwpx.ok, true)
  assert.equal(hwpx.file.type, hwpEditor.HWPX_MIME)
  assert.equal(hwpEditor.checkHwpxExport(hwp, '새 문서.hwpx').ok, false, 'OLE2 는 HWPX 가 아니다')
})

test('HWP·HWPX 편집 켜기: 출처 env + HWP 플래그(+ HWPX 플래그), 20MB 이하', () => {
  const on = {
    NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: 'https://ggac-office.vercel.app',
    NEXT_PUBLIC_HWP_EDITOR_ENABLED: '1',
    NEXT_PUBLIC_HWPX_EDITOR_ENABLED: undefined,
  }
  withEnv(on, () => {
    assert.equal(hwpEditor.getHwpStudioUrl(), 'https://ggac-office.vercel.app/rhwp/?chrome=embed')
    assert.equal(hwpEditor.canOfferHwpEdit({ fileName: 'a.hwp', size: 100 }), true)
    assert.equal(hwpEditor.canOfferHwpEdit({ fileName: 'a.hwpx', size: 100 }), false)
    assert.equal(hwpEditor.canOfferHwpEdit({ fileName: 'a.hwp', size: 21 * 1024 * 1024 }), false)
  })
  withEnv({ ...on, NEXT_PUBLIC_HWPX_EDITOR_ENABLED: '1' }, () => {
    assert.equal(hwpEditor.canOfferHwpEdit({ fileName: 'a.hwpx', size: 100 }), true)
  })
  withEnv({ ...on, NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: undefined }, () => {
    assert.equal(hwpEditor.getHwpStudioUrl(), null)
    assert.equal(hwpEditor.canOfferHwpEdit({ fileName: 'a.hwp', size: 100 }), false)
  })
  withEnv({ ...on, NEXT_PUBLIC_HWP_EDITOR_ENABLED: undefined }, () => {
    assert.equal(hwpEditor.canOfferHwpEdit({ fileName: 'a.hwp', size: 100 }), false)
  })
})

// ── 서버 검증(doc-edit — 실제 kordoc) ─────────────────────────────────────────

test('허용치: 블록 수 변화 max(5, 원본×20%) 초과·쪽 수 2쪽 이상 차이면 막는다(둘 다 알 때만)', () => {
  assert.equal(types.hwpBlockDriftLimit(10), 5)
  assert.equal(types.hwpBlockDriftLimit(100), 20)
  assert.equal(types.hwpBlockDriftBlocked(10, 15), false)
  assert.equal(types.hwpBlockDriftBlocked(10, 16), true)
  assert.equal(types.hwpBlockDriftBlocked(100, 80), false)
  assert.equal(types.hwpBlockDriftBlocked(100, 79), true)
  assert.equal(types.pageCountBlocked(6, 7), false)
  assert.equal(types.pageCountBlocked(6, 8), true)
  assert.equal(types.pageCountBlocked(null, 8), false)
  assert.equal(types.pageCountBlocked(6, null), false)
})

test('HWP 저장본 검증(kordoc): 같은 문서는 통과, HWP 가 아니면·원본을 못 읽으면 막는다', async () => {
  const hwp = fixture('sample.hwp')
  const same = await docEdit.inspectHwpEditorSave(hwp, hwp)
  assert.equal(same.blockedReason, null)
  assert.ok(same.originalBlocks !== null && same.originalBlocks === same.draftBlocks)

  const notHwp = await docEdit.inspectHwpEditorSave(hwp, fixture('blank.hwpx'))
  assert.equal(notHwp.blockedReason, types.BLOCKED_MESSAGE.notHwp)

  // OLE2 매직만 맞고 내용이 깨진 저장본 — 다시 읽기 실패로 막는다
  const broken = new Uint8Array(4096)
  broken.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  const reparse = await docEdit.inspectHwpEditorSave(hwp, broken)
  assert.notEqual(reparse.blockedReason, null)
})

test('HWPX 저장본 검증(kordoc): 빈 서식은 통과(새 문서·원본 비교 둘 다), ZIP 이 아니거나 깨지면 막는다', async () => {
  const hwpx = fixture('blank.hwpx')
  const asNew = await docEdit.inspectHwpxEditorSave(null, hwpx)
  assert.equal(asNew.blockedReason, null)
  const asVersion = await docEdit.inspectHwpxEditorSave(hwpx, hwpx)
  assert.equal(asVersion.blockedReason, null)
  assert.equal(types.hasObjectsDropped(asVersion.objectsDropped), false)

  const notHwpx = await docEdit.inspectHwpxEditorSave(hwpx, fixture('sample.hwp'))
  assert.notEqual(notHwpx.blockedReason, null)

  // 본문 XML 을 지운 패키지 — 유효성 검사·다시 읽기에서 막힌다
  const zip = await JSZip.loadAsync(hwpx)
  for (const name of Object.keys(zip.files)) if (/section\d+\.xml$/i.test(name)) zip.remove(name)
  const gutted = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
  const broken = await docEdit.inspectHwpxEditorSave(hwpx, gutted)
  assert.notEqual(broken.blockedReason, null)
})

test('개체 수 비교: 줄어든 표·그림만 경고로 돌려준다(막지 않는다)', () => {
  const before = { tables: 2, pictures: 1, shapes: 0, equations: 0 }
  const same = docEdit.droppedObjects(before, before)
  assert.equal(types.hasObjectsDropped(same), false)
  const fewer = docEdit.droppedObjects(before, { tables: 1, pictures: 0, shapes: 3, equations: 0 })
  assert.equal(types.hasObjectsDropped(fewer), true)
  assert.match(types.objectsDroppedMessage(fewer), /표 1개/)
  assert.match(types.objectsDroppedMessage(fewer), /그림 1개/)
})

test('초안 메타: 형식이 맞는 것만 초안으로 본다(저장 액션이 막힌 초안·다른 원본을 이 값으로 거부한다)', () => {
  const ok = {
    kind: 'doc-edit',
    mode: 'hwp-editor',
    sourceAttachmentId: crypto.randomUUID(),
    format: 'hwp',
    blocked: false,
    applied: 0,
    skipped: 0,
  }
  assert.equal(types.isDraftMeta(ok), true)
  assert.equal(types.isDraftMeta({ ...ok, kind: 'other' }), false)
  assert.equal(types.isDraftMeta({ ...ok, blocked: 'no' }), false)
  assert.equal(types.isDraftMeta(null), false)
  const newDoc = { ...ok, sourceAttachmentId: undefined, newDocument: true, format: 'hwpx' }
  delete newDoc.sourceAttachmentId
  assert.equal(types.isDraftMeta(newDoc), true)
})

// ── 버전·새 문서 순수 규칙 ────────────────────────────────────────────────────

test('편집 권한(순수): 게스트·비멤버·보관 채널·삭제된 게시물은 편집할 수 없다', () => {
  const ok = { isGuest: false, isMember: true }
  const target = { channelArchived: false, messageDeleted: false }
  assert.equal(rules.canEditFile(ok, target), true)
  assert.equal(rules.canEditFile({ ...ok, isMember: false }, target), false)
  assert.equal(rules.canEditFile({ ...ok, isGuest: true }, target), false)
  assert.equal(rules.canEditFile(ok, { ...target, channelArchived: true }), false)
  assert.equal(rules.canEditFile(ok, { ...target, messageDeleted: true }), false)
  assert.equal(rules.extensionsMatch('a.hwp', 'b.hwpx'), true)
  assert.equal(rules.extensionsMatch('a.docx', 'b.pdf'), false)
  assert.match(rules.versionUploadedBody('홍길동', '보고서.hwp', 3), /v3/)
  assert.match(rules.versionRestoredBody('홍길동', '보고서.hwp', 1, 4), /v1.*v4/)
})

test('새 문서: 이름 정리·확장자 고정·형식별 MIME, 주소는 /edit/new(업무툴 경로는 내비 래퍼가 붙인다)', () => {
  assert.equal(createRules.normalizeCreateFileName('회의록.docx', 'docx'), '회의록.docx')
  assert.equal(createRules.normalizeCreateFileName('회의록', 'xlsx'), '회의록.xlsx')
  assert.equal(createRules.normalizeCreateFileName('   ', 'pptx'), null)
  assert.equal(
    createRules.createMimeFor('docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
  assert.equal(createRules.createMimeFor('hwpx'), hwpEditor.HWPX_MIME)
  const channel = crypto.randomUUID()
  const href = createRules.createDocumentHref({ channelId: channel, type: 'docx', name: '새 문서' })
  assert.ok(href.startsWith('/edit/new?'), href)
  assert.ok(href.includes(`channel=${channel}`))
  // 공지 채널 최상위는 owner·관리자만, 스레드 안은 누구나(멤버)
  const actor = {
    isGuest: false,
    isMember: true,
    archived: false,
    postPolicy: 'owners',
    isChannelOwner: false,
    isAdmin: false,
  }
  assert.notEqual(createRules.createDeniedMessage({ ...actor, inThread: false }), null)
  assert.equal(createRules.createDeniedMessage({ ...actor, inThread: true }), null)
  assert.notEqual(
    createRules.createDeniedMessage({
      ...actor,
      postPolicy: 'everyone',
      isMember: false,
      inThread: false,
    }),
    null
  )
})

// ── CSP: 편집기 출처는 env 에서 온다 ─────────────────────────────────────────

async function nextConfigFrameSrc(env) {
  return withEnv(env, async () => {
    // next.config.js 는 CommonJS 라 import 캐시가 쿼리 문자열을 무시한다 — require 캐시를 비우고 다시 읽는다
    const path = require.resolve('../../next.config.js')
    delete require.cache[path]
    const cfg = require(path)
    const headers = await cfg.headers()
    const csp = headers
      .flatMap(h => h.headers)
      .map(h => h.value)
      .find(v => typeof v === 'string' && v.includes('frame-src'))
    return (
      csp
        ?.split(';')
        .map(s => s.trim())
        .find(s => s.startsWith('frame-src')) ?? null
    )
  })
}

test('CSP(next.config.js): 편집기 출처 env 가 있으면 frame-src 에 더하고, 없거나 원격 http 면 더하지 않는다', async () => {
  const withOrigin = await nextConfigFrameSrc({
    NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: 'https://ggac-office.vercel.app',
  })
  assert.ok(withOrigin, 'frame-src 를 찾지 못했다')
  assert.match(withOrigin, /https:\/\/ggac-office\.vercel\.app/)
  assert.match(withOrigin, /tosspayments\.com/, '기존 출처는 그대로')
  const without = await nextConfigFrameSrc({ NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: undefined })
  assert.doesNotMatch(without, /ggac-office/)
  const bad = await nextConfigFrameSrc({ NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN: 'http://evil.example' })
  assert.doesNotMatch(bad, /evil/)
})

test('CSP(미들웨어): frame-src 가 같은 env 판정(getOfficeEditorOrigin)을 공유 모듈로 넘긴다', async () => {
  const src = readFileSync(new URL('../../src/middleware/csp.ts', import.meta.url), 'utf8')
  assert.match(src, /officeOrigin: getOfficeEditorOrigin\(\)/)
  const { createRequire } = await import('node:module')
  const { buildCsp } = createRequire(import.meta.url)('../../src/config/cspPolicy.js')
  const frame = buildCsp({ officeOrigin: 'https://o.example' })
    .split('; ')
    .find(d => d.startsWith('frame-src '))
  assert.match(frame, / https:\/\/o\.example$/)
})
