import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * 적대 감사(2026-08-27) — `drizzle-kit push` 한 번이 성능 인덱스 23개를 전부
 * 지운다(실측: 23 → 0, `SEARCH` → `SCAN`). `0004`·`0005`가 만든 인덱스가
 * Drizzle 스키마에 `index()`로 선언돼 있지 않아 push가 잉여로 보기 때문이다.
 *
 * 더 나쁜 건 `scripts/turso/README.md`가 `.env.local`을 로드한 뒤 push하라고
 * 안내했다는 것 — **문서를 따르는 것만으로 운영이 망가지고 에러도 안 난다.**
 *
 * `drizzle.config.ts`가 원격 URL이면 던지게 했고, 이 테스트가 그걸 못박는다.
 * 설정 파일을 실제로 로드해 판정하므로 소스 문자열 검사가 아니다.
 */
function loadConfig(url) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ggac-drizzle-guard-'))
  try {
    // 별도 프로세스로 로드해야 모듈 캐시와 throw가 격리된다.
    const script = `import('${pathToFileUrl('drizzle.config.ts')}').then(()=>{console.log('LOADED')}).catch(e=>{console.log('THREW:'+e.message.split('\\n')[0])})`
    return execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      { encoding: 'utf8', env: { ...process.env, TURSO_DATABASE_URL: url }, cwd: process.cwd() }
    ).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
function pathToFileUrl(rel) {
  return new URL(rel, `file://${process.cwd()}/`).href
}

test('로컬 file: 대상은 통과한다 (개발·CI가 막히면 안 된다)', () => {
  assert.match(loadConfig('file:./local.db'), /LOADED/)
})

test('루프백 대상은 통과한다 (turso dev)', () => {
  assert.match(loadConfig('http://127.0.0.1:8899'), /LOADED/)
})

test('원격 libsql 대상은 던진다 — 인덱스 23개가 날아가는 경로다', () => {
  const out = loadConfig('libsql://ggac-prod-example.turso.io')
  assert.match(out, /THREW/)
  assert.match(out, /원격 DB를 가리키고 있다/)
})

test('원격 https 대상도 던진다', () => {
  assert.match(loadConfig('https://ggac-prod-example.turso.io'), /THREW/)
})

test('파싱 불가한 값은 막는다 (모호하면 거부)', () => {
  assert.match(loadConfig('not-a-url'), /THREW/)
})
