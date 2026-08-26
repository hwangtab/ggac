import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 최종 리뷰 B-1 — `src/db/client.ts`의 `assertProductionCredentials()`.
 *
 * 예전에는 `TURSO_DATABASE_URL`만 봤다. `TURSO_AUTH_TOKEN`은 **만료되는
 * 물건**인데 그 부재/만료는 이 가드를 그냥 통과했고, 실패는 쿼리 시점에야
 * 드러났으며, `src/lib/data.ts`의 JSON 폴백이 그것을 삼켜 **빌드가 조용히
 * 초록불로 끝났다.**
 *
 * 동시에 거짓 실패도 만들면 안 된다: 로컬 파일 DB(`file:`)와 `turso dev`
 * 루프백(`http://127.0.0.1:...`)은 토큰을 요구하지 않는다. 이 파일은 양쪽을
 * 다 못박는다.
 */

const CLIENT_MODULE_URL = new URL('../../src/db/client.ts', import.meta.url)

async function loadFreshClient() {
  return import(`${CLIENT_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

/** 실제 연결을 시도해 보는 가장 얕은 접근(지연 Proxy를 깨우는 속성 접근). */
function touch(rawClient) {
  return rawClient.execute
}

async function withEnv(env, fn) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

test('운영 + 원격 URL + 토큰 없음 → 던진다(만료된 토큰이 조용히 통과하던 구멍)', async () => {
  await withEnv(
    {
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'libsql://example-not-a-real-db.turso.io',
      TURSO_AUTH_TOKEN: undefined,
    },
    async () => {
      const { rawClient } = await loadFreshClient()
      assert.throws(() => touch(rawClient), /TURSO_AUTH_TOKEN is required in production/)
    }
  )
})

test('운영 + 원격 URL + 공백뿐인 토큰 → 던진다(빈 문자열·개행만 남은 설정 실수)', async () => {
  await withEnv(
    {
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'https://example-not-a-real-db.turso.io',
      TURSO_AUTH_TOKEN: '   \n',
    },
    async () => {
      const { rawClient } = await loadFreshClient()
      assert.throws(() => touch(rawClient), /TURSO_AUTH_TOKEN is required in production/)
    }
  )
})

test('운영 + URL 자체가 없음 → 여전히 URL 쪽 메시지로 던진다(기존 계약 보존)', async () => {
  await withEnv(
    { NODE_ENV: 'production', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: undefined },
    async () => {
      const { rawClient } = await loadFreshClient()
      assert.throws(() => touch(rawClient), /TURSO_DATABASE_URL is required in production/)
    }
  )
})

test('거짓 실패 방지: 운영 + 파일 DB는 토큰 없이도 통과한다', async () => {
  await withEnv(
    {
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: 'file:/tmp/ggac-db-client-credentials-test.db',
      TURSO_AUTH_TOKEN: undefined,
    },
    async () => {
      const { rawClient } = await loadFreshClient()
      assert.doesNotThrow(() => touch(rawClient))
    }
  )
})

test('거짓 실패 방지: 운영 + `turso dev` 루프백은 토큰 없이도 통과한다', async () => {
  for (const url of ['http://127.0.0.1:8901', 'http://localhost:8901', 'http://[::1]:8901']) {
    await withEnv(
      { NODE_ENV: 'production', TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: undefined },
      async () => {
        const { rawClient } = await loadFreshClient()
        assert.doesNotThrow(() => touch(rawClient), `${url}은 토큰을 요구하면 안 된다`)
      }
    )
  }
})

test('개발/테스트 환경은 이 가드가 아예 적용되지 않는다', async () => {
  await withEnv(
    {
      NODE_ENV: 'development',
      TURSO_DATABASE_URL: 'libsql://example-not-a-real-db.turso.io',
      TURSO_AUTH_TOKEN: undefined,
    },
    async () => {
      const { rawClient } = await loadFreshClient()
      assert.doesNotThrow(() => touch(rawClient))
    }
  )
})
