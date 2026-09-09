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

const { listDocuments, createDocument, getDocumentDetail, deleteDocument } = await import(
  '../../src/db/queries/board.ts'
)

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
