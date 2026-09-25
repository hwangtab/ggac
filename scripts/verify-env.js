#!/usr/bin/env node

/**
 * Environment Variable Verification Script
 * Checks if all required environment variables are present and valid
 */

const { loadEnvConfig } = require('@next/env')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const sourceArg = process.argv.find(arg => arg.startsWith('--source='))
const envSource = sourceArg ? sourceArg.split('=')[1] : 'local'
const validSources = new Set(['local', 'vercel'])

if (!validSources.has(envSource)) {
  console.error(`Unsupported env source: ${envSource}`)
  console.error('Use --source=local or --source=vercel')
  process.exit(1)
}

loadEnvConfig(process.cwd())

const requiredEnvVars = [
  // Better Auth 배선(feat/turso-stage2b1)이 src/db/client.ts를 통해 모듈
  // 스코프에서 Turso에 연결한다. 이 셋이 없으면 캐치올 라우트를 빌드타임에
  // 수집하는 순간 "Failed to collect page data for /api/auth/[...all]"로
  // 빌드가 죽는다(2026-08-18 최종 리뷰 Critical, 실측 재현됨) — 폴백이 없다.
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
  'BETTER_AUTH_SECRET',
  // 저장소는 Vercel Blob 하나뿐이다(단계 4 Task 5에서 제공자 분기가 사라졌다).
  // 셋 다 없으면 **에러 없이 화면만 망가지는** 종류의 사고를 낸다:
  //  · NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL이 비면 isBlobPublicUrl()이 항상 false
  //    (src/lib/storage/paths.ts) → toSafeArtistImageSrc가 Blob 사진을 전부
  //    기본 로고로 바꾸고(src/utils/safeUrl.ts) 첨부 렌더 게이트도 전부 닫힌다.
  //  · PUBLIC_BLOB_READ_WRITE_TOKEN이 없으면 업로드·삭제(미디어·첨부·아티스트
  //    사진)가 전부 실패한다.
  //  · PRIVATE_BLOB_READ_WRITE_TOKEN이 없으면 이사회 서류 업로드·다운로드가
  //    실패한다(src/lib/storage/privateProvider.ts).
  // 셋 다 빠져 있는데도 이 스크립트가 초록불이던 상태가 최종 리뷰 B-2다.
  'NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL',
  'PUBLIC_BLOB_READ_WRITE_TOKEN',
  'PRIVATE_BLOB_READ_WRITE_TOKEN',
  // 인증 메일(가입·비밀번호 재설정)과 지원사업 다이제스트 메일 발송에 쓴다.
  // 없으면 두 발송 모두 에러 없이 조용히 실패한다 — RESEND_API_KEY 없이도
  // 가입·재설정 API는 200을 반환하고 메일만 안 간다(README 알려진 이슈).
  // 지금까지는 .env.local에만 있어 이 스크립트가 누락을 못 잡았다.
  'RESEND_API_KEY',
  // 메일함 수신. 셋 중 하나라도 없으면 받은 메일이 조용히 사라진다 —
  //  · RESEND_INBOUND_WEBHOOK_SECRET이 없으면 웹훅이 전부 401이다(fail-closed).
  //  · RESEND_INBOUND_API_KEY가 없으면 행은 생기지만 본문이 영영 pending이다.
  //  · MAILBOX_ALLOWED_RECIPIENTS가 비면 모든 수신이 거부된다(fail-closed).
  'RESEND_INBOUND_API_KEY',
  'RESEND_INBOUND_WEBHOOK_SECRET',
  'MAILBOX_ALLOWED_RECIPIENTS',
  // Vercel 크론이 실제로 보내는 값이다. Vercel은 `Authorization: Bearer
  // $CRON_SECRET`을 고정으로 붙이고 헤더를 바꿀 수단이 없으므로, 이 값이 없으면
  // vercel.json에 등록한 크론 셋이 **전부 401만 받는다**(fail-closed).
  //  · /api/internal/funding/expire — 받아들이는 토큰이 CRON_SECRET **하나뿐**이다.
  //    멈추면 만료된 선점이 풀리지 않아 환불도, 유실된 승인의 대체 확정도,
  //    "후원이 완료됐습니다" 통지도 나가지 않는다. 돈이 걸린 경로다.
  //  · /api/internal/uploads/cleanup, /api/internal/mailbox/backfill — 각자
  //    손호출 토큰(CLEANUP_CRON_TOKEN·MAILBOX_BACKFILL_CRON_TOKEN)이 있지만
  //    Vercel 크론은 그 이름으로 부르지 못한다.
  // 어느 쪽도 에러를 내지 않고 조용히 401만 쌓이므로 배포 전에 여기서 잡는다.
  'CRON_SECRET',
]

const redisEnvGroups = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
]
const productionRequiredValues = {
  NEXT_STRICT_CSP: 'true',
}

const optionalEnvVars = [
  // 심각도 'high' 보안 이벤트가 사람에게 닿는 유일한 외부 통로다(Slack·Discord
  // 호환 페이로드). 비어 있으면 Vercel 런타임 로그의 stderr 한 줄이 전부다 —
  // 깨진 크론·정체된 결제 선점·레이트리밋 메모리 폴백이 모두 그 한 줄로만
  // 남는다. 없어도 앱은 돈다.
  'SECURITY_ALERT_WEBHOOK_URL',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'NEXT_STRICT_CSP',
  'VERCEL_TOKEN',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
  // 서로 폴백 관계(src/lib/auth/server.ts의
  // `BETTER_AUTH_URL || NEXT_PUBLIC_SITE_URL`)라 빌드를 깨지 않는다. 둘 다
  // 없으면 baseURL이 undefined가 돼 /api/auth/* 호출이 500이 되지만(2026-08-18
  // 최종 리뷰 실측: unhandledRejection을 next-server가 삼켜 서버 자체는
  // 생존, 다른 라우트 무영향), 지금은 어느 화면도 이 경로를 안 불러 무해하다
  // — 그래서 필수가 아니라 권장으로만 둔다.
  'BETTER_AUTH_URL',
  'NEXT_PUBLIC_SITE_URL',
  // 앱 코드(`src/`)에는 이 둘을 읽는 줄이 **0줄**이다. 남아 있는 소비처는
  // 인증 이관 기록 도구 `scripts/migrate/identity.mjs`(PostgREST를 fetch로
  // 직접 읽는다) 하나뿐이다. 2026-09-07 정리로 `scripts/storage`의 Supabase
  // 클라이언트 스크립트(copy-to-blob·rewrite/restore-db-urls)는 프로젝트
  // 삭제와 함께 지웠다. 그래서 필수가 아니라 선택으로 둔다 — 필수로 두면
  // 컷오버에서 이 키들을 지우는 순간 배포 전 점검이 **거짓으로 빨간불**이 되고,
  // 운영자에게 쓰지도 않는 service-role 키를 계속 꽂아 두라고 압박한다
  // (최종 리뷰 B-2).
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  // 2026-09-01 Supabase 프로젝트 삭제로 함께 선택으로 내려왔다. 레거시 Storage
  // 절대 URL을 "우리 것"으로 인정하던 판정 4곳(safeUrl.ts·storageUrlValidation.ts·
  // imageDimensions.ts·storage/paths.ts)이 사라졌고, 운영 DB에 남은 Supabase
  // 절대 URL은 실측 0건이다. 앱은 이제 이 값을 한 줄도 읽지 않는다.
  'NEXT_PUBLIC_SUPABASE_URL',
  // 지원사업 다이제스트가 kosmart 공고 조회 API를 부르는 데 쓴다. 둘 다
  // 없으면 크론이 호출에 실패해 그 주 초안이 만들어지지 않는다 — Vercel
  // production에는 아직 없어 필수로 올리면 배포가 막힌다.
  'KOSMART_OPPORTUNITIES_URL',
  'KOSMART_API_TOKEN',
  // 지원사업 초안 생성 크론(GitHub Actions → /api/internal/grant-digest/draft)의
  // 인증 토큰. 없으면 크론 라우트가 401을 반환해 초안이 만들어지지 않는다.
  'GRANT_DIGEST_CRON_TOKEN',
  // 조합비 자동청구 크론 인증 토큰. Vercel production에는 이미 있다.
  'PAYMENTS_CRON_TOKEN',
  // 임시 첨부 정리 크론 인증 토큰. Vercel production에는 이미 있다.
  'CLEANUP_CRON_TOKEN',
  // 발신 메일의 회신 주소. 없으면 회신이 noreply@ggac.kr로 가서 유실된다.
  // 필수가 아닌 이유: 없어도 발송 자체는 성공하고, 전환 전 동작과 같다.
  'MAILBOX_REPLY_TO',
  // 백필 크론 손호출용. Vercel 크론은 CRON_SECRET을 쓴다.
  'MAILBOX_BACKFILL_CRON_TOKEN',
  // 일일 수신 임계치. 기본 60.
  'MAILBOX_DAILY_INBOUND_ALERT',
  // 결제 킬스위치. `isPaymentEnabled()`(src/lib/payments/toss/config.ts)이 값이
  // 정확히 'toss'일 때만 true다 — 비어 있으면 신규 결제가 전부 막히고
  // funding/expire 크론도 skipped로 빠진다. 켜지 않은 상태가 정상 동작이라
  // 선택이다. 대신 'toss'로 켠 뒤에는 아래 키 점검이 필수로 바뀐다.
  'NEXT_PUBLIC_PAYMENT_MODE',
  // 일반결제(주문서형) 키 쌍. 스위치가 꺼져 있으면 읽히지 않으므로 선택이다.
  'NEXT_PUBLIC_TOSS_CLIENT_KEY',
  'TOSS_SECRET_KEY',
  // 자동결제(빌링) 키 쌍. 일반결제와 **다른 키**를 쓴다(ck/sk 계열). 없거나
  // 계열이 틀리면 자동결제 기능이 화면에서 통째로 사라진다 — 에러는 안 난다.
  'NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY',
  'TOSS_BILLING_SECRET_KEY',
]

console.log('🔍 Environment Variable Verification\n')
console.log(
  `📦 Source: ${envSource === 'vercel' ? 'Vercel Production' : 'Local environment files'}`
)

function parseEnvFile(filePath) {
  const env = {}
  const content = fs.readFileSync(filePath, 'utf8')

  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex === -1) return

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    env[key] = value
  })

  return env
}

function loadVercelProductionEnv() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ggac-vercel-env-'))
  const tempFile = path.join(tempDir, '.env.production.local')

  try {
    execFileSync('vercel', ['env', 'pull', tempFile, '--environment=production', '--yes'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const env = parseEnvFile(tempFile)
    mergeVercelHiddenEnvPresence(env)

    return env
  } catch (error) {
    console.error('❌ Failed to pull Vercel production environment variables.')
    const stderr = error && error.stderr ? String(error.stderr).trim() : ''
    if (stderr) console.error(stderr)
    process.exit(1)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

const VERCEL_HIDDEN_VALUE_PRESENT = '__VERCEL_HIDDEN_ENV_VALUE_PRESENT__'

function parseVercelJsonOutput(output) {
  const jsonStart = output.indexOf('{')
  const jsonEnd = output.lastIndexOf('}')

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    throw new Error('Vercel CLI did not return JSON output')
  }

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1))
}

function mergeVercelHiddenEnvPresence(env) {
  let parsed

  try {
    const output = execFileSync('vercel', ['env', 'ls', 'production', '--format=json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    parsed = parseVercelJsonOutput(output)
  } catch {
    return
  }

  if (!Array.isArray(parsed.envs)) return

  parsed.envs.forEach(item => {
    const key = item && typeof item.key === 'string' ? item.key : null
    const type = item && typeof item.type === 'string' ? item.type : null
    const targets = Array.isArray(item && item.target) ? item.target : []

    if (!key || !targets.includes('production')) return
    if (env[key]) return

    if (type === 'sensitive' || type === 'encrypted') {
      env[key] = VERCEL_HIDDEN_VALUE_PRESENT
    }
  })
}

function formatEnvValue(varName, value) {
  if (value === VERCEL_HIDDEN_VALUE_PRESENT) {
    return 'Present (value hidden by Vercel)'
  }

  return varName.includes('KEY') || varName.includes('TOKEN')
    ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
    : value
}

const env = envSource === 'vercel' ? loadVercelProductionEnv() : process.env

let hasErrors = false

function hasCompleteEnvGroup(env, groups) {
  return groups.some(group => group.every(varName => Boolean(env[varName])))
}

function getIncompleteEnvGroups(env, groups) {
  return groups.filter(group => !group.every(varName => Boolean(env[varName])))
}

// Check required variables
console.log('📋 Required Environment Variables:')
requiredEnvVars.forEach(varName => {
  const value = env[varName]
  if (!value) {
    console.log(`❌ ${varName}: Missing`)
    hasErrors = true
  } else {
    // Mask sensitive values for display
    const displayValue = formatEnvValue(varName, value)
    console.log(`✅ ${varName}: ${displayValue}`)
  }
})

console.log('\n📋 Optional Environment Variables:')
optionalEnvVars.forEach(varName => {
  const value = env[varName]
  if (!value) {
    console.log(`⚠️  ${varName}: Not set (optional)`)
  } else {
    const displayValue = formatEnvValue(varName, value)
    console.log(`✅ ${varName}: ${displayValue}`)
  }
})

// Validate public Blob base URL format
// isBlobPublicUrl()은 `new URL(base).origin`을 대조한다 — 파싱되지 않는 값은
// try/catch 안에서 조용히 false가 되어 "설정했는데 모든 사진이 안 뜨는" 상태를
// 만든다. 값이 있는데 URL이 아닌 경우를 여기서 잡는다.
if (env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL) {
  let blobOrigin = null
  try {
    blobOrigin = new URL(env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL).origin
  } catch {
    blobOrigin = null
  }
  if (!blobOrigin || !blobOrigin.startsWith('https://')) {
    console.log(
      '❌ NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL: Invalid format (should be an absolute https:// URL, e.g. https://[store].public.blob.vercel-storage.com)'
    )
    hasErrors = true
  }
}

// MAILBOX_REPLY_TO(선택)가 MAILBOX_ALLOWED_RECIPIENTS(필수)에 없으면 관리자
// 답장에 대한 회신이 화이트리스트를 통과하지 못해 에러도 로그도 없이
// 사라진다. 둘 다 있을 때만 검사한다 — 어느 한쪽이 없으면(설정 자체를
// 안 했으면) 이 조합 문제가 성립하지 않는다. 주소 비교는 대소문자를 무시한다.
if (env.MAILBOX_REPLY_TO && env.MAILBOX_ALLOWED_RECIPIENTS) {
  const replyTo = env.MAILBOX_REPLY_TO.trim().toLowerCase()
  const allowedList = env.MAILBOX_ALLOWED_RECIPIENTS.split(',').map(entry =>
    entry.trim().toLowerCase()
  )
  if (replyTo && !allowedList.includes(replyTo)) {
    console.log(
      `⚠️  MAILBOX_REPLY_TO(${env.MAILBOX_REPLY_TO})가 MAILBOX_ALLOWED_RECIPIENTS에 없습니다 — 그 주소로 온 회신이 저장되지 않고 조용히 사라집니다.`
    )
  }
}

// 결제 키는 **스위치가 켜져 있을 때만** 판정한다.
// NEXT_PUBLIC_PAYMENT_MODE가 'toss'가 아니면 키가 없는 것이 정상 동작이므로
// (`isPaymentEnabled()`가 false → 신규 결제 전면 차단) 조용히 넘어간다. 켜 놓고
// 키가 없거나 test/live가 어긋난 상태는 **결제창까지는 정상적으로 뜨고 승인
// 단계에서 통째로 실패하는** 종류의 사고라 화면에 원인이 드러나지 않는다
// (src/lib/payments/toss/config.ts의 assertKeyPairConsistent). 값은 절대 찍지
// 않고 접두사로 얻은 환경 이름만 쓴다.
function tossKeyEnvironment(value) {
  if (typeof value !== 'string') return null
  if (value.startsWith('test_')) return 'test'
  if (value.startsWith('live_')) return 'live'
  return null
}

if (env.NEXT_PUBLIC_PAYMENT_MODE === 'toss') {
  const payKeys = [
    ['NEXT_PUBLIC_TOSS_CLIENT_KEY', env.NEXT_PUBLIC_TOSS_CLIENT_KEY],
    ['TOSS_SECRET_KEY', env.TOSS_SECRET_KEY],
  ]

  payKeys.forEach(([varName, value]) => {
    if (!value) {
      console.log(`❌ ${varName}: Missing (NEXT_PUBLIC_PAYMENT_MODE=toss로 결제가 켜져 있습니다)`)
      hasErrors = true
    } else if (value === VERCEL_HIDDEN_VALUE_PRESENT) {
      // --source=vercel에서 sensitive로 등록된 키는 값을 읽을 수 없다. 있는 것만
      // 확인하고 접두사 판정은 건너뛴다 — 여기서 빨간불을 내면 거짓 빨간불이다.
      console.log(`⚠️  ${varName}: 값이 가려져 있어 test/live 일치는 확인하지 못했습니다.`)
    } else if (!tossKeyEnvironment(value)) {
      console.log(`❌ ${varName}: Invalid format (test_ 또는 live_로 시작해야 합니다)`)
      hasErrors = true
    }
  })

  const clientEnvName = tossKeyEnvironment(env.NEXT_PUBLIC_TOSS_CLIENT_KEY)
  const secretEnvName = tossKeyEnvironment(env.TOSS_SECRET_KEY)
  if (clientEnvName && secretEnvName && clientEnvName !== secretEnvName) {
    console.log(
      `❌ 토스 결제 키의 환경이 어긋납니다 (NEXT_PUBLIC_TOSS_CLIENT_KEY: ${clientEnvName}, TOSS_SECRET_KEY: ${secretEnvName}) — 결제창은 뜨지만 승인 단계에서 전부 실패합니다.`
    )
    hasErrors = true
  }

  // 자동결제는 경고에 그친다 — 키가 없으면 카드 등록 화면 자체가 렌더되지
  // 않아(`isBillingEnabled()`) 결제 실패로 이어지지 않고, 일반결제만 쓰는
  // 운영 상태가 성립한다. 다만 "켜 둔 줄 알았는데 화면에 없다"가 되기 쉬워
  // 여기서 이유를 남긴다.
  const billingClientKey = env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY
  const billingSecretKey = env.TOSS_BILLING_SECRET_KEY
  const generalFamily = /^(test|live)_g(c|s)k_/
  const billingKeyHidden =
    billingClientKey === VERCEL_HIDDEN_VALUE_PRESENT ||
    billingSecretKey === VERCEL_HIDDEN_VALUE_PRESENT
  if (!billingClientKey || !billingSecretKey) {
    console.log(
      '⚠️  자동결제 키(NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY + TOSS_BILLING_SECRET_KEY)가 없어 자동결제(카드 등록)가 화면에서 조용히 사라집니다.'
    )
  } else if (billingKeyHidden) {
    // 위와 같은 이유 — 값이 가려져 있으면 계열·환경을 판정할 수 없다.
  } else if (generalFamily.test(billingClientKey) || generalFamily.test(billingSecretKey)) {
    console.log(
      '⚠️  자동결제 키가 일반결제 계열(gck/gsk)입니다 — 자동결제는 API 개별 연동 키(ck/sk)가 필요하고, 계열이 틀리면 기능이 숨겨집니다.'
    )
  } else {
    const billingClientEnvName = tossKeyEnvironment(billingClientKey)
    const billingSecretEnvName = tossKeyEnvironment(billingSecretKey)
    if (
      !billingClientEnvName ||
      !billingSecretEnvName ||
      billingClientEnvName !== billingSecretEnvName
    ) {
      console.log(
        '⚠️  자동결제 키 쌍의 환경이 어긋나거나 형식이 올바르지 않습니다 — 자동결제가 화면에서 조용히 사라집니다.'
      )
    }
  }
}

// Check environment
console.log(`\n🌍 Environment: ${process.env.NODE_ENV || 'development'}`)
console.log(`🔧 Platform: ${process.platform}`)

// Additional checks for production
if (process.env.NODE_ENV === 'production') {
  console.log('\n🏭 Production Environment Checks:')

  // Check if Redis is configured for production rate limiting
  const hasRedisEnv = hasCompleteEnvGroup(env, redisEnvGroups)
  if (!hasRedisEnv) {
    getIncompleteEnvGroups(env, redisEnvGroups).forEach(group => {
      console.log(`❌ ${group.join(' + ')}: Missing complete Redis env group in production`)
    })
    console.log(
      '❌ Redis not configured - production rate-limited APIs will fail closed. Set either UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN.'
    )
    hasErrors = true
  } else {
    console.log('✅ Redis REST env group configured for production rate limiting')
  }

  Object.entries(productionRequiredValues).forEach(([varName, expectedValue]) => {
    if (env[varName] !== expectedValue) {
      console.log(`❌ ${varName}: Expected "${expectedValue}" in production`)
      hasErrors = true
    } else {
      console.log(`✅ ${varName}: "${expectedValue}"`)
    }
  })
}

console.log('\n' + '='.repeat(50))

if (hasErrors) {
  console.log('❌ Environment verification failed!')
  console.log('Please set the missing required environment variables.')
  process.exit(1)
} else {
  console.log('✅ Environment verification passed!')
  console.log('All required environment variables are properly configured.')
}
