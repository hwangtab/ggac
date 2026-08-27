import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 컷오버 후 감사(2026-08-27) — `SECURITY_WEBHOOK_URL`·`SECURITY_ALERT_WEBHOOK_URL`이
 * Vercel에 **둘 다 없었다.** 즉 운영에서 보안 이벤트가 콘솔 밖으로 나가지 않았고
 * high 심각도 알림도 조용히 증발했다. 반면 `SLACK_BOT_TOKEN`·`SLACK_CHANNEL_ID`는
 * 이미 운영에 있다(배포 알림이 쓴다).
 *
 * 그래서 새 시크릿을 요구하는 대신 **웹훅이 하나도 없을 때만** Slack 봇으로
 * 보내는 폴백을 넣었다. 이 테스트가 못박는 것:
 *  ① 폴백이 실제로 호출된다(주석이 아니라 호출문으로)
 *  ② 웹훅이 설정돼 있으면 폴백을 타지 않는다(기존 동작 불변)
 *  ③ 실패해도 주요 로직을 깨지 않는다(기존 catch 안)
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const source = stripComments(readFileSync('src/utils/security.ts', 'utf8'))

test('보안 이벤트 Slack 폴백이 실제로 호출된다', () => {
  assert.match(
    source,
    /await postSecurityEventToSlack\(event, severity, immutableDetails\)/,
    '폴백 함수가 호출되지 않으면 보안 이벤트가 콘솔 밖으로 나가지 않는다'
  )
})

test('웹훅이 설정돼 있으면 폴백을 타지 않는다', () => {
  assert.match(
    source,
    /if \(!process\.env\.SECURITY_WEBHOOK_URL && !process\.env\.SECURITY_ALERT_WEBHOOK_URL\)/,
    '두 웹훅 중 하나라도 있으면 그쪽이 우선이어야 한다(기존 동작 보존)'
  )
})

test('폴백은 기존 catch 안에서 돈다 — 실패해도 주요 로직을 안 깬다', () => {
  const call = source.indexOf('await postSecurityEventToSlack(')
  const guard = source.indexOf("console.error('[Security] Failed to send security event:'")
  assert.ok(call > 0 && guard > call, '폴백 호출이 보안 로깅 catch보다 앞에 있어야 한다')
})

test('토큰·채널이 없으면 조용히 넘어간다 (배포 환경마다 다르다)', () => {
  assert.match(
    source,
    /if \(!token \|\| !channel\) return/,
    '자격증명이 없을 때 던지면 보안 로깅이 주요 로직을 깨뜨린다'
  )
})

test('세부 정보는 Slack 첨부 상한에 맞춰 잘린다', () => {
  assert.match(source, /\.slice\(0, 1800\)/, '자르지 않으면 긴 페이로드에서 전송이 실패한다')
})
