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
  const openId = await seedDoc({ title: `열림-${Date.now()}`, visibility: 'members', body: '# 본문' })
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
