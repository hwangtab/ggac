#!/usr/bin/env node
/**
 * 권한 E2E 운영 빌드 서버 전용 — Upstash Redis REST 자리에 서는 **로컬 가짜** 서버.
 *
 * 왜 필요한가: 운영 모드(`NODE_ENV=production`)의 분산 레이트리밋은 Upstash 자격증명이
 * 없으면 **쓰기 요청을 503으로 닫는다**(`src/utils/distributedRateLimiter.ts`의
 * `degradeByMethod` — 운영에서 메모리 폴백을 허용하지 않는 것은 의도된 설계다). 그대로
 * `next start`를 띄우면 로그인(`POST /api/auth/sign-in/email`)부터 503이라 스위트가 서지
 * 않는다. 운영 코드에 "E2E면 열어 준다" 스위치를 심는 대신, 앱은 운영과 **같은 Redis 경로**를
 * 타고 그 끝에 이 서버가 선다.
 *
 * **한도에는 걸리지 않게 답한다**(매 요청을 그 창의 첫 요청으로 센다). 권한 E2E는 한 IP에서
 * 분당 수백 건을 보낸다 — 실제 사용자에게는 없는 모양이라, 정직하게 세면 `GENERAL_API`(IP당
 * 분당 60회)를 금세 넘어 인가 단정이 403·404 대신 429를 받고(실측 5건), 미들웨어의 세션·프로필
 * 확인까지 429로 막혀 로그인된 세션이 `/login`으로 튕겼다(실측). dev 서버에서 드러나지 않은
 * 것은 컴파일 대기로 요청 속도가 느렸고 카운터가 프로세스 메모리였기 때문일 뿐, 이 스위트가
 * 한도를 검사한 적은 없다(429를 단정하는 권한 테스트는 0건이다).
 *
 * 앱이 쓰는 명령만 받는다(`UpstashRedisClient`): GET·TTL·DEL과, `checkAndConsume`의 EVAL
 * 하나. 스크립트가 바뀌어 이 서버가 모르는 모양이 오면 400으로 거부한다 — 그러면 앱은 운영
 * 규칙대로 쓰기를 503으로 닫아 스위트가 바로 빨개진다. 아래 `CHECK_AND_CONSUME_MARKERS`를
 * 새 스크립트에 맞춰라.
 *
 * 사용: `node e2e/helpers/fakeUpstash.mjs <포트> <토큰>` — `playwright.config.ts`의
 * webServer가 띄운다. 127.0.0.1에만 묶는다.
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2])
const token = process.argv[3]
if (!port || !token) {
  console.error('사용법: node e2e/helpers/fakeUpstash.mjs <포트> <토큰>')
  process.exit(2)
}

// `checkAndConsume`의 Lua를 알아보는 표식 — 순서까지 본다.
const CHECK_AND_CONSUME_MARKERS = [
  "redis.call('TTL', KEYS[2])",
  "redis.call('INCR', KEYS[1])",
  "redis.call('EXPIRE', KEYS[1], ARGV[1])",
  "redis.call('TTL', KEYS[1])",
  'tonumber(ARGV[2]) * 2',
  "redis.call('SETEX', KEYS[2], ARGV[3], 'blocked')",
]

function isCheckAndConsume(script) {
  let from = 0
  for (const marker of CHECK_AND_CONSUME_MARKERS) {
    const at = script.indexOf(marker, from)
    if (at < 0) return false
    from = at + marker.length
  }
  return true
}

/** 차단 없음 · 이 창의 첫 요청(count 1) · 남은 시간은 창 전체 — 앱은 늘 통과시킨다. */
function checkAndConsume(windowSeconds) {
  return [0, 1, windowSeconds, 0]
}

function run(command) {
  const [name, ...args] = command
  switch (String(name).toUpperCase()) {
    // 저장하는 값이 없으므로 조회는 "없음"으로 답한다(Redis 의미 그대로: GET null, TTL -2, DEL 0).
    case 'GET':
      return null
    case 'TTL':
      return -2
    case 'DEL':
      return 0
    case 'EVAL': {
      const [script, numKeys, , , windowSeconds] = args
      if (Number(numKeys) !== 2 || !isCheckAndConsume(script)) {
        throw new Error('알 수 없는 EVAL 스크립트 — e2e/helpers/fakeUpstash.mjs를 앱에 맞춰라')
      }
      return checkAndConsume(Number(windowSeconds))
    }
    default:
      throw new Error(`지원하지 않는 명령: ${name}`)
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  // Playwright webServer의 준비 확인용
  if (req.method === 'GET') return send(res, 200, { ok: true })
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  if (req.headers.authorization !== `Bearer ${token}`) {
    return send(res, 401, { error: 'unauthorized' })
  }
  let raw = ''
  req.on('data', chunk => (raw += chunk))
  req.on('end', () => {
    try {
      const command = JSON.parse(raw)
      if (!Array.isArray(command)) throw new Error('명령은 배열이어야 한다')
      send(res, 200, { result: run(command) })
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`fake Upstash listening on http://127.0.0.1:${port}`)
})
