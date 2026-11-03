import { test, expect } from '@playwright/test'
import { createClient } from '@libsql/client'
import { del, head, put } from '@vercel/blob'

import { assertLocalTurso, readFixtures } from './helpers/authState'
import { cronHeaders } from './helpers/cron'

assertLocalTurso()

/**
 * 이사회 업무툴 정리 크론(5단계) — `purge-pending-uploads`를 **운영 빌드 서버 + 시험용 Blob 저장소**로 끝까지 본다.
 *
 * ⚠️ 시험용 저장소 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)이 있어야만 돈다 — 없으면 건너뛴다. 이 스펙은 운영 비공개 저장소
 * (DB 백업·메일 첨부가 든다)를 **절대** 쓰지 않는다: 객체를 심고 확인하는 것도 이 토큰이고, 서버도
 * playwright.config.ts가 `BOARD_WORK_BLOB_READ_WRITE_TOKEN`을 이 값으로 넘긴다. 크론은 로컬 전용 CRON_SECRET으로 부른다.
 *
 * 심는 것:
 *  - 오래된 임시 업로드: `board-work/files/<id>/stale.txt` 객체 + 30시간 전 행 → **지워져야 한다**
 *  - 새 임시 업로드: 객체 + 1시간 전 행 → 남아야 한다(24시간 보존)
 *  - 행 없는 새 객체(고아 후보): 올린 지 24시간이 안 됐으니 남아야 한다(업로드 중일 수 있다)
 *  - `board-work/` 밖 표지 객체: 남아야 한다(크론이 다른 접두를 건드리지 않는다)
 * 끝나면 남은 객체·행을 이 스펙이 지운다.
 */
test.skip(
  !process.env.BOARD_WORK_TEST_BLOB_TOKEN,
  'BOARD_WORK_TEST_BLOB_TOKEN(시험용 Blob 저장소)이 없어 정리 크론 E2E를 건너뛴다'
)

const token = () => process.env.BOARD_WORK_TEST_BLOB_TOKEN as string

async function putText(pathname: string, text: string) {
  await put(pathname, text, {
    access: 'private',
    token: token(),
    contentType: 'text/plain',
    addRandomSuffix: false,
    allowOverwrite: true,
  })
}

async function exists(pathname: string): Promise<boolean> {
  try {
    await head(pathname, { token: token() })
    return true
  } catch (e) {
    if (e instanceof Error && /not.?found|does not exist|404/i.test(`${e.name} ${e.message}`)) {
      return false
    }
    throw e
  }
}

test('purge-pending-uploads: 24시간 넘은 임시 업로드만 지우고 board-work 밖·보존 기간 안은 건드리지 않는다', async ({
  playwright,
  baseURL,
}) => {
  test.setTimeout(120_000)
  const f = readFixtures()
  const db = createClient({ url: process.env.TURSO_DATABASE_URL! })
  const staleId = crypto.randomUUID()
  const freshId = crypto.randomUUID()
  const orphanId = crypto.randomUUID()
  const stalePath = `board-work/files/${staleId}/stale.txt`
  const freshPath = `board-work/files/${freshId}/fresh.txt`
  const orphanPath = `board-work/files/${orphanId}/orphan.txt`
  const sentinelPath = `e2e-sentinel/${crypto.randomUUID()}.txt`
  const now = Date.now()

  const insertPending = (id: string, path: string, ageHours: number) =>
    db.execute({
      sql: `insert into work_pending_uploads (id, channel_id, uploader_id, blob_path, name, mime, size, created_at)
            values (?, ?, ?, ?, ?, 'text/plain', 5, ?)`,
      args: [
        id,
        f.workPublicChannelId,
        f.users.director,
        path,
        path.split('/').pop()!,
        now - ageHours * 3600_000,
      ],
    })

  const anon = await playwright.request.newContext({ baseURL })
  try {
    await Promise.all([
      putText(stalePath, 'stale'),
      putText(freshPath, 'fresh'),
      putText(orphanPath, 'orphan'),
      putText(sentinelPath, 'sentinel'),
    ])
    await insertPending(staleId, stalePath, 30)
    await insertPending(freshId, freshPath, 1)
    for (const p of [stalePath, freshPath, orphanPath, sentinelPath]) {
      expect(await exists(p), `심은 객체 ${p}`).toBe(true)
    }

    // 짝: 시크릿 없이는 아무것도 지워지지 않는다
    expect((await anon.get('/api/internal/board-work/purge-pending-uploads')).status()).toBe(401)
    expect(await exists(stalePath)).toBe(true)

    const res = await anon.get('/api/internal/board-work/purge-pending-uploads', {
      headers: cronHeaders(),
    })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as {
      data: { purged: number; unsafe: number; orphans: { removed: number } | null }
    }
    expect(body.data.purged).toBeGreaterThanOrEqual(1)
    expect(body.data.unsafe).toBe(0)
    expect(body.data.orphans).not.toBeNull()

    // 지워진 것: 오래된 임시 업로드의 객체와 행
    expect(await exists(stalePath)).toBe(false)
    const staleRow = await db.execute({
      sql: 'select count(*) as n from work_pending_uploads where id = ?',
      args: [staleId],
    })
    expect(Number(staleRow.rows[0].n)).toBe(0)

    // 남은 것: 보존 기간 안의 임시 업로드·행 없는 새 객체·board-work 밖 표지
    expect(await exists(freshPath)).toBe(true)
    const freshRow = await db.execute({
      sql: 'select count(*) as n from work_pending_uploads where id = ?',
      args: [freshId],
    })
    expect(Number(freshRow.rows[0].n)).toBe(1)
    expect(await exists(orphanPath)).toBe(true)
    expect(await exists(sentinelPath)).toBe(true)
  } finally {
    await anon.dispose()
    await db.execute({
      sql: 'delete from work_pending_uploads where id in (?, ?)',
      args: [staleId, freshId],
    })
    db.close()
    await del([stalePath, freshPath, orphanPath, sentinelPath], { token: token() }).catch(
      () => undefined
    )
  }
})
