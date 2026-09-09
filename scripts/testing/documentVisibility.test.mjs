import { test } from 'node:test'
import assert from 'node:assert/strict'

const { DOCUMENT_VISIBILITY, isDocumentVisibility } = await import(
  '../../src/constants/boardRoom.ts'
)

test('허용값은 board와 members 둘뿐이다', () => {
  assert.deepEqual([...DOCUMENT_VISIBILITY], ['board', 'members'])
})

test('허용값이 아니면 거른다', () => {
  assert.equal(isDocumentVisibility('board'), true)
  assert.equal(isDocumentVisibility('members'), true)
  assert.equal(isDocumentVisibility('public'), false)
  assert.equal(isDocumentVisibility(''), false)
  assert.equal(isDocumentVisibility(null), false)
  assert.equal(isDocumentVisibility(undefined), false)
})

process.env.TURSO_DATABASE_URL = 'file:local.db'

const { listDocuments, createDocument, getDocumentDetail, getDocumentForDownload, deleteDocument } =
  await import('../../src/db/queries/board.ts')

async function seedDoc({ title, visibility, body }) {
  const { id } = await createDocument({
    title,
    category: '총회',
    filePath: `mailbox/test/${Math.random().toString(36).slice(2)}.pdf`,
    fileName: 'x.pdf',
    fileSize: 10,
    mimeType: 'application/pdf',
    uploadedBy: null,
    visibility,
    bodyMarkdown: body ?? null,
  })
  return id
}

test('조합원 범위로 조회하면 board 자료가 섞이지 않는다', async () => {
  const openId = await seedDoc({
    title: `열림-${Date.now()}`,
    visibility: 'members',
    body: '# 본문',
  })
  const shutId = await seedDoc({ title: `닫힘-${Date.now()}`, visibility: 'board' })
  try {
    const rows = await listDocuments({ category: '총회', visibility: ['members'] })
    const ids = rows.map(r => r.id)
    assert.ok(ids.includes(openId), 'members 자료는 나와야 한다')
    assert.ok(!ids.includes(shutId), 'board 자료는 나오면 안 된다')
  } finally {
    await deleteDocument(openId)
    await deleteDocument(shutId)
  }
})

test('본문이 있으면 has_body가 참이고 본문 자체는 목록에 실리지 않는다', async () => {
  const id = await seedDoc({ title: `본문-${Date.now()}`, visibility: 'members', body: '# 본문' })
  try {
    const [row] = (await listDocuments({ category: '총회', visibility: ['members'] })).filter(
      r => r.id === id
    )
    assert.equal(row.has_body, true)
    assert.equal(row.body_markdown, undefined, '목록에 본문을 실으면 응답이 무거워진다')
    const detail = await getDocumentDetail(id)
    assert.equal(detail.body_markdown, '# 본문')
    assert.equal(detail.visibility, 'members')
  } finally {
    await deleteDocument(id)
  }
})

// `boardRoomAuth.ts`는 `next/server`(exports 필드 없는 서브패스)와 `@/*`
// 별칭을 임포트한다 — 플레인 `node --test`의 기본 ESM 리졸버가 풀지 못해
// `scripts/testing/authzTursoConversion.test.mjs`가 쓰는 리졸브 훅을 그대로
// 재사용한다.
const { register } = await import('node:module')
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

const { visibilityScopeFor } = await import('../../src/lib/server/boardRoomAuth.ts')

test('조합원 범위에는 board가 없다 (상세가 404를 주는 근거)', () => {
  const memberScope = visibilityScopeFor(false)
  assert.deepEqual([...memberScope], ['members'])
  assert.equal(memberScope.includes('board'), false)
})

test('이사 범위는 조합원 범위를 포함한다', () => {
  const boardScope = visibilityScopeFor(true)
  assert.equal(boardScope.includes('members'), true)
  assert.equal(boardScope.includes('board'), true)
})

// 다운로드 라우트(`/api/board-room/documents/[id]/download`)가 실제로 쓰는
// 값 — `getDocumentForDownload`가 돌려주는 `visibility` — 로 재판정을
// 단언한다. `visibilityScopeFor` 자체는 위에서 이미 시험했으니, 여기서는
// 다운로드 경로의 조회 결과와 재판정이 정확히 맞물리는지만 본다(수정
// 1회차 Important 1 — 게이트만 넓히고 재판정을 빠뜨리면 조합원이
// visibility='board' 재무 원자료까지 내려받는다).
test('다운로드 조회가 돌려주는 board 자료는 조합원 범위 밖이고 이사 범위 안이다', async () => {
  const id = await seedDoc({ title: `다운로드-${Date.now()}`, visibility: 'board' })
  try {
    const doc = await getDocumentForDownload(id)
    assert.equal(doc.visibility, 'board')
    assert.equal(
      visibilityScopeFor(false).includes(doc.visibility),
      false,
      '조합원은 이 자료를 내려받을 수 없어야 한다(라우트는 여기서 404를 준다)'
    )
    assert.equal(
      visibilityScopeFor(true).includes(doc.visibility),
      true,
      '이사·감사·관리자는 여전히 내려받을 수 있어야 한다'
    )
  } finally {
    await deleteDocument(id)
  }
})
