/**
 * E2E가 **다운로드 없이** 도는 상태를 못박는다.
 *
 * 2026-09-01 실측 — `chromium` 프로젝트만 번들 브라우저를 고집해서, 개발자
 * 머신에서 `authz`가 아닌 스펙 5개(약 30건: 게시판 SSR·이사회·홈 모션·비밀번호
 * 재설정·API 회귀)가 **아예 실행되지 못했다.** CI는 `smoke.spec.ts`만 돌리므로
 * 그 30건은 어디에서도 돌지 않았다. `channel: 'chrome'`으로 바꾸자 37건이 돌고
 * 전부 통과했다.
 *
 * 번들 브라우저를 받아 해결하려는 시도는 세 번 다 어긋났다:
 *  - `npx`는 프로젝트 버전이 아닌 최신본을 받아 멀쩡한 빌드를 지운다
 *  - 프로젝트 바이너리로 받아도 `chromium`과 `chromium-headless-shell`이 따로다
 *  - 후자만 받으면 앞서 받은 전체 빌드가 사라진다
 *
 * 그래서 정책은 **받지 않는 것**이고, 이 테스트가 그 정책을 지킨다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const config = await readFile(new URL('../../playwright.config.ts', import.meta.url), 'utf8')

// 주석 안의 같은 문자열이 함께 세지지 않게 걷어낸다. 이 저장소는 "왜 이렇게 되어
// 있는가"를 주석에 길게 남기는 관행이 있어서, **세는 검사는 반드시 코드만 봐야 한다.**
// 정규식으로 주석을 지우려던 시도가 이 저장소에서 실제 코드 16개 파일을 지운 적이
// 있어(문자열 리터럴 안의 `//`·`/*`), 파서 기반 도구를 쓴다.
const { stripComments } = await import('./strip-comments.mjs')
const codeOnly = stripComments(config)

test('모든 Playwright 프로젝트가 로컬에서 시스템 Chrome을 쓴다', () => {
  const projectNames = [...config.matchAll(/name: '([a-z-]+)'/g)].map(m => m[1])
  assert.ok(projectNames.length >= 4, `프로젝트를 찾지 못했다: ${projectNames.join(',')}`)

  const chromeUsages = [...codeOnly.matchAll(/channel: 'chrome'/g)].length
  assert.equal(
    chromeUsages,
    projectNames.length,
    `프로젝트 ${projectNames.length}개 중 ${chromeUsages}개만 시스템 Chrome을 쓴다 — ` +
      '빠진 프로젝트는 번들 브라우저를 요구해 캐시가 없는 머신에서 통째로 실행되지 못한다'
  )
})

test('chromium 프로젝트는 CI에서만 번들 브라우저로 떨어진다', () => {
  // 로컬은 다운로드 0, CI는 워크플로가 직접 설치한 번들 브라우저.
  assert.match(
    config,
    /process\.env\.CI \? \{\} : \{ channel: 'chrome' as const \}/,
    'CI 분기가 사라지면 CI 러너(Chrome 없음)에서 E2E가 깨진다'
  )
})

test('저장소가 playwright install을 자동 실행하지 않는다', async () => {
  // 어딘가에서 자동으로 받게 해 두면 위 정책이 무의미해진다.
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  const scripts = Object.entries(pkg.scripts ?? {})
  const offenders = scripts.filter(([, cmd]) => /playwright\s+install/.test(String(cmd)))
  assert.deepEqual(
    offenders,
    [],
    `npm 스크립트가 브라우저를 받는다: ${offenders.map(([k]) => k).join(', ')}`
  )
})

test('영상 녹화는 CI 전용이다 — ffmpeg가 없어도 로컬이 돌아야 한다', () => {
  // 영상은 캐시의 `ffmpeg-*` 바이너리를 요구하고, 없으면 `newPage`가 **테스트마다**
  // 실패한다(`retain-on-failure`도 일단 전부 녹화한 뒤 통과분을 버린다).
  // 실측(2026-09-01): 캐시를 비우니 Chrome은 정상 실행되는데 ffmpeg 때문에 29건이
  // 죽었다. `video`를 CI 전용으로 내리자 같은 조건에서 **37건 전부 통과, 다운로드 0**.
  assert.match(
    codeOnly,
    /video: isCI \? 'retain-on-failure' : 'off'/,
    '로컬에서 영상을 켜면 ffmpeg가 없는 머신에서 전 스위트가 죽는다'
  )
})
