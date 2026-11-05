import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 업무툴 문서 본문 추출(4단계, 설계 §8-2) — 이식한 `src/work/lib/files/extract-text.ts`를 실제 kordoc 으로 돌린다.
 * 픽스처는 원본 kosmart-work `public/doc-templates/blank.*`(빈 서식, 2a 렌더 테스트와 같은 파일)이고, 찾을 문구는
 * 테스트가 ZIP 안 XML 에 넣는다(개인 파일을 쓰지 않는다 — boardWorkRender.test.mjs 와 같은 방식). 원본 Jest
 * `__tests__/lib/files/extract-text.test.ts`의 순수 규칙 케이스도 함께 옮겼다.
 */
const X = await import('../../src/work/lib/files/extract-text.ts')
const T = await import('../../src/work/lib/search/text.ts')
const D = await import('../../src/work/lib/search/documents.ts')

const FIXTURES = new URL('./fixtures/board-work/', import.meta.url)
const fixture = name => readFileSync(new URL(name, FIXTURES))
const PHRASE = '이사회 정관 개정 검색 시험 문장'

async function rewriteZip(buffer, entry, edit) {
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file(entry).async('string')
  const next = edit(xml)
  assert.notEqual(next, xml, `${entry}에 시험 문구를 넣지 못했다`)
  zip.file(entry, next)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

/** 한 쪽짜리 최소 PDF(ASCII 글자) — e2e/board-work-files.spec.ts 와 같은 방식 */
function tinyPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    (() => {
      const stream = `BT /F1 12 Tf 20 50 Td (${text}) Tj ET`
      return `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    })(),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(body))
    body += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

// ── 실제 문서(빈 서식 + 넣은 문구) ────────────────────────────────────────────

test('DOCX: 넣은 문구가 평문 본문으로 나온다', async () => {
  const docx = await rewriteZip(fixture('blank.docx'), 'word/document.xml', xml =>
    xml.replace('<w:body>', `<w:body><w:p><w:r><w:t>${PHRASE}</w:t></w:r></w:p>`)
  )
  const out = await X.extractText(docx, '정관.docx')
  assert.equal(out.status, 'ok', JSON.stringify(out))
  assert.match(out.content, new RegExp(PHRASE))
  assert.equal(out.truncated, false)
})

test('HWPX: 넣은 문구가 평문 본문으로 나온다', async () => {
  const hwpx = await rewriteZip(fixture('blank.hwpx'), 'Contents/section0.xml', xml =>
    xml.replace('<hp:t></hp:t>', `<hp:t>${PHRASE}</hp:t>`)
  )
  const out = await X.extractText(hwpx, '정관.hwpx')
  assert.equal(out.status, 'ok', JSON.stringify(out))
  assert.match(out.content, new RegExp(PHRASE))
})

test('XLSX: 셀 문구가 표 기호 없이 나온다', async () => {
  const xlsx = await rewriteZip(fixture('blank.xlsx'), 'xl/worksheets/sheet1.xml', xml =>
    xml.replace(
      '<sheetData/>',
      `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>항목</t></is></c><c r="B1" t="inlineStr"><is><t>${PHRASE}</t></is></c></row></sheetData>`
    )
  )
  const out = await X.extractText(xlsx, '예산.xlsx')
  assert.equal(out.status, 'ok', JSON.stringify(out))
  assert.match(out.content, new RegExp(PHRASE))
  assert.doesNotMatch(out.content, /\|/)
})

test('PDF: pdfjs-dist 로 글자를 읽는다(추출 라우트가 번들에 남기는 이유)', async () => {
  const out = await X.extractText(tinyPdf('Board bylaws revision 2026 search check'), '정관.pdf')
  assert.equal(out.status, 'ok', JSON.stringify(out))
  assert.match(out.content, /bylaws revision 2026/)
})

test('빈 서식(blank.*)은 글자가 없어 unsupported — 스캔본과 같은 취급', async () => {
  for (const name of ['blank.docx', 'blank.hwpx', 'blank.xlsx']) {
    const out = await X.extractText(fixture(name), name)
    assert.ok(['unsupported', 'ok'].includes(out.status), `${name}: ${JSON.stringify(out)}`)
    if (out.status === 'ok') assert.ok(out.content.replace(/\s/g, '').length >= 8)
  }
})

test('HWP(OLE) 표본도 던지지 않고 상태로 돌려준다', async () => {
  const out = await X.extractText(fixture('sample.hwp'), '표본.hwp')
  assert.ok(['ok', 'unsupported'].includes(out.status), JSON.stringify(out))
})

test('PPTX 는 추출 대상이 아니다(원본과 같다 — 미리보기 변환기는 따로 있다)', async () => {
  assert.equal(X.isExtractable('발표.pptx'), false)
  assert.deepEqual(await X.extractText(fixture('blank.pptx'), '발표.pptx'), {
    status: 'unsupported',
  })
})

// ── 원본 순수 규칙(extract-text.test.ts) ──────────────────────────────────────

test('isExtractable / EXTRACT_EXTENSIONS', () => {
  for (const n of ['a.hwp', 'a.HWPX', 'a.docx', 'a.xlsx', 'a.xls', 'a.pdf', 'a.txt', 'a.csv'])
    assert.equal(X.isExtractable(n), true, n)
  for (const n of ['a.png', 'a.zip', 'a.pptx', 'noext', 'a.mp4'])
    assert.equal(X.isExtractable(n), false, n)
  for (const e of X.EXTRACT_EXTENSIONS) {
    assert.equal(e, e.toLowerCase())
    assert.equal(X.isExtractable(`x.${e}`), true)
  }
  assert.equal(X.extensionOf('a.b.PDF'), 'pdf')
})

test('toSearchText: 표 구분선·파이프·제목 표식·강조를 걷어내고 빈 줄을 줄인다', () => {
  const md = [
    '# 2025 총회',
    '',
    '**안건** 제1호',
    '',
    '| 항목 | 금액 |',
    '| --- | --- |',
    '| 인건비 | 100 |',
    '',
    '> 인용문 *[그림]* 끝',
  ].join('\n')
  const text = X.toSearchText(md)
  for (const s of ['2025 총회', '안건 제1호', '항목 금액', '인건비 100', '인용문'])
    assert.ok(text.includes(s), s)
  assert.doesNotMatch(text, /\||---|\*\*|\[그림\]/)
  assert.equal(X.toSearchText('가\n\n\n\n나'), '가\n\n나')
})

test('decodeTextFile: UTF-8(BOM) · 깨지면 EUC-KR', () => {
  assert.equal(X.decodeTextFile(Buffer.from('﻿안녕하세요', 'utf8')), '안녕하세요')
  assert.equal(X.decodeTextFile(Buffer.from([0xc7, 0xd1, 0xb1, 0xdb])), '한글')
})

test('extractText: 텍스트·짧은 본문·상한·too_large·미지원·NUL·서로게이트', async () => {
  assert.deepEqual(await X.extractText(Buffer.from('2025년 정기총회 안건 심의 결과'), '회의.txt'), {
    status: 'ok',
    content: '2025년 정기총회 안건 심의 결과',
    truncated: false,
  })
  assert.deepEqual(await X.extractText(Buffer.from('  \n '), 'a.txt'), { status: 'unsupported' })

  const big = await X.extractText(Buffer.from('가'.repeat(X.EXTRACT_MAX_CHARS + 500)), 'big.txt')
  assert.equal(big.status, 'ok')
  assert.equal(big.truncated, true)
  assert.equal(big.content.length, X.EXTRACT_MAX_CHARS)

  const huge = { length: X.EXTRACT_MAX_BYTES + 1 }
  assert.deepEqual(await X.extractText(huge, 'a.pdf'), { status: 'too_large' })
  assert.deepEqual(await X.extractText(Buffer.from('x'), 'a.png'), { status: 'unsupported' })

  const nul = await X.extractText(Buffer.from('안녕\u0000하세요 반갑습니다'), 'a.txt')
  assert.equal(nul.content, '안녕하세요 반갑습니다')
  const clean = X.cleanExtractedText('가\uD835나\uDC00다😀라')
  assert.equal(clean, '가나다😀라')
  assert.equal(clean.isWellFormed(), true)
  assert.equal(X.cleanExtractedText('끝에서 잘림\uD83D'), '끝에서 잘림')
})

test('손상된 docx 는 던지지 않고 failed/unsupported, 시간 제한을 넘으면 failed(timeout)', async () => {
  const broken = await X.extractText(Buffer.from('not a zip at all'), 'a.docx')
  assert.ok(['failed', 'unsupported'].includes(broken.status))
  const slow = await X.extractText(fixture('blank.xlsx'), 'a.xlsx', { timeoutMs: 0 })
  assert.deepEqual(slow, { status: 'failed', reason: 'timeout' })
  await new Promise(r => setTimeout(r, 300))
})

test('extractorVersion 은 kordoc 버전과 후처리 규칙 버전을 담는다', async () => {
  assert.match(await X.extractorVersion(), /^kordoc\d+\.\d+\.\d+-x\d+$/)
})

// ── 검색 스니펫(원본 lib/search/text.test.ts 일부 + ggac 문서 창) ────────────

test('splitTerms: 연산자·따옴표를 걷고 8개까지', () => {
  assert.deepEqual(T.splitTerms('"정관" OR (개정) -안 +초안'), ['정관', '개정', '안', '초안'])
  assert.deepEqual(T.splitTerms('   '), [])
  assert.equal(T.splitTerms('a b c d e f g h i j').length, 8)
})

test('highlightSegments: 대소문자 무시·겹침 병합·HTML 은 글자 그대로', () => {
  assert.deepEqual(T.highlightSegments('Budget budget', ['BUDGET']), [
    { text: 'Budget', match: true },
    { text: ' ', match: false },
    { text: 'budget', match: true },
  ])
  assert.deepEqual(T.highlightSegments('정관개정', ['정관', '관개']), [
    { text: '정관개', match: true },
    { text: '정', match: false },
  ])
  const html = T.highlightSegments('<b>정관</b>', ['정관'])
  assert.equal(html.map(s => s.text).join(''), '<b>정관</b>')
})

test('documentSnippet: 본문 중간의 창이면 앞뒤에 … 를 붙이고, 첫 일치를 앞쪽 1/3 에 둔다', () => {
  const window = `${'가'.repeat(120)} 정관 개정 ${'나'.repeat(400)}`
  const s = D.documentSnippet({ window, window_at_start: false, window_has_more: true }, ['정관'])
  assert.ok(s.startsWith('…') && s.endsWith('…'), s)
  assert.ok(s.includes('정관 개정'))
  assert.ok(s.length <= 204, String(s.length))
  const head = D.documentSnippet(
    { window: '짧은 본문 정관', window_at_start: true, window_has_more: false },
    ['정관']
  )
  assert.equal(head, '짧은 본문 정관')
})

test('mergeDocumentHits: 이름·본문이 둘 다 맞으면 파일에 스니펫, 본문만 맞으면 문서로', () => {
  const merged = D.mergeDocumentHits(
    [{ id: 'a' }, { id: 'b' }],
    [
      { id: 'a', snippet: 'A 스니펫' },
      { id: 'c', snippet: 'C 스니펫' },
    ],
    d => d.snippet
  )
  assert.deepEqual(merged.files, [{ id: 'a', snippet: 'A 스니펫' }, { id: 'b' }])
  assert.deepEqual(
    merged.documents.map(d => d.id),
    ['c']
  )
})

// ── 웹 본문용 마크다운(이사회 서류 앱 편집 — docs/board-work/05-이사회-서류-앱-편집.md §5) ─────────────────

test('extractMarkdown: DOCX 문구가 마크다운 본문으로 나오고, 표는 표 기호를 남긴다', async () => {
  const docx = await rewriteZip(fixture('blank.docx'), 'word/document.xml', xml =>
    xml.replace('<w:body>', `<w:body><w:p><w:r><w:t>${PHRASE}</w:t></w:r></w:p>`)
  )
  const out = await X.extractMarkdown(docx, '정관.docx')
  assert.equal(out.status, 'ok', JSON.stringify(out))
  assert.match(out.markdown, new RegExp(PHRASE))

  const xlsx = await rewriteZip(fixture('blank.xlsx'), 'xl/worksheets/sheet1.xml', xml =>
    xml.replace(
      '<sheetData/>',
      `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>항목</t></is></c><c r="B1" t="inlineStr"><is><t>${PHRASE}</t></is></c></row></sheetData>`
    )
  )
  const sheet = await X.extractMarkdown(xlsx, '예산.xlsx')
  assert.equal(sheet.status, 'ok', JSON.stringify(sheet))
  assert.match(sheet.markdown, /\|/, '검색 본문과 달리 표 모양을 남긴다')
})

test('extractMarkdown: HWPX 문구, 텍스트 파일은 그대로, 대상 밖·빈 서식은 ok 가 아니다', async () => {
  const hwpx = await rewriteZip(fixture('blank.hwpx'), 'Contents/section0.xml', xml =>
    xml.replace('<hp:t></hp:t>', `<hp:t>${PHRASE}</hp:t>`)
  )
  const out = await X.extractMarkdown(hwpx, '정관.hwpx')
  assert.equal(out.status, 'ok', JSON.stringify(out))
  assert.match(out.markdown, new RegExp(PHRASE))

  const md = await X.extractMarkdown(Buffer.from(`# 제목\n\n${PHRASE}\n`), '본문.md')
  assert.deepEqual(md, { status: 'ok', markdown: `# 제목\n\n${PHRASE}` })

  assert.deepEqual(await X.extractMarkdown(fixture('blank.pptx'), '발표.pptx'), {
    status: 'unsupported',
  })
  const blank = await X.extractMarkdown(fixture('blank.docx'), '빈.docx')
  assert.notEqual(blank.status, 'ok')
  // 실패해도 던지지 않는다
  const broken = await X.extractMarkdown(Buffer.from('not a zip'), '깨짐.docx')
  assert.notEqual(broken.status, 'ok')
})
