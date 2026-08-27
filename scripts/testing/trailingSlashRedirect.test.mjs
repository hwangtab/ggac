import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 컷오버 후 감사(2026-08-27) — 슬래시로 끝나는 모든 URL이 무한 리다이렉트에 빠져
 * 있었다. `/artists/` → 301 `/artists/` → 301 → … 브라우저는
 * ERR_TOO_MANY_REDIRECTS를 낸다. 외부 링크·북마크·메일·QR이 슬래시를 달고 있으면
 * 그 방문자는 페이지를 아예 못 본다.
 *
 * 원인은 `NextURL`(=`request.nextUrl.clone()`)의 pathname setter가 내부 포맷
 * 결과에 반영되지 않는 것이다 — `url.pathname`은 `/artists`로 읽히는데
 * `toString()`과 Location 헤더는 `/artists/`가 나온다.
 *
 * 값 대조가 아니라 **원인 자체를 못박는다**: 이 블록이 `nextUrl.clone()`으로
 * 돌아가면 실패한다. 아래 동작 테스트만으로는 next 버전이 바뀌어 setter가
 * 고쳐지면 통과해버려, "왜 이렇게 썼는지"가 사라진다.
 */
/**
 * **주석을 먼저 벗긴다.** 이 블록의 주석 자체가 `request.nextUrl.clone()`을
 * "쓰지 마라"고 인용하고 있어서, 원본을 그대로 검사하면 부정 단정이 주석에 걸려
 * 항상 실패한다. 이 저장소가 전환 내내 반복해 당한 유형이라(가드가 주석에 매치)
 * 여기서도 같은 함정을 밟았다 — 실제로 처음 작성했을 때 그렇게 실패했다.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const source = stripComments(readFileSync('src/middleware.ts', 'utf8'))
const block = source.slice(
  source.indexOf('pathname.endsWith(') - 200,
  source.indexOf('pathname.endsWith(') + 400
)

test('trailing slash 정규화는 표준 URL을 쓴다 (nextUrl.clone 금지)', () => {
  assert.ok(block.length > 0, 'trailing slash 블록을 찾지 못했다')
  assert.match(block, /const url = new URL\(request\.url\)/)
  assert.doesNotMatch(
    block,
    /request\.nextUrl\.clone\(\)/,
    'NextURL의 pathname setter는 Location에 반영되지 않아 무한 리다이렉트가 된다'
  )
})

test('NextURL의 결함이 실재한다 — 이 테스트가 지키는 전제', async () => {
  const { NextRequest, NextResponse } = await import('next/server.js')

  // 결함 재현: clone() + pathname 설정은 Location이 안 바뀐다.
  const broken = new NextRequest('http://x/artists/')
  const brokenUrl = broken.nextUrl.clone()
  brokenUrl.pathname = '/artists'
  const brokenLocation = NextResponse.redirect(brokenUrl, 301).headers.get('location')

  // 현재 방식: 표준 URL은 정상 동작한다.
  const fixed = new NextRequest('http://x/artists/?page=2')
  const fixedUrl = new URL(fixed.url)
  fixedUrl.pathname = fixedUrl.pathname.replace(/\/+$/, '')
  const fixedLocation = NextResponse.redirect(fixedUrl, 301).headers.get('location')

  assert.equal(fixedLocation, 'http://x/artists?page=2', '쿼리스트링을 보존해야 한다')
  assert.notEqual(
    fixedLocation,
    brokenLocation,
    'NextURL이 고쳐졌다면 이 테스트의 전제가 사라진 것이니 주석을 갱신하라'
  )
})
