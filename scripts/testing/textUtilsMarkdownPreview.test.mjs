import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * F1 회귀 방어: 게시판 목록 미리보기(`createTextPreview`)가 마크다운 게시글의
 * 원문 문법(헤딩·링크·이스케이프)을 그대로 노출하던 문제.
 *
 * `content_format`이 `'markdown'`일 때만 벗겨내야 한다 — 무조건 적용하면
 * `[x](y)`를 정당하게 쓰는 기존 평문 게시글을 조용히 고쳐 쓴다. 그래서
 * "게이트가 실제로 걸리는가"를 양쪽 다(마크다운/비마크다운) 확인한다.
 */
const { createTextPreview, stripMarkdownSyntax } = await import('../../src/utils/textUtils.ts')

// -------------------------------------------------------------------------
// stripMarkdownSyntax 단위 확인
// -------------------------------------------------------------------------

test('stripMarkdownSyntax: ATX 헤딩 마커를 제거한다', () => {
  assert.equal(stripMarkdownSyntax('### 제목입니다'), '제목입니다')
})

test('stripMarkdownSyntax: 링크 문법을 라벨만 남기고 벗긴다', () => {
  assert.equal(
    stripMarkdownSyntax('[경기문화재단 공고](https://www.ggcf.kr/archives/12345)'),
    '경기문화재단 공고'
  )
})

test('stripMarkdownSyntax: 이스케이프된 대괄호가 섞인 링크 라벨도 올바르게 벗긴다 (grantDigest.escapeMarkdown 실제 출력)', () => {
  // src/lib/server/grantDigest.ts의 escapeMarkdown이 만드는 실제 형태:
  // 제목 자체의 [ ]는 이스케이프되고, 링크 문법의 바깥 [ ]( )는 이스케이프되지 않는다.
  const raw =
    '### [\\[2026년\\] 경기문화재단 음악 창작지원 (1차)](https://www.ggcf.kr/archives/12345)'
  assert.equal(stripMarkdownSyntax(raw), '[2026년] 경기문화재단 음악 창작지원 (1차)')
})

test('stripMarkdownSyntax: 목록 마커를 제거한다', () => {
  assert.equal(stripMarkdownSyntax('- 마감: D-44 (2026-10-15)'), '마감: D-44 (2026-10-15)')
})

test('stripMarkdownSyntax: 강조(볼드/이탤릭/코드) 마커를 제거한다', () => {
  assert.equal(
    stripMarkdownSyntax('**굵게** *기울임* `코드` __굵게2__ _기울임2_'),
    '굵게 기울임 코드 굵게2 기울임2'
  )
})

test('stripMarkdownSyntax: 수평선을 제거한다', () => {
  assert.equal(stripMarkdownSyntax('본문\n\n---\n\n꼬리말'), '본문\n\n\n\n꼬리말')
})

// -------------------------------------------------------------------------
// createTextPreview: content_format 게이트
// -------------------------------------------------------------------------

test('createTextPreview: content_format이 markdown이면 마크다운 문법을 벗긴다 (실제 지원사업 회차 원문)', () => {
  const raw =
    '2026-W36 기준 경기·서울 음악 분야 지원사업입니다.\n\n' +
    '### [\\[2026년\\] 경기문화재단 음악 창작지원 (1차)](https://www.ggcf.kr/archives/12345)\n\n' +
    '- 마감: D-44 (2026-10-15)\n' +
    '- 분류: 경기 · 음악 · 창작지원'

  const preview = createTextPreview(raw, 200, 'markdown')

  assert.ok(!preview.text.includes('\\['), `백슬래시가 남아있으면 안 된다: ${preview.text}`)
  assert.ok(!preview.text.includes('### '), `헤딩 마커가 남아있으면 안 된다: ${preview.text}`)
  assert.ok(!preview.text.includes(']('), `링크 문법이 남아있으면 안 된다: ${preview.text}`)
  assert.ok(
    preview.text.includes('[2026년] 경기문화재단 음악 창작지원 (1차)'),
    `제목이 대괄호 원문 그대로 보여야 한다: ${preview.text}`
  )
})

test('회귀 방어: content_format이 markdown이 "아니면" 마크다운 문법을 벗기지 않는다 (기존 평문 게시글의 [x](y) 보존)', () => {
  const plainPostContent = '자세한 내용은 [공식 안내](https://example.com/notice) 참고하세요.'

  const withoutFormat = createTextPreview(plainPostContent, 200)
  const withPlainFormat = createTextPreview(plainPostContent, 200, 'plain')
  const withHtmlFormat = createTextPreview(plainPostContent, 200, 'html')

  for (const preview of [withoutFormat, withPlainFormat, withHtmlFormat]) {
    assert.equal(
      preview.text,
      plainPostContent,
      '마크다운이 아닌 게시글은 [x](y) 문법이 원문 그대로 남아야 한다'
    )
  }
})

test('createTextPreview: markdown 게이트는 대소문자·값 자체를 정확히 비교한다 (오탐 방지)', () => {
  const content = '[라벨](https://example.com)'
  // 'Markdown' 처럼 다른 대소문자나 알 수 없는 값은 게이트를 열지 않는다.
  assert.equal(createTextPreview(content, 200, 'Markdown').text, content)
  assert.equal(createTextPreview(content, 200, 'unknown').text, content)
})
