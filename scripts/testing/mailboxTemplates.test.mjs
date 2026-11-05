import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import {
  appendTemplate,
  normalizeTemplateBody,
  normalizeTemplateName,
  TEMPLATE_BODY_MAX,
} from '../../src/lib/mail/replyTemplates.ts'

const DB_PATH = 'scripts/testing/.mailbox-templates-test.db'
let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
const templates = await import('../../src/db/queries/mailboxTemplates.ts')

async function admin() {
  const id = crypto.randomUUID()
  await setupClient.execute({
    sql: `insert into member_profiles (id, display_name, email) values (?, '템플릿관리자', ?)`,
    args: [id, `${id}@templates.example`],
  })
  return id
}

test('덧붙이기는 쓰던 글을 지우지 않고 빈 줄 하나를 사이에 둔다', () => {
  assert.equal(appendTemplate('', '안내문'), '안내문')
  assert.equal(appendTemplate('   \n', '안내문'), '안내문')
  assert.equal(appendTemplate('안녕하세요.\n\n\n', '안내문'), '안녕하세요.\n\n안내문')
})

test('본문은 줄바꿈을 지키고 CRLF를 LF로, 앞뒤 빈 줄만 턴다 — 비었거나 길면 null', () => {
  assert.equal(normalizeTemplateBody('\r\n\n안녕하세요\r\n두 번째\n\n'), '안녕하세요\n두 번째')
  assert.equal(normalizeTemplateBody('  들여쓴 줄\n끝'), '  들여쓴 줄\n끝')
  assert.equal(normalizeTemplateBody(' \n \n'), null)
  assert.equal(normalizeTemplateBody('x'.repeat(TEMPLATE_BODY_MAX + 1)), null)
  assert.equal(normalizeTemplateName('  대관   안내 '), '대관 안내')
  assert.equal(normalizeTemplateName('x'.repeat(41)), null)
})

test('만들기·고치기는 이름을 대소문자 무시로 겹치지 못하게 하고, 목록은 이름순이다', async () => {
  const by = await admin()
  const tag = Math.random().toString(36).slice(2, 7)
  const a = await templates.createTemplate({ name: `Zeta-${tag}`, body: '제타', created_by: by })
  const b = await templates.createTemplate({ name: `alpha-${tag}`, body: '알파', created_by: by })
  assert.equal(
    await templates.createTemplate({ name: `ZETA-${tag}`, body: 'x', created_by: by }),
    'duplicate'
  )
  assert.equal(await templates.updateTemplate({ id: b.id, name: `zeta-${tag}` }), 'duplicate')
  assert.equal(await templates.updateTemplate({ id: b.id, body: '바뀐 알파' }), 'updated')
  assert.equal(await templates.updateTemplate({ id: crypto.randomUUID(), body: 'x' }), 'missing')

  const mine = (await templates.listTemplates()).filter(t => t.name.endsWith(tag))
  assert.deepEqual(
    mine.map(t => [t.name, t.body]),
    [
      [`alpha-${tag}`, '바뀐 알파'],
      [`Zeta-${tag}`, '제타'],
    ]
  )
  assert.equal(await templates.deleteTemplate(a.id), true)
  assert.equal(await templates.deleteTemplate(a.id), false)
})
