import { test, expect, type APIRequestContext } from '@playwright/test'
import { createClient } from '@libsql/client'
import { del, put } from '@vercel/blob'
import { readFileSync } from 'node:fs'

import { assertLocalTurso, readFixtures, storageStatePath } from './helpers/authState'

assertLocalTurso()

/**
 * 이사회 서류 앱 편집의 권한 경계(docs/board-work/05-이사회-서류-앱-편집.md §4 권한 표). **짝 단정**이다 — 막히는 쪽만 보면
 * 라우트가 늘 403·404 인 것과 구분되지 않으므로, 같은 요청을 고칠 수 있는 사람(올린 사람·관리자)은 통과하고(또는 저장소
 * 단계까지 가고) 나머지는 막히는지 함께 본다.
 *
 * - 고칠 수 있는 사람 = 지울 수 있는 사람: 서류를 올린 이사(`director`)와 관리자(`admin`). 다른 이사·감사(`auditor`)는 403.
 * - 조합원(`owner` — 조합원 공개 서류를 **읽을 수 있는** 사람)·미승인(`pending`)은 모든 새 라우트에서 403, 비로그인은 401.
 * - 없는 서류·남의 서류의 버전 id·UUID 가 아닌 id 는 모든 새 라우트에서 404.
 * - PDF 등 편집기가 열지 못하는 형식은 편집 진입이 없다(415).
 *
 * 서류는 이 파일이 직접 심는다(고정 id `…e2xx` — 다른 스펙·시드와 겹치지 않는다). 시험용 Blob 토큰
 * (`BOARD_WORK_TEST_BLOB_TOKEN`)이 있으면 실행마다 새 키에 객체를 심어 지나간 버전 내려받기·되돌리기가 실제로 끝까지
 * 도는지까지 본다(없으면 허용 쪽은 저장소 503 — 여전히 401·403·404 가 아니다).
 */

const DOC_BOARD = '00000000-0000-4000-8000-00000000e201'
const DOC_MEMBERS = '00000000-0000-4000-8000-00000000e202'
const DOC_PDF = '00000000-0000-4000-8000-00000000e203'
const DOC_VERSIONED = '00000000-0000-4000-8000-00000000e204'
const VERSIONED_V1 = '00000000-0000-4000-8000-00000000e205'
const VERSIONED_V2 = '00000000-0000-4000-8000-00000000e206'
const MISSING = '00000000-0000-4000-8000-00000000e2ff'
const SEEDED = [DOC_BOARD, DOC_MEMBERS, DOC_PDF, DOC_VERSIONED]

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const testToken = process.env.BOARD_WORK_TEST_BLOB_TOKEN
const editorOn = Boolean(process.env.NEXT_PUBLIC_OFFICE_EDITOR_ORIGIN)
const seedBytes = readFileSync('public/doc-templates/blank.docx')

/** 허용 쪽: 권한을 지났다 — 막힘(401·403·404)이 아니다. 저장소·편집기 env 가 없는 배포면 503·415 일 수 있다 */
const PASSED_GATE = (status: number) => ![401, 403, 404].includes(status)

function db() {
  return createClient({ url: process.env.TURSO_DATABASE_URL! })
}

async function asRole(
  playwright: { request: { newContext: (o: object) => Promise<APIRequestContext> } },
  baseURL: string | undefined,
  role: string | null
) {
  return playwright.request.newContext(
    role ? { baseURL, storageState: storageStatePath(role) } : { baseURL }
  )
}

/** 실행마다 새 키(같은 키를 지웠다 다시 올리면 Blob CDN 이 한동안 404 를 준다 — 문서함 권한 E2E와 같은 이유) */
const stamp = Date.now()
const legacyPath = (name: string) => `seed/authz-bde-${stamp}-${name}`
const v2Path = `versions/${DOC_VERSIONED}/${VERSIONED_V2}/authz_bde_${stamp}.docx`

async function seed() {
  const f = readFixtures()
  const director = f.users.director
  const client = db()
  try {
    await client.execute({
      sql: `DELETE FROM board_documents WHERE id IN (${SEEDED.map(() => '?').join(',')})`,
      args: SEEDED,
    })
    const rows: [string, string, string, string, string, string][] = [
      [
        DOC_BOARD,
        'authz 앱편집 이사회 서류',
        'board',
        legacyPath('board.docx'),
        '회의록.docx',
        DOCX_MIME,
      ],
      [
        DOC_MEMBERS,
        'authz 앱편집 조합원 공개 서류',
        'members',
        legacyPath('members.docx'),
        '공개.docx',
        DOCX_MIME,
      ],
      [
        DOC_PDF,
        'authz 앱편집 PDF 서류',
        'board',
        legacyPath('scan.pdf'),
        '스캔.pdf',
        'application/pdf',
      ],
      [DOC_VERSIONED, 'authz 앱편집 버전 있는 서류', 'board', v2Path, '버전.docx', DOCX_MIME],
    ]
    for (const [id, title, visibility, path, name, mime] of rows) {
      await client.execute({
        sql: `INSERT INTO board_documents
                (id, title, category, file_path, file_name, file_size, mime_type, uploaded_by, body_markdown, visibility, created_at)
              VALUES (?, ?, '기타', ?, ?, ?, ?, ?, NULL, ?, ?)`,
        args: [id, title, path, name, seedBytes.length, mime, director, visibility, Date.now()],
      })
    }
    for (const [vid, no, path, source] of [
      [VERSIONED_V1, 1, legacyPath('versioned-v1.docx'), 'upload'],
      [VERSIONED_V2, 2, v2Path, 'office-editor'],
    ] as const) {
      await client.execute({
        sql: `INSERT INTO board_document_versions
                (id, document_id, version_no, file_path, file_name, file_size, mime_type, source, created_by, body_markdown, created_at)
              VALUES (?, ?, ?, ?, '버전.docx', ?, ?, ?, ?, NULL, ?)`,
        args: [
          vid,
          DOC_VERSIONED,
          no,
          path,
          seedBytes.length,
          DOCX_MIME,
          source,
          director,
          Date.now() - (3 - no) * 1000,
        ],
      })
    }
  } finally {
    client.close()
  }
  if (testToken) {
    for (const p of [
      legacyPath('board.docx'),
      legacyPath('members.docx'),
      legacyPath('versioned-v1.docx'),
      v2Path,
    ]) {
      await put(`board-documents/${p}`, seedBytes, {
        access: 'private',
        token: testToken,
        contentType: DOCX_MIME,
        addRandomSuffix: false,
        allowOverwrite: true,
      })
    }
  }
}

async function versionCount(documentId: string): Promise<number> {
  const client = db()
  try {
    const rs = await client.execute({
      sql: 'SELECT count(*) n FROM board_document_versions WHERE document_id = ?',
      args: [documentId],
    })
    return Number(rs.rows[0].n)
  } finally {
    client.close()
  }
}

const prepareBody = { type: 'prepare', name: '회의록.docx', size: 1024 }
const tokenBody = (documentId: string, uploadId: string) => ({
  type: 'blob.generate-client-token',
  payload: {
    pathname: `board-documents/versions/${documentId}/${uploadId}/a.docx`,
    multipart: false,
    clientPayload: uploadId,
  },
})
const saveBody = {
  uploadId: '00000000-0000-4000-8000-00000000e2aa',
  name: '회의록.docx',
  baseVersionNo: 1,
}

/** 새 라우트 전부(쓰기 셋 + 읽기 둘) — 막히는 쪽 단정에 쓴다 */
function allRoutes(documentId: string, versionId: string) {
  return [
    { method: 'get' as const, path: `/api/board-room/documents/${documentId}/versions` },
    {
      method: 'get' as const,
      path: `/api/board-room/documents/${documentId}/versions/${versionId}/download`,
    },
    {
      method: 'post' as const,
      path: `/api/board-room/documents/${documentId}/edit-uploads`,
      data: prepareBody,
    },
    {
      method: 'post' as const,
      path: `/api/board-room/documents/${documentId}/versions`,
      data: saveBody,
    },
    {
      method: 'post' as const,
      path: `/api/board-room/documents/${documentId}/versions`,
      data: { revertVersionId: versionId },
    },
  ]
}

async function send(
  ctx: APIRequestContext,
  r: { method: 'get' | 'post'; path: string; data?: unknown }
): Promise<number> {
  const res =
    r.method === 'get'
      ? await ctx.get(r.path, { maxRedirects: 0 })
      : await ctx.post(r.path, { data: r.data, maxRedirects: 0 })
  return res.status()
}

test.describe('이사회 서류 앱 편집 권한 경계', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    await seed()
  })

  test.afterAll(async () => {
    const client = db()
    try {
      await client.execute({
        sql: `DELETE FROM board_documents WHERE id IN (${SEEDED.map(() => '?').join(',')})`,
        args: SEEDED,
      })
    } finally {
      client.close()
    }
    if (testToken) {
      await del(
        [
          legacyPath('board.docx'),
          legacyPath('members.docx'),
          legacyPath('versioned-v1.docx'),
          v2Path,
        ].map(p => `board-documents/${p}`),
        { token: testToken }
      ).catch(() => undefined)
    }
  })

  test('비로그인은 모든 새 라우트에서 401 이다', async ({ playwright, baseURL }) => {
    const anon = await asRole(playwright, baseURL, null)
    try {
      for (const r of allRoutes(DOC_VERSIONED, VERSIONED_V1)) {
        expect(await send(anon, r), `${r.method} ${r.path}`).toBe(401)
      }
    } finally {
      await anon.dispose()
    }
  })

  test('조합원(조합원 공개 서류를 읽을 수 있는 사람)·미승인은 모든 새 라우트에서 403 — 읽기는 그대로 된다', async ({
    playwright,
    baseURL,
  }) => {
    const member = await asRole(playwright, baseURL, 'owner')
    const pending = await asRole(playwright, baseURL, 'pending')
    try {
      // 짝: 조합원은 이 서류를 **읽는다**(열람 게이트 + visibility='members') — 그래도 편집·버전 기록은 없다
      expect((await member.get(`/api/board-room/documents/${DOC_MEMBERS}`)).status()).toBe(200)
      for (const id of [DOC_MEMBERS, DOC_VERSIONED]) {
        for (const r of allRoutes(id, VERSIONED_V1)) {
          expect(await send(member, r), `조합원 ${r.method} ${r.path}`).toBe(403)
          expect(await send(pending, r), `미승인 ${r.method} ${r.path}`).toBe(403)
        }
      }
      expect(await versionCount(DOC_MEMBERS)).toBe(0)
    } finally {
      await member.dispose()
      await pending.dispose()
    }
  })

  test('올리지 않은 이사·감사는 403 이고, 올린 사람·관리자는 같은 요청이 권한을 지난다', async ({
    playwright,
    baseURL,
  }) => {
    const uploader = await asRole(playwright, baseURL, 'director')
    const admin = await asRole(playwright, baseURL, 'admin')
    const auditor = await asRole(playwright, baseURL, 'auditor')
    try {
      // 읽기: 버전 기록은 이사회 누구나 본다 — 고칠 수 있는지는 사람마다 다르다
      for (const [ctx, canEdit] of [
        [uploader, true],
        [admin, true],
        [auditor, false],
      ] as const) {
        const res = await ctx.get(`/api/board-room/documents/${DOC_BOARD}/versions`)
        expect(res.status()).toBe(200)
        const body = await res.json()
        expect(body.data.document.canEdit).toBe(canEdit)
        expect(body.data.document.editableHere).toBe(editorOn)
        // 한 번도 고치지 않은 서류 — 지금 파일이 v1 한 줄
        expect(body.data.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([1])
        expect(JSON.stringify(body)).not.toContain('file_path')
        expect(JSON.stringify(body)).not.toContain('seed/authz-bde')
      }

      // 쓰기: 감사(올리지 않은 이사회 구성원)는 403, 올린 사람·관리자는 권한을 지난다
      for (const id of [DOC_BOARD, DOC_VERSIONED]) {
        const writes = allRoutes(id, VERSIONED_V1).filter(r => r.method === 'post')
        for (const r of writes) {
          expect(await send(auditor, r), `감사 ${r.path} ${JSON.stringify(r.data)}`).toBe(403)
        }
        const prepare = writes[0]
        for (const [label, ctx] of [
          ['올린 사람', uploader],
          ['관리자', admin],
        ] as const) {
          const status = await send(ctx, prepare)
          expect(PASSED_GATE(status), `${label} ${prepare.path} → ${status}`).toBe(true)
          if (editorOn && testToken) expect(status, `${label} 업로드 준비`).toBe(200)
        }
      }
      // 저장(올리지 않은 저장본)은 권한을 지나 저장소 단계에서 끝난다 — 버전이 늘지 않는다
      const save = await uploader.post(`/api/board-room/documents/${DOC_BOARD}/versions`, {
        data: saveBody,
      })
      expect(PASSED_GATE(save.status()), `올린 사람 저장 → ${save.status()}`).toBe(true)
      expect(await versionCount(DOC_BOARD)).toBe(0)
    } finally {
      await uploader.dispose()
      await admin.dispose()
      await auditor.dispose()
    }
  })

  test('지나간 버전: 이사회는 내려받고, 되돌리기는 올린 사람·관리자만 — 감사의 되돌리기는 버전을 늘리지 않는다', async ({
    playwright,
    baseURL,
  }) => {
    const admin = await asRole(playwright, baseURL, 'admin')
    const auditor = await asRole(playwright, baseURL, 'auditor')
    try {
      const listed = await auditor.get(`/api/board-room/documents/${DOC_VERSIONED}/versions`)
      expect(listed.status()).toBe(200)
      const versions = (await listed.json()).data.versions
      expect(
        versions.map((v: { versionNo: number; isLatest: boolean }) => [v.versionNo, v.isLatest])
      ).toEqual([
        [2, true],
        [1, false],
      ])
      expect(versions[1].downloadUrl).toBe(
        `/api/board-room/documents/${DOC_VERSIONED}/versions/${VERSIONED_V1}/download`
      )

      // 내려받기(읽기)는 감사도 — 권한을 지나 저장소까지 간다
      const old = await auditor.get(versions[1].downloadUrl)
      expect(PASSED_GATE(old.status()), `감사 v1 내려받기 → ${old.status()}`).toBe(true)
      if (testToken) {
        expect(old.status()).toBe(200)
        expect([...(await old.body()).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
        expect(old.headers()['cache-control']).toContain('no-store')
      }

      const revert = { revertVersionId: VERSIONED_V1 }
      expect(
        (
          await auditor.post(`/api/board-room/documents/${DOC_VERSIONED}/versions`, {
            data: revert,
          })
        ).status()
      ).toBe(403)
      expect(await versionCount(DOC_VERSIONED)).toBe(2)

      // 짝: 관리자는 되돌린다(시험 토큰이면 v3 이 생기고, 없으면 저장소 503)
      const done = await admin.post(`/api/board-room/documents/${DOC_VERSIONED}/versions`, {
        data: revert,
      })
      expect(PASSED_GATE(done.status()), `관리자 되돌리기 → ${done.status()}`).toBe(true)
      if (testToken) {
        expect(done.status()).toBe(201)
        expect((await done.json()).data.versionNo).toBe(3)
        expect(await versionCount(DOC_VERSIONED)).toBe(3)
        // 최신으로는 되돌리지 못한다(지금 최신은 v3)
        const again = await admin.get(`/api/board-room/documents/${DOC_VERSIONED}/versions`)
        const latest = (await again.json()).data.versions[0]
        expect(latest).toMatchObject({ versionNo: 3, source: 'revert', isLatest: true })
        expect(
          (
            await admin.post(`/api/board-room/documents/${DOC_VERSIONED}/versions`, {
              data: { revertVersionId: latest.id },
            })
          ).status()
        ).toBe(409)
      }
    } finally {
      await admin.dispose()
      await auditor.dispose()
    }
  })

  test('없는 서류·남의 서류의 버전·UUID 가 아닌 id 는 모든 새 라우트에서 404 다(관리자도)', async ({
    playwright,
    baseURL,
  }) => {
    const admin = await asRole(playwright, baseURL, 'admin')
    const uploader = await asRole(playwright, baseURL, 'director')
    try {
      for (const ctx of [admin, uploader]) {
        for (const r of allRoutes(MISSING, VERSIONED_V1)) {
          expect(await send(ctx, r), `없는 서류 ${r.method} ${r.path}`).toBe(404)
        }
        for (const r of allRoutes('not-a-uuid', VERSIONED_V1)) {
          expect(await send(ctx, r), `UUID 아님 ${r.method} ${r.path}`).toBe(404)
        }
        // DOC_VERSIONED 의 버전 id 를 DOC_BOARD 로 — 남의 서류 버전은 없는 것과 같다
        expect(
          (
            await ctx.get(
              `/api/board-room/documents/${DOC_BOARD}/versions/${VERSIONED_V1}/download`
            )
          ).status()
        ).toBe(404)
        expect(
          (
            await ctx.get(`/api/board-room/documents/${DOC_BOARD}/versions/not-a-uuid/download`)
          ).status()
        ).toBe(404)
        expect(
          (
            await ctx.post(`/api/board-room/documents/${DOC_BOARD}/versions`, {
              data: { revertVersionId: VERSIONED_V1 },
            })
          ).status()
        ).toBe(404)
      }
      expect(await versionCount(DOC_BOARD)).toBe(0)
    } finally {
      await admin.dispose()
      await uploader.dispose()
    }
  })

  test('업로드 토큰은 이 서류의 버전 키·같은 업로드 id·같은 형식에만 — 다른 서류·다른 영역 경로는 403', async ({
    playwright,
    baseURL,
  }) => {
    test.skip(!editorOn, '편집기 env 가 없으면 토큰 단계 앞에서 415 다')
    const uploader = await asRole(playwright, baseURL, 'director')
    const uploadId = '00000000-0000-4000-8000-00000000e2ab'
    const post = (data: unknown) =>
      uploader.post(`/api/board-room/documents/${DOC_BOARD}/edit-uploads`, { data })
    try {
      // 다른 서류의 키
      expect((await post(tokenBody(DOC_VERSIONED, uploadId))).status()).toBe(403)
      // 업로드 id 구간이 clientPayload 와 다르다
      expect(
        (
          await post({
            ...tokenBody(DOC_BOARD, uploadId),
            payload: { ...tokenBody(DOC_BOARD, uploadId).payload, clientPayload: VERSIONED_V1 },
          })
        ).status()
      ).toBe(403)
      // 다른 형식 · 다른 영역(백업·업무툴)
      for (const pathname of [
        `board-documents/versions/${DOC_BOARD}/${uploadId}/a.html`,
        `backups/versions/${DOC_BOARD}/${uploadId}/a.docx`,
        `board-work/files/${uploadId}/a.docx`,
        `board-documents/seed/a.docx`,
      ]) {
        const status = (
          await post({
            type: 'blob.generate-client-token',
            payload: { pathname, multipart: false, clientPayload: uploadId },
          })
        ).status()
        expect(status, pathname).toBe(403)
      }
      // 짝: 맞는 키면 토큰 단계를 지난다(시험 토큰이 없으면 저장소 503)
      const ok = await post(tokenBody(DOC_BOARD, uploadId))
      expect(PASSED_GATE(ok.status()), `맞는 키 → ${ok.status()}`).toBe(true)
      if (testToken) expect(ok.status()).toBe(200)
    } finally {
      await uploader.dispose()
    }
  })

  test('PDF 처럼 편집기가 열지 못하는 형식은 편집 진입이 없다(415)', async ({
    playwright,
    baseURL,
  }) => {
    const uploader = await asRole(playwright, baseURL, 'director')
    try {
      const listed = await uploader.get(`/api/board-room/documents/${DOC_PDF}/versions`)
      expect(listed.status()).toBe(200)
      expect((await listed.json()).data.document).toMatchObject({
        canEdit: true,
        editableHere: false,
      })
      expect(
        (
          await uploader.post(`/api/board-room/documents/${DOC_PDF}/edit-uploads`, {
            data: { type: 'prepare', name: '스캔.pdf', size: 1024 },
          })
        ).status()
      ).toBe(415)
      // 같은 서류에 docx 저장본을 붙이려 해도 형식이 맞지 않는다
      expect(
        (
          await uploader.post(`/api/board-room/documents/${DOC_PDF}/edit-uploads`, {
            data: prepareBody,
          })
        ).status()
      ).toBe(415)
    } finally {
      await uploader.dispose()
    }
  })

  test('편집 화면: 올린 사람은 편집 화면, 감사는 안내, 조합원은 닿지 못하고, 없는 서류는 404', async ({
    browser,
  }) => {
    test.skip(!editorOn, '편집기 env 가 없으면 편집 화면 대신 안내가 나온다')
    const open = async (role: string) => {
      const context = await browser.newContext({
        storageState: storageStatePath(role),
        viewport: { width: 1280, height: 900 },
      })
      await context.request.get('/api/auth/get-session')
      return { context, page: await context.newPage() }
    }
    const uploader = await open('director')
    const auditor = await open('auditor')
    const member = await open('owner')
    try {
      await uploader.page.goto(`/board-room/documents/${DOC_BOARD}/edit`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(uploader.page.getByTestId('board-document-edit-screen')).toBeVisible({
        timeout: 30_000,
      })

      await auditor.page.goto(`/board-room/documents/${DOC_BOARD}/edit`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(auditor.page.getByTestId('board-document-edit-denied')).toBeVisible({
        timeout: 30_000,
      })
      await expect(auditor.page.getByTestId('board-document-edit-screen')).toHaveCount(0)

      await member.page.goto(`/board-room/documents/${DOC_MEMBERS}/edit`, {
        waitUntil: 'domcontentloaded',
      })
      await expect(member.page).not.toHaveURL(/\/edit$/, { timeout: 30_000 })
      await expect(member.page.getByTestId('board-document-edit-screen')).toHaveCount(0)

      const missing = await uploader.page.goto(`/board-room/documents/${MISSING}/edit`, {
        waitUntil: 'domcontentloaded',
      })
      expect(missing?.status()).toBe(404)
      await expect(uploader.page.getByTestId('board-document-edit-screen')).toHaveCount(0)
    } finally {
      await uploader.context.close()
      await auditor.context.close()
      await member.context.close()
    }
  })
})
