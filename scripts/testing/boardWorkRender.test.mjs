import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'

import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 업무툴 문서 미리보기 변환(kordoc) — 이식한 `src/work/lib/files/render-*.ts`를 실제로 돌린다(설계 §7-3·§7-5).
 * 픽스처는 원본 kosmart-work `public/doc-templates/blank.*`(빈 서식)를 옮긴 것이고, 시험 문구는 테스트가 ZIP 안 XML 에
 * 넣는다(개인 파일을 쓰지 않는다). 렌더 라우트가 쓰는 같은 함수 — convertDocument(Markdown·시트)·renderLayoutRange(쪽 SVG).
 */
const { convertDocument, renderFormatOf } = await import(
  '../../src/work/lib/files/render-document.ts'
)
const { renderLayoutRange, rangeToManifest } = await import(
  '../../src/work/lib/files/render-layout.ts'
)
const { RenderError, isLayoutFile } = await import('../../src/work/lib/files/render-types.ts')

const FIXTURES = new URL('./fixtures/board-work/', import.meta.url)
const fixture = name => readFileSync(new URL(name, FIXTURES))
const PHRASE = '이사회 업무툴 렌더 시험 문장'

/** ZIP 안 한 파일의 XML 을 바꿔 다시 묶는다 */
async function rewriteZip(buffer, entry, edit) {
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file(entry).async('string')
  const next = edit(xml)
  assert.notEqual(next, xml, `${entry}에 시험 문구를 넣지 못했다`)
  zip.file(entry, next)
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

test('DOCX: 본문 문단이 Markdown 으로 나온다', async () => {
  const docx = await rewriteZip(fixture('blank.docx'), 'word/document.xml', xml =>
    xml.replace('<w:body>', `<w:body><w:p><w:r><w:t>${PHRASE}</w:t></w:r></w:p>`)
  )
  assert.equal(renderFormatOf('회의록.docx'), 'document')
  const out = await convertDocument(docx, '회의록.docx')
  assert.equal(out.kind, 'document')
  assert.match(out.markdown, new RegExp(PHRASE))
})

test('HWPX: 본문이 Markdown 으로 나오고, 쪽 레이아웃은 SVG 로 그려진다', async () => {
  const hwpx = await rewriteZip(fixture('blank.hwpx'), 'Contents/section0.xml', xml =>
    xml.replace('<hp:t></hp:t>', `<hp:t>${PHRASE}</hp:t>`)
  )
  const md = await convertDocument(hwpx, '정관.hwpx')
  assert.equal(md.kind, 'document')
  assert.match(md.markdown, new RegExp(PHRASE))

  assert.equal(isLayoutFile('정관.hwpx'), true)
  const range = await renderLayoutRange(hwpx, '정관.hwpx', { from: 1, to: 1 })
  const manifest = rangeToManifest(range)
  assert.ok(manifest.pages.length >= 1, '쪽 목록이 비면 안 된다')
  const svg = range.svgs.get(1)
  assert.ok(typeof svg === 'string' && svg.includes('<svg'), '1쪽 SVG 가 없다')
  // 쪽 SVG 는 <img>로만 쓰인다 — 스크립트가 섞이면 안 된다(라우트도 sandbox CSP 를 붙인다)
  assert.doesNotMatch(svg, /<script/i)
})

test('XLSX: 시트가 표로 나온다', async () => {
  const out = await convertDocument(fixture('blank.xlsx'), '예산.xlsx')
  assert.equal(out.kind, 'sheets')
  assert.ok(Array.isArray(out.sheets) && out.sheets.length >= 1)
})

test('PPTX: 직접 구현한 변환기가 슬라이드를 읽는다', async () => {
  const out = await convertDocument(fixture('blank.pptx'), '발표.pptx')
  assert.equal(out.kind, 'document')
  assert.equal(typeof out.markdown, 'string')
})

test('지원하지 않는 형식·깨진 파일은 RenderError 로 거절한다(라우트가 4xx 로 바꾼다)', async () => {
  await assert.rejects(
    convertDocument(Buffer.from('hello'), 'a.txt'),
    e => e instanceof RenderError && e.code === 'unsupported'
  )
  await assert.rejects(
    convertDocument(Buffer.from('PK\u0003\u0004 not really a zip'), '깨진.docx'),
    e => e instanceof RenderError
  )
  await assert.rejects(
    renderLayoutRange(Buffer.from('x'), 'a.docx', { from: 1, to: 1 }),
    e => e instanceof RenderError && e.code === 'unsupported'
  )
})
