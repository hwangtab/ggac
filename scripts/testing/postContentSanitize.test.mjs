import { test } from 'node:test'
import assert from 'node:assert/strict'

// Node 24 타입스트리핑으로 .ts 순수 함수를 직접 import (imageDimensions.test.mjs와 동일 방식).
// 이 sanitizer는 jsdom을 쓰지 않는 sanitize-html(순수 JS) 기반이라 서버·클라 동일하게 동작한다.
const { sanitizePostHtml } = await import('../../src/utils/sanitizePostHtml.ts')

// --- 허용 태그·속성 보존 (Quill 렌더 충실도) ---

test('기본 서식 태그·링크(href/target) 보존', () => {
  const html = '<p><strong>굵게</strong> <a href="https://x.com" target="_blank">링크</a></p>'
  const out = sanitizePostHtml(html)
  assert.match(out, /<strong>굵게<\/strong>/)
  assert.match(out, /href="https:\/\/x\.com"/)
  assert.match(out, /target="_blank"/)
  assert.match(out, /링크/)
})

test('em/u/s/br 보존', () => {
  const html = '<p><em>i</em><u>u</u><s>s</s><br></p>'
  const out = sanitizePostHtml(html)
  assert.match(out, /<em>i<\/em>/)
  assert.match(out, /<u>u<\/u>/)
  assert.match(out, /<s>s<\/s>/)
  assert.match(out, /<br/)
})

test('img의 src/alt/width/height 모두 보존 (C2 CLS 예약 필수)', () => {
  const html = '<img src="https://proj.supabase.co/a.jpg" alt="a" width="800" height="600">'
  const out = sanitizePostHtml(html)
  assert.match(out, /src="https:\/\/proj\.supabase\.co\/a\.jpg"/)
  assert.match(out, /alt="a"/)
  assert.match(out, /width="800"/)
  assert.match(out, /height="600"/)
})

test('대형 이미지 width="2048" 값 그대로 보존 (실제 게시글 회귀)', () => {
  const html = '<img src="https://proj.supabase.co/big.jpg" width="2048" height="1536">'
  const out = sanitizePostHtml(html)
  assert.match(out, /width="2048"/)
  assert.match(out, /height="1536"/)
})

test('표(table/thead/tbody/tr/td/th) 보존', () => {
  const html = '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>'
  const out = sanitizePostHtml(html)
  for (const tag of ['table', 'thead', 'tbody', 'tr', 'th', 'td']) {
    assert.match(out, new RegExp(`<${tag}`), `${tag} 보존`)
  }
})

test('목록(ul/ol/li)·blockquote·h1~h6·div·span·class 보존', () => {
  const html =
    '<ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote>' +
    '<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>' +
    '<div class="wrap"><span class="hl">s</span></div>'
  const out = sanitizePostHtml(html)
  for (const tag of [
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'div',
    'span',
  ]) {
    assert.match(out, new RegExp(`<${tag}`), `${tag} 보존`)
  }
  assert.match(out, /class="wrap"/)
  assert.match(out, /class="hl"/)
})

test('data-list/data-indent/data-checked 보존 (Quill)', () => {
  const html = '<ol><li data-list="bullet" data-indent="1" data-checked="true">x</li></ol>'
  const out = sanitizePostHtml(html)
  assert.match(out, /data-list="bullet"/)
  assert.match(out, /data-indent="1"/)
  assert.match(out, /data-checked="true"/)
})

// '*'(전역) 속성과 태그별 속성의 병합(merge) 시맨틱 고정.
// div/span은 태그별 속성목록이 없어 어느 시맨틱(merge/override)이든 class를 유지하므로
// 회귀를 못 잡는다. a·img처럼 태그별 목록이 있는 태그에서 '*'의 class/title도 함께
// 살아남는지 단언 → 만약 override 시맨틱으로 바뀌면 Quill class가 조용히 사라지며 실패한다.
test("a: 태그별(href/target)과 '*'(class/title) 속성이 함께 병합 보존", () => {
  const out = sanitizePostHtml('<a href="https://x.com" class="ql-link" title="t">x</a>')
  assert.match(out, /href="https:\/\/x\.com"/)
  assert.match(out, /class="ql-link"/)
  assert.match(out, /title="t"/)
})

test("img: 태그별(src/width/height)과 '*'(class) 속성이 함께 병합 보존", () => {
  const out = sanitizePostHtml(
    '<img src="https://proj.supabase.co/a.jpg" class="ql-img" width="800" height="600">'
  )
  assert.match(out, /src="https:\/\/proj\.supabase\.co\/a\.jpg"/)
  assert.match(out, /class="ql-img"/)
  assert.match(out, /width="800"/)
  assert.match(out, /height="600"/)
})

// --- XSS 벡터 차단 ---

test('<script> 완전 제거 (내용 포함)', () => {
  const out = sanitizePostHtml('<p>ok</p><script>alert(1)</script>')
  assert.doesNotMatch(out, /<script/i)
  assert.doesNotMatch(out, /alert\(1\)/)
  assert.match(out, /<p>ok<\/p>/)
})

test('img onerror 제거 (태그·src는 유지)', () => {
  const out = sanitizePostHtml('<img src="x" onerror="alert(1)">')
  assert.doesNotMatch(out, /onerror/i)
  assert.doesNotMatch(out, /alert\(1\)/)
  assert.match(out, /<img/)
})

test('javascript: href 무력화 (텍스트는 보존)', () => {
  const out = sanitizePostHtml('<a href="javascript:alert(1)">x</a>')
  assert.doesNotMatch(out, /javascript:/i)
  assert.match(out, />x</)
})

test('vbscript: href 무력화', () => {
  const out = sanitizePostHtml('<a href="vbscript:msgbox(1)">x</a>')
  assert.doesNotMatch(out, /vbscript:/i)
  assert.match(out, />x</)
})

test('data:text/html src 차단 (src 속성 자체가 제거됨)', () => {
  const out = sanitizePostHtml('<img src="data:text/html,<script>alert(1)</script>">')
  assert.doesNotMatch(out, /data:text\/html/i)
  // 문자열만 사라지는 게 아니라 src 속성 자체가 드롭되어야 한다(다른 src로 남으면 안 됨).
  assert.doesNotMatch(out, /src=/i)
})

test('img src="javascript:..." 완전 차단 (src 속성 드롭)', () => {
  // 최고위험 벡터: 허용 스킴이 아니면 sanitize-html이 src 속성을 통째로 제거한다(<img />).
  const out = sanitizePostHtml('<img src="javascript:alert(1)">')
  assert.doesNotMatch(out, /javascript:/i)
  assert.doesNotMatch(out, /alert\(1\)/)
  assert.doesNotMatch(out, /src=/i)
})

test('iframe/object/embed/form/input/frame/style 태그 제거', () => {
  const html =
    '<iframe src="https://evil.com"></iframe>' +
    '<object data="x"></object>' +
    '<embed src="x">' +
    '<form action="/x"><input name="y"></form>' +
    '<frame src="x">' +
    '<style>body{display:none}</style>'
  const out = sanitizePostHtml(html)
  for (const tag of ['iframe', 'object', 'embed', 'form', 'input', 'frame', 'style']) {
    assert.doesNotMatch(out, new RegExp(`<${tag}`, 'i'), `${tag} 제거`)
  }
  // style 태그 내용도 제거되어야 한다
  assert.doesNotMatch(out, /display:none/)
})

test('style 속성(color:red) 제거', () => {
  const out = sanitizePostHtml('<p style="color:red">t</p>')
  assert.doesNotMatch(out, /style=/i)
  assert.doesNotMatch(out, /color:red/)
  assert.match(out, /<p>t<\/p>/)
})

test('on* 이벤트 핸들러 속성 제거 (onclick/onmouseover/onload 등)', () => {
  const out = sanitizePostHtml(
    '<p onclick="a()" onmouseover="b()" onload="c()" onfocus="d()">t</p>'
  )
  assert.doesNotMatch(out, /onclick/i)
  assert.doesNotMatch(out, /onmouseover/i)
  assert.doesNotMatch(out, /onload/i)
  assert.doesNotMatch(out, /onfocus/i)
})

// --- KEEP_CONTENT: 허용 안 된 태그는 제거하되 텍스트는 보존 ---

test('허용 안 된 태그(marquee)의 텍스트 내용 보존', () => {
  const out = sanitizePostHtml('<marquee>hi</marquee>')
  assert.doesNotMatch(out, /<marquee/i)
  assert.match(out, /hi/)
})

// --- URL 스킴/상대경로 허용 ---

test('상대경로 href 허용', () => {
  const out = sanitizePostHtml('<a href="/board">b</a>')
  assert.match(out, /href="\/board"/)
})

test('프로토콜 상대(//host/x) href 허용', () => {
  const out = sanitizePostHtml('<a href="//host/x">b</a>')
  assert.match(out, /href="\/\/host\/x"/)
})

test('mailto/tel 스킴 href 허용', () => {
  const out = sanitizePostHtml('<a href="mailto:a@b.com">m</a><a href="tel:123">t</a>')
  assert.match(out, /href="mailto:a@b\.com"/)
  assert.match(out, /href="tel:123"/)
})

// --- 방어적: 비문자열/빈 입력 ---

test('빈 문자열은 빈 문자열', () => {
  assert.equal(sanitizePostHtml(''), '')
})

// --- reverse tabnabbing 방어 (target=_blank → rel 강제) ---

test('target="_blank" 링크에 rel="noopener noreferrer" 자동 주입', () => {
  const out = sanitizePostHtml('<a href="https://x.com" target="_blank">x</a>')
  assert.match(out, /target="_blank"/)
  assert.match(out, /rel="noopener noreferrer"/)
})

test('target 없는 링크에는 rel을 넣지 않음', () => {
  const out = sanitizePostHtml('<a href="https://x.com">x</a>')
  assert.doesNotMatch(out, /rel=/)
})

test('target="_BLANK"(대문자)도 rel 주입 — 대소문자 우회 방지', () => {
  const out = sanitizePostHtml('<a href="https://x.com" target="_BLANK">x</a>')
  assert.match(out, /rel="noopener noreferrer"/)
})
