import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'
import { registerAliasResolveHook } from './aliasResolveHook.mjs'
import {
  campaignSlugCandidates,
  suggestCampaignSlug,
  slugWords,
} from '../../src/lib/funding/campaignSlug.ts'

registerAliasResolveHook(import.meta.url)
const { isValidSlug } = await import('../../src/lib/funding/campaignInput.ts')

const DB_PATH = 'scripts/testing/.funding-campaign-slug-test.db'
const ID = '208fa027-3834-4959-a19d-8cce1aba2a9e'

test('개설자 이름과 제목의 영문 낱말로 주소를 제안한다 — 숫자만 있는 낱말은 뺀다', () => {
  assert.equal(
    suggestCampaignSlug({
      ownerName: 'Sabbaha',
      title: '사바하 정규 2집 《SLUNG》 앨범 발매 프로젝트',
      id: ID,
    }),
    'sabbaha-slung'
  )
  assert.deepEqual(slugWords('Séance · 2CD Vol.2'), ['seance', '2cd', 'vol'])
})

test('겹치는 낱말은 한 번만 쓰고, 영문이 없으면 캠페인 번호로 떨어진다', () => {
  assert.equal(suggestCampaignSlug({ ownerName: 'Slung', title: 'SLUNG', id: ID }), 'slung')
  assert.equal(
    suggestCampaignSlug({ ownerName: '사바하', title: '정규 2집', id: ID }),
    'campaign-208fa027'
  )
  assert.equal(suggestCampaignSlug({ ownerName: null, title: 'ab', id: ID }), 'campaign-208fa027')
})

test('제안 주소와 후보는 언제나 승인 라우트가 받는 형식이다', () => {
  const long = 'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo'
  const base = suggestCampaignSlug({ ownerName: 'Band', title: long, id: ID })
  assert.ok(base.length <= 60)
  for (const slug of [base, ...campaignSlugCandidates(base, ID)]) {
    assert.equal(isValidSlug(slug), true, slug)
  }
  assert.deepEqual(campaignSlugCandidates('slung', ID), [
    'slung',
    'slung-2',
    'slung-3',
    'slung-4',
    'slung-5',
    'slung-208fa027',
  ])
})

let client, resolveApprovalSlug, fq
before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active) VALUES ('u1','Sabbaha','s@x.kr','approved',1)"
  )
  process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
  const t = Date.now()
  fq = await import(`../../src/db/queries/funding.ts?t=${t}`)
  ;({ resolveApprovalSlug } = await import(`../../src/lib/funding/approvalSlug.ts?t=${t}`))
})
after(() => {
  client?.close()
  for (const s of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${s}`, { force: true })
})

test('다른 캠페인이 쓰는 주소는 건너뛰고 다음 후보를 준다', async () => {
  const mine = await fq.createCampaign({
    owner_user_id: 'u1',
    title: '《SLUNG》',
    summary: 's',
    goal_amount: 1,
  })
  assert.equal(await resolveApprovalSlug(mine), 'sabbaha-slung')
  const other = await fq.createCampaign({
    owner_user_id: 'u1',
    title: 'SLUNG',
    summary: 's',
    goal_amount: 1,
  })
  await client.execute({
    sql: "UPDATE funding_campaigns SET slug = 'sabbaha-slung' WHERE id = ?",
    args: [other.id],
  })
  assert.equal(await resolveApprovalSlug(mine), 'sabbaha-slung-2')
})
