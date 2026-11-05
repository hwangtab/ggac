import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'

registerAliasResolveHook(import.meta.url)

/**
 * 이사회 서류 JSON 등록의 경합 — 거의 동시에 온 같은 `file_path`의 두 등록이 둘 다 "아직 없음"을 보고 행 두 개를 만들던
 * 결함(확인과 삽입이 따로였다). `createDocumentIfPathFree`는 둘을 쓰기 트랜잭션(BEGIN IMMEDIATE) 하나로 묶는다.
 *
 * 로컬 `file:` 드라이버는 두 번째 BEGIN IMMEDIATE 를 기다리지 않고 `SQLITE_BUSY`로 튕기고, 그 뒤로 이 프로세스의 트랜잭션이
 * 계속 잠긴 것처럼 남는 실측 결함이 있다(`queriesFundingRefundContention.test.mjs` 머리 주석). 그래서 이 파일은 **테스트
 * 하나만** 담고, 진 쪽은 null 이든 잠금 오류든 "행을 만들지 않았다"만 본다. 운영(원격 Turso)은 쓰기가 줄을 서고, 진 쪽은
 * 재시도 끝에 이긴 쪽 행을 보고 null(→ 409)이 된다.
 */

const DB_PATH = 'scripts/testing/.queries-board-document-register-race.db'
const src = rel => new URL(`../../src/${rel}`, import.meta.url).href

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let setupClient
let board

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
  await setupClient.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active, is_director) VALUES ('11111111-1111-4111-8111-111111111111','이사','race@test.local','approved',1,1)"
  )
  board = await import(src('db/queries/board.ts'))
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

test('같은 경로의 두 등록을 동시에 — 행은 정확히 하나', async () => {
  const me = '11111111-1111-4111-8111-111111111111'
  const filePath = `${me}/1750000000004_mno_race.pdf`
  const input = {
    title: '제10차 이사회 회의록',
    category: '회의록',
    filePath,
    fileName: '회의록.pdf',
    fileSize: 1234,
    mimeType: 'application/pdf',
    uploadedBy: me,
    visibility: 'board',
  }
  const results = await Promise.allSettled([
    board.createDocumentIfPathFree(input),
    board.createDocumentIfPathFree(input),
  ])
  const created = results.filter(r => r.status === 'fulfilled' && r.value?.id)
  assert.equal(created.length, 1, '하나만 만들어진다')
  for (const r of results) {
    if (r.status === 'fulfilled') continue
    assert.match(String(r.reason?.message ?? r.reason), /SQLITE_BUSY|locked/i)
  }
  const n = await setupClient.execute({
    sql: 'SELECT count(*) AS n FROM board_documents WHERE file_path = ?',
    args: [filePath],
  })
  assert.equal(Number(n.rows[0].n), 1)
})
