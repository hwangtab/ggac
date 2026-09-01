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
]

const redisEnvGroups = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
]
const productionRequiredValues = {
  NEXT_STRICT_CSP: 'true',
}

const optionalEnvVars = [
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
  // 이관·컷오버 스크립트(scripts/migrate, scripts/storage)가 Supabase에서
  // 데이터를 읽을 때뿐이다. 그래서 필수가 아니라 선택으로 둔다 — 필수로 두면
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
