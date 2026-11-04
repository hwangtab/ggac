import { test, expect, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'
import { del, put } from '@vercel/blob'
import { readFileSync } from 'node:fs'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'
import { cronHeaders } from './helpers/cron'

assertLocalTurso()

/**
 * 조합원 내 문서함 권한 경계(docs/board-work/04-조합원-문서함.md §4·§5·§7). **짝 단정**이다 — 막히는 쪽만 보면 라우트가
 * 늘 404 인 것과 구분되지 않으므로, 같은 요청을 주인은 통과하고(또는 저장소 단계까지 가고) 남은 막히는지 함께 본다.
 *
 * 시드(`seed-authz-fixtures.mjs`): `owner`의 문서 하나(v1, `member-documents/<owner>/<버전>/authz_seed.docx`)와 임시
 * 업로드 하나, 스위치 켬. 시험용 Blob 토큰(`BOARD_WORK_TEST_BLOB_TOKEN`)이 있으면 그 키에 객체를 심어 주인의 내려받기가
 * 실제로 200 인지까지 본다(없으면 주인은 저장소 503 — 여전히 404 가 아니다).
 */

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MB = 1024 * 1024

function db() {
  return createClient({ url: process.env.TURSO_DATABASE_URL! })
}

async function setSwitch(enabled: boolean) {
  const client = db()
  try {
    const res = await client.execute({
      sql: `UPDATE system_settings SET setting_value = ?, updated_at = ?
            WHERE category = 'features' AND setting_key = 'member_documents'`,
      args: [JSON.stringify({ enabled }), Date.now()],
    })
    if (res.rowsAffected !== 1) {
      throw new Error(
        `features/member_documents 행이 ${res.rowsAffected}개 갱신됐다 — 시드를 먼저 돌렸는지 확인할 것`
      )
    }
  } finally {
    client.close()
  }
}

const testToken = process.env.BOARD_WORK_TEST_BLOB_TOKEN
const seedBytes = readFileSync('public/doc-templates/blank.docx')

async function asRole(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string | undefined,
  role: string
) {
  return playwright.request.newContext({ baseURL, storageState: storageStatePath(role) })
}

test.describe('내 문서함 권한 경계', () => {
  test.describe.configure({ mode: 'serial' })

  // 시험 저장소에 심는 객체 키는 실행마다 새로 정한다 — 같은 키를 지웠다 다시 올리면 Blob 의 CDN 이 한동안 지운 상태(404)를
  // 내준다(2026-11-04 실측: 연달아 두 번 돌린 두 번째 실행에서 주인 내려받기가 404). 시드 버전 행의 경로를 그 키로 바꾼다.
  let seededPath: string | null = null

  test.beforeAll(async () => {
    await setSwitch(true)
    if (testToken) {
      const f = readFixtures()
      seededPath = `member-documents/${f.users.owner}/${f.memberDocumentVersionId}/authz_seed_${Date.now()}.docx`
      await put(seededPath, seedBytes, {
        access: 'private',
        token: testToken,
        contentType: DOCX_MIME,
        addRandomSuffix: false,
        allowOverwrite: true,
      })
      const client = db()
      try {
        await client.execute({
          sql: 'UPDATE member_document_versions SET blob_path = ? WHERE id = ?',
          args: [seededPath, f.memberDocumentVersionId],
        })
      } finally {
        client.close()
      }
    }
  })

  test.afterAll(async () => {
    await setSwitch(true)
    if (testToken && seededPath) {
      await del(seededPath, { token: testToken }).catch(() => undefined)
    }
  })

  test('목록: 주인에게만 자기 문서가 보인다', async ({ playwright, baseURL }) => {
    const f = readFixtures()
    const owner = await asRole(playwright, baseURL, 'owner')
    const other = await asRole(playwright, baseURL, 'other')
    try {
      const mine = await owner.get('/api/mypage/documents')
      expect(mine.status()).toBe(200)
      const mineBody = await mine.json()
      expect(mineBody.data.documents.map((d: { id: string }) => d.id)).toContain(f.memberDocumentId)
      expect(mineBody.data.usage.quota).toBe(200 * MB)

      const theirs = await other.get('/api/mypage/documents')
      expect(theirs.status()).toBe(200)
      expect((await theirs.json()).data.documents.map((d: { id: string }) => d.id)).not.toContain(
        f.memberDocumentId
      )
    } finally {
      await owner.dispose()
      await other.dispose()
    }
  })

  test('다른 조합원은 주인의 문서·버전·임시 업로드 id 로 모든 라우트에서 404 다(주인은 통과)', async ({
    playwright,
    baseURL,
  }) => {
    const f = readFixtures()
    const doc = f.memberDocumentId
    const ver = f.memberDocumentVersionId
    const owner = await asRole(playwright, baseURL, 'owner')
    const other = await asRole(playwright, baseURL, 'other')
    try {
      // 읽기 — 주인 200, 남 404
      for (const path of [`/api/mypage/documents/${doc}`]) {
        expect((await owner.get(path)).status(), path).toBe(200)
        expect((await other.get(path)).status(), path).toBe(404)
      }
      // 내용(원본·이름 붙은 미리보기·변환) — 주인은 권한을 지나 저장소 단계(시험 토큰이면 200, 없으면 503), 남은 404
      for (const path of [
        `/api/mypage/documents/files/${ver}?download=1`,
        `/api/mypage/documents/files/${ver}`,
        `/api/mypage/documents/files/${ver}/${encodeURIComponent('authz 시드 문서.docx')}`,
        `/api/mypage/documents/files/${ver}/render`,
      ]) {
        const mine = await owner.get(path, { maxRedirects: 0 })
        expect(mine.status(), `주인 ${path}`).not.toBe(404)
        if (testToken && !path.endsWith('.docx')) expect(mine.status(), `주인 ${path}`).toBe(200)
        expect((await other.get(path, { maxRedirects: 0 })).status(), `남 ${path}`).toBe(404)
      }
      if (testToken) {
        const body = await (await owner.get(`/api/mypage/documents/files/${ver}?download=1`)).body()
        expect([...body.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
      }

      // 쓰기 — 남은 404, 문서는 그대로
      expect(
        (await other.patch(`/api/mypage/documents/${doc}`, { data: { name: '가로채기' } })).status()
      ).toBe(404)
      expect((await other.delete(`/api/mypage/documents/${doc}`)).status()).toBe(404)
      expect(
        (
          await other.post(`/api/mypage/documents/${doc}/versions`, {
            data: { restoreVersionId: ver },
          })
        ).status()
      ).toBe(404)
      expect(
        (
          await other.post(`/api/mypage/documents/${doc}/versions`, {
            data: { uploadId: f.memberDocumentPendingId, source: 'upload' },
          })
        ).status()
      ).toBe(404)
      // 남의 문서로 새 버전 업로드 준비
      expect(
        (
          await other.post('/api/mypage/documents/uploads', {
            data: { type: 'prepare', name: 'x.docx', size: 10, mime: DOCX_MIME, documentId: doc },
          })
        ).status()
      ).toBe(404)
      // 남의 임시 업로드 — 버리기·토큰·승격
      expect(
        (await other.delete(`/api/mypage/documents/uploads/${f.memberDocumentPendingId}`)).status()
      ).toBe(404)
      const tokenBody = (uploadId: string, pathname: string) => ({
        type: 'blob.generate-client-token',
        payload: { pathname, multipart: false, clientPayload: uploadId },
      })
      expect(
        (
          await other.post('/api/mypage/documents/uploads', {
            data: tokenBody(f.memberDocumentPendingId, f.memberDocumentPendingPath),
          })
        ).status()
      ).toBe(404)
      expect(
        (
          await other.post('/api/mypage/documents', {
            data: { uploadId: f.memberDocumentPendingId },
          })
        ).status()
      ).toBe(404)
      // 주인: 토큰 경로가 다르면 403, 같으면 통과(시험 토큰이 없으면 저장소 503)
      expect(
        (
          await owner.post('/api/mypage/documents/uploads', {
            data: tokenBody(
              f.memberDocumentPendingId,
              f.memberDocumentPendingPath.replace('authz_pending', 'other')
            ),
          })
        ).status()
      ).toBe(403)
      const granted = await owner.post('/api/mypage/documents/uploads', {
        data: tokenBody(f.memberDocumentPendingId, f.memberDocumentPendingPath),
      })
      expect(granted.status()).toBe(testToken ? 200 : 503)

      // 이름 바꾸기는 주인만 — 바뀐 이름이 다시 읽힌다(그리고 되돌린다)
      const renamed = await owner.patch(`/api/mypage/documents/${doc}`, {
        data: { name: '이름 바꾼 시드' },
      })
      expect(renamed.status()).toBe(200)
      expect((await renamed.json()).data.name).toBe('이름 바꾼 시드.docx')
      await owner.patch(`/api/mypage/documents/${doc}`, { data: { name: 'authz 시드 문서' } })
    } finally {
      await owner.dispose()
      await other.dispose()
    }
  })

  test('주인의 문서 화면은 열리고, 남이 같은 주소를 열면 404 화면이다(문서 이름이 새지 않는다)', async ({
    browser,
  }) => {
    // 마이페이지는 `loading.tsx`로 스트리밍을 먼저 시작해 notFound()가 상태 코드 404를 내지 못한다(본문은 404 화면).
    // 그래서 상태 코드가 아니라 **화면 내용**으로 짝을 본다 — 주인에게는 문서 이름이, 남에게는 404 화면만.
    const f = readFixtures()
    const owner = await browser.newContext({ storageState: storageStatePath('owner') })
    const other = await browser.newContext({ storageState: storageStatePath('other') })
    try {
      const mine = await owner.newPage()
      await mine.goto(`/mypage/documents/${f.memberDocumentId}`)
      await expect(mine.getByTestId('member-document-detail')).toBeVisible()
      await expect(mine.getByRole('heading', { name: 'authz 시드 문서.docx' })).toBeVisible()
      for (const path of [
        `/mypage/documents/${f.memberDocumentId}`,
        `/mypage/documents/${f.memberDocumentId}/edit`,
      ]) {
        const theirs = await other.newPage()
        await theirs.goto(path)
        await expect(theirs.getByText('404 — NOT FOUND')).toBeVisible()
        await expect(theirs.getByTestId('member-document-detail')).toHaveCount(0)
        await expect(theirs.getByTestId('member-document-edit-screen')).toHaveCount(0)
        expect(await theirs.content()).not.toContain('authz 시드 문서')
      }
    } finally {
      await owner.close()
      await other.close()
    }
  })

  test('비로그인 401 · 미승인 403 · 정지 403 — 같은 요청에 승인 조합원은 200', async ({
    playwright,
    baseURL,
  }) => {
    const f = readFixtures()
    const anon = await playwright.request.newContext({ baseURL })
    const pending = await asRole(playwright, baseURL, 'pending')
    const suspended = await asRole(playwright, baseURL, 'suspended')
    const owner = await asRole(playwright, baseURL, 'owner')
    try {
      const reqs: [string, (c: APIRequestContext) => Promise<{ status: () => number }>][] = [
        ['GET 목록', c => c.get('/api/mypage/documents')],
        ['GET 상태', c => c.get('/api/mypage/documents/status')],
        ['GET 문서', c => c.get(`/api/mypage/documents/${f.memberDocumentId}`)],
        [
          'POST 업로드 준비',
          c =>
            c.post('/api/mypage/documents/uploads', {
              data: { type: 'prepare', name: 'a.pdf', size: 10, mime: 'application/pdf' },
            }),
        ],
      ]
      for (const [label, send] of reqs) {
        expect((await send(anon)).status(), `비로그인 ${label}`).toBe(401)
        expect((await send(pending)).status(), `미승인 ${label}`).toBe(403)
        expect((await send(suspended)).status(), `정지 ${label}`).toBe(403)
      }
      expect((await owner.get('/api/mypage/documents')).status()).toBe(200)
      expect((await owner.get(`/api/mypage/documents/${f.memberDocumentId}`)).status()).toBe(200)
    } finally {
      await anon.dispose()
      await pending.dispose()
      await suspended.dispose()
      await owner.dispose()
    }
  })

  test('기능 스위치를 끄면 API 503·화면 "준비 중"·메뉴 숨김, 켜면 다시 열린다', async ({
    playwright,
    baseURL,
    browser,
  }) => {
    const f = readFixtures()
    const owner = await asRole(playwright, baseURL, 'owner')
    const pageCtx = await browser.newContext({ storageState: storageStatePath('owner') })
    try {
      await setSwitch(false)
      expect((await owner.get('/api/mypage/documents')).status()).toBe(503)
      expect((await owner.get(`/api/mypage/documents/${f.memberDocumentId}`)).status()).toBe(503)
      expect(
        (await owner.get(`/api/mypage/documents/files/${f.memberDocumentVersionId}`)).status()
      ).toBe(503)
      expect(
        (
          await owner.post('/api/mypage/documents/uploads', {
            data: { type: 'prepare', name: 'a.pdf', size: 10, mime: 'application/pdf' },
          })
        ).status()
      ).toBe(503)
      const status = await owner.get('/api/mypage/documents/status')
      expect(status.status()).toBe(200)
      expect((await status.json()).data.enabled).toBe(false)

      const page = await pageCtx.newPage()
      await page.goto('/mypage/documents')
      await expect(page.getByTestId('member-documents-off')).toBeVisible()
      await page.goto('/mypage')
      await expect(page.getByRole('link', { name: '활동 내역' })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('link', { name: '내 문서함' })).toHaveCount(0)

      await setSwitch(true)
      expect((await owner.get('/api/mypage/documents')).status()).toBe(200)
      await page.goto('/mypage')
      await expect(page.getByRole('link', { name: '내 문서함' })).toBeVisible({ timeout: 15_000 })
      await page.goto('/mypage/documents')
      await expect(page.getByTestId('member-documents-list')).toBeVisible()
    } finally {
      await setSwitch(true)
      await owner.dispose()
      await pageCtx.close()
    }
  })

  test('용량(200MB)을 넘으면 업로드 준비·토큰이 413, 남으면 통과한다', async ({
    playwright,
    baseURL,
  }) => {
    const f = readFixtures()
    const owner = await asRole(playwright, baseURL, 'owner')
    const client = db()
    const bigId = crypto.randomUUID()
    let preparedId: string | null = null
    try {
      // 통과 쪽 — 지금은 여유가 있다
      const ok = await owner.post('/api/mypage/documents/uploads', {
        data: { type: 'prepare', name: 'small.pdf', size: MB, mime: 'application/pdf' },
      })
      expect(ok.status()).toBe(testToken ? 200 : 503)
      if (ok.status() === 200) preparedId = (await ok.json()).data.target.uploadId

      // 같은 문서에 199MB 짜리 버전 행을 끼워 사용량을 채운다(객체는 없다 — 행 크기로 센다)
      await client.execute({
        sql: `INSERT INTO member_document_versions
                (id, document_id, owner_id, version_no, name, mime, size, blob_path, source, created_at)
              VALUES (?, ?, ?, 99, 'big.docx', ?, ?, ?, 'upload', ?)`,
        args: [
          bigId,
          f.memberDocumentId,
          f.users.owner,
          DOCX_MIME,
          199 * MB,
          `member-documents/${f.users.owner}/${bigId}/big.docx`,
          Date.now(),
        ],
      })
      const over = await owner.post('/api/mypage/documents/uploads', {
        data: { type: 'prepare', name: 'small.pdf', size: MB, mime: 'application/pdf' },
      })
      expect(over.status()).toBe(413)
      expect((await over.json()).error).toContain('200MB')
      // 토큰 단계에서도 다시 본다(시드 임시 업로드 1KB + 버전들 > 200MB 는 아니므로, 크기를 늘려 넘긴다)
      await client.execute({
        sql: 'UPDATE member_document_uploads SET size = ? WHERE id = ?',
        args: [2 * MB, f.memberDocumentPendingId],
      })
      const tokenOver = await owner.post('/api/mypage/documents/uploads', {
        data: {
          type: 'blob.generate-client-token',
          payload: {
            pathname: f.memberDocumentPendingPath,
            multipart: false,
            clientPayload: f.memberDocumentPendingId,
          },
        },
      })
      expect(tokenOver.status()).toBe(413)
      // 되돌리기 복사도 용량을 본다
      const restore = await owner.post(`/api/mypage/documents/${f.memberDocumentId}/versions`, {
        data: { restoreVersionId: bigId },
      })
      expect(restore.status()).toBe(413)
    } finally {
      await client.execute({
        sql: 'DELETE FROM member_document_versions WHERE id = ?',
        args: [bigId],
      })
      await client.execute({
        sql: 'UPDATE member_document_uploads SET size = 1024 WHERE id = ?',
        args: [f.memberDocumentPendingId],
      })
      if (preparedId) await owner.delete(`/api/mypage/documents/uploads/${preparedId}`)
      client.close()
      await owner.dispose()
    }
  })

  test('보존 크론은 CRON_SECRET 없이는 401, 맞으면 200', async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL })
    try {
      const path = '/api/internal/member-documents/retention'
      expect((await anon.post(path)).status()).toBe(401)
      expect((await anon.post(path, { headers: cronHeaders('wrong-secret') })).status()).toBe(401)
      expect((await anon.post(path, { headers: cronHeaders() })).status()).toBe(200)
    } finally {
      await anon.dispose()
    }
  })
})
