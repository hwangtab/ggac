import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { readFileSync } from 'node:fs'

// 에러 응답 모양이 하나(`ApiError.toNextResponse()`: { success:false, error, meta } + no-store)로
// 통일됐는지, 분류되지 않은 예외가 메시지 sniffing 없이 500이 되는지 못박는다.
const projectRootUrl = new URL('../../', import.meta.url).href
const resolveHookSource = `
const ROOT = ${JSON.stringify(projectRootUrl)}
const FALLBACK_SUFFIXES = ['.ts', '.js', '/index.ts']

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    return { url: new URL('src/' + specifier.slice(2) + '.ts', ROOT).href, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const isResolutionError =
      err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
    if (isResolutionError && !specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
      for (const suffix of FALLBACK_SUFFIXES) {
        try {
          return await nextResolve(specifier + suffix, context)
        } catch {
          // 다음 후보 확장자로 계속 시도한다.
        }
      }
    }
    throw err
  }
}
`
register('data:text/javascript,' + encodeURIComponent(resolveHookSource), import.meta.url)

const { ApiError, withApiWrapper } = await import('../../src/utils/apiWrapper.ts')
const { ApiErrorHandler } = await import('../../src/utils/errorHandler.ts')
const errorHandlerModule = await import('../../src/utils/errorHandler.ts')

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')

async function assertStandardError(res, status, message) {
  assert.equal(res.status, status)
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
  const body = await res.json()
  assert.equal(body.success, false)
  if (message !== undefined) assert.equal(body.error, message)
  assert.equal(typeof body.meta?.timestamp, 'string')
  return body
}

test('analyzeSupabaseError는 사라졌다', () => {
  assert.equal('analyzeSupabaseError' in errorHandlerModule, false)
})

for (const message of [
  'Unauthorized: token expired',
  'JWT expired',
  'forbidden',
  'resource not found',
  'connection timeout',
  'blob storage bucket failure',
]) {
  test(`withApiWrapper: 일반 예외("${message}")는 메시지와 무관하게 500, 원문 비노출`, async () => {
    const res = await withApiWrapper(
      async () => {
        const err = new Error(message)
        err.code = 'UNAUTHORIZED'
        err.status = 401
        throw err
      },
      { endpoint: '/x', method: 'GET' },
      { disableLogging: true }
    )
    const body = await assertStandardError(res, 500)
    assert.ok(!JSON.stringify(body).includes(message))
    assert.equal('category' in body, false)
  })
}

test('withApiWrapper: ApiError는 그대로 표준 모양', async () => {
  const res = await withApiWrapper(
    async () => {
      throw ApiError.forbidden('관리자 권한이 필요합니다.')
    },
    { endpoint: '/x', method: 'GET' },
    { disableLogging: true }
  )
  await assertStandardError(res, 403, '관리자 권한이 필요합니다.')
})

test('ApiErrorHandler.handleError: 명시한 errorInfo의 상태코드는 유지하되 모양은 표준', async () => {
  const handler = new ApiErrorHandler({ endpoint: '/x', method: 'GET' })
  const res = handler.respondWithCustomError('잘못된 요청', 400)
  await assertStandardError(res, 400, '잘못된 요청')
})

test('인가 헬퍼는 ApiError 표준 응답을 돌려주고 한국어 메시지를 유지한다', () => {
  const expected = {
    'src/lib/server/adminAuth.ts': [
      "ApiError.unauthorized('인증이 필요합니다.')",
      "ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.')",
      "ApiError.forbidden('관리자 권한이 필요합니다.')",
    ],
    'src/lib/server/memberAuth.ts': [
      "ApiError.unauthorized('인증이 필요합니다.')",
      "ApiError.forbidden('승인된 조합원만 이용할 수 있습니다.')",
    ],
    'src/lib/server/boardRoomAuth.ts': [
      "ApiError.forbidden('이사회 접근 권한이 없습니다.')",
      "ApiError.forbidden('이사회 기록 열람 권한이 없습니다.')",
      "ApiError.forbidden('관리자 권한이 필요합니다.')",
    ],
  }
  for (const [file, snippets] of Object.entries(expected)) {
    const source = read(file)
    assert.ok(!/NextResponse\.json\(/.test(source), `${file}: 맨 NextResponse.json 금지`)
    for (const snippet of snippets) {
      assert.ok(source.includes(snippet + '.toNextResponse()'), `${file}: ${snippet}`)
    }
  }
})

test('설정 라우트는 표준 admin 게이트를 쓰고 메시지 문자열로 403/500을 가르지 않는다', () => {
  for (const file of [
    'route',
    'backup/route',
    'cache/route',
    'reset/route',
    'email-verification/route',
  ]) {
    const source = read(`src/app/api/admin/settings/${file}.ts`)
    assert.ok(/auth:\s*'admin'/.test(source), file)
    assert.ok(!source.includes("includes('권한')"), file)
    assert.ok(!source.includes('SettingsAdminAuth'), file)
  }
})

test('defineApiRoute: 맨 객체 반환도 { success, data, meta } 봉투로 나간다', () => {
  const source = read('src/lib/server/apiRoute.ts')
  assert.ok(/ApiSuccess\.ok\(result as TResult\)/.test(source))
  assert.ok(!/NextResponse\.json\(result/.test(source))
})
