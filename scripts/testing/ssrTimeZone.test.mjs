/**
 * SSR로 렌더되는 시각 표시가 서버 타임존에 흔들리지 않는지 못박는다.
 *
 * 2026-09-01 감사 실측 — 운영 게시글 상세에서 React #418(서버가 그린 텍스트와
 * 클라이언트가 그린 텍스트 불일치)이 실제로 떴다. 같은 노드에서
 *   SSR HTML(curl):  2025년 11월 12일 오전 09:15
 *   브라우저 DOM:     2025년 11월 12일 오후 06:15
 * 정확히 9시간 차. Vercel 서버는 UTC, 방문자는 KST인데 `toLocale*`에
 * `timeZone`을 주지 않아서였다.
 *
 * 하이드레이션만의 문제가 아니다 — 크롤러와 OG 캡처는 하이드레이션을 거치지
 * 않으므로 **틀린 시각이 그대로 굳는다.**
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const SSR_TIME_FILES = [
  'src/app/[locale]/board/[id]/PostDetailClient.tsx',
  'src/components/board/ServerBoardView.tsx',
  'src/components/CommentSection.tsx',
  'src/app/[locale]/board-room/_components/AgendaCommentThread.tsx',
  'src/app/[locale]/register/pending/page.tsx',
]

for (const rel of SSR_TIME_FILES) {
  test(`${rel}의 시각 포맷이 타임존을 명시한다`, async () => {
    const src = await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8')
    const calls = [...src.matchAll(/toLocale(?:Date|Time)?String\(/g)].length
    assert.ok(calls > 0, '이 파일에 시각 포맷 호출이 있어야 한다(없으면 목록을 갱신해라)')
    const zoned = [...src.matchAll(/\.\.\.SEOUL_TIME_ZONE|timeZone:/g)].length
    assert.equal(
      zoned,
      calls,
      `${calls}개 호출 중 ${zoned}개만 타임존을 준다 — 나머지는 서버(UTC)와 브라우저가 다른 값을 그린다`
    )
  })
}

test('타임존을 주면 서버(UTC)와 브라우저(KST)가 같은 문자열을 만든다', () => {
  // 실제 회귀를 재현한다: 같은 시각을 두 타임존에서 포맷해 비교.
  const script = `
    const iso = '2025-11-12T09:15:00.000Z'
    const opts = { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }
    process.stdout.write(JSON.stringify({
      naive: new Date(iso).toLocaleDateString('ko-KR', opts),
      zoned: new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', ...opts }),
    }))
  `
  const run = tz =>
    JSON.parse(
      execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString()
    )

  const utc = run('UTC')
  const kst = run('Asia/Seoul')

  assert.notEqual(utc.naive, kst.naive, '타임존을 안 주면 갈린다 — 이것이 버그의 정체다')
  assert.equal(utc.zoned, kst.zoned, '타임존을 주면 어디서 돌든 같아야 한다')
})
