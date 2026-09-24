import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { register } from 'node:module'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * 캠페인 표지 업로드 라우트(`POST /api/mypage/funding/campaigns/[id]/cover`)를
 * **실제로 호출해서** 확인한다. 소스에 어떤 문자열이 있는지 세지 않는다 —
 * 알고 싶은 것은 "요청을 보내면 무슨 답이 오는가"다.
 *
 * 진짜로 도는 것: 기능 스위치 판정(파일 DB), 캠페인 조회, 소유 판정
 * (`canManageCampaign`), 편집 범위(`editScope`), 타입·크기 검증, 매직 바이트
 * 대조, 저장 경로 생성, sharp 변형 생성.
 *
 * 바꿔 끼운 것 둘뿐이다: 세션(쿠키를 보낼 브라우저가 없다)과 Blob 저장소
 * (네트워크를 타지 않는다). 둘 다 `fixtures/coverRoute/`에 있다.
 */

const DB_PATH = 'scripts/testing/.funding-cover-test.db'
const BLOB_BASE = 'https://test-store.public.blob.vercel-storage.com'

process.env.SETTINGS_CACHE_TTL_MS = '0'
process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`
process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL = BLOB_BASE

// `@/*` 별칭·확장자 생략을 풀고, 세션과 Blob 두 모듈만 대역으로 바꿔 끼우는
// 로더. 라우트는 `enum`·파라미터 프로퍼티를 쓰는 파일을 거치므로 타입만 지우는
// 방식으로는 불러올 수 없다 — 이 파일만 진짜 컴파일러를 쓴다(로더 설명 참고).
// `node --test`는 파일마다 별도 프로세스라 다른 테스트에 영향을 주지 않는다.
const projectRootUrl = new URL('../../', import.meta.url).href
register(new URL('fixtures/coverRoute/tsLoader.mjs', import.meta.url).href, import.meta.url, {
  data: {
    root: projectRootUrl,
    stubs: {
      [new URL('src/lib/server/memberAuth.ts', projectRootUrl).href]: new URL(
        'fixtures/coverRoute/memberAuth.mjs',
        import.meta.url
      ).href,
      [new URL('src/lib/storage/blob.ts', projectRootUrl).href]: new URL(
        'fixtures/coverRoute/blob.mjs',
        import.meta.url
      ).href,
    },
  },
})

const sharp = (await import('sharp')).default
const { POST } = await import('../../src/app/api/mypage/funding/campaigns/[id]/cover/route.ts')
const { isBlobPublicUrl } = await import('../../src/lib/storage/paths.ts')
const { parseCampaignPatch } = await import('../../src/lib/funding/campaignInput.ts')
const funding = await import('../../src/db/queries/funding.ts')

const OWNER = { id: 'owner-1', profile: { registration_status: 'approved', is_active: true } }
const OTHER = { id: 'other-1', profile: { registration_status: 'approved', is_active: true } }

let client
let pngBytes

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  client = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(client)
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active) VALUES ('owner-1','개설자','owner@x.kr','approved',1)"
  )
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active) VALUES ('other-1','남','other@x.kr','approved',1)"
  )
  await client.execute(
    "INSERT INTO member_profiles (id, display_name, email, registration_status, is_active, is_admin) VALUES ('admin-1','사무국','admin@x.kr','approved',1,1)"
  )
  pngBytes = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer()
})

after(() => {
  client?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

beforeEach(async () => {
  await client.execute(`DELETE FROM system_settings WHERE category = 'features'`)
  globalThis.__coverTestSession = OWNER
  globalThis.__coverTestBlobConfigured = true
})

let rowSeq = 0
async function putFeature(settingKey, settingValue) {
  await client.execute({
    sql: `INSERT INTO system_settings (id, category, setting_key, setting_value, is_sensitive, created_at, updated_at)
          VALUES (?, 'features', ?, ?, 0, ?, ?)`,
    args: [
      `cover-test-${++rowSeq}`,
      settingKey,
      JSON.stringify(settingValue),
      Date.now(),
      Date.now(),
    ],
  })
}

const enableFunding = () => putFeature('funding_features', { enabled: true })

async function makeCampaign() {
  return funding.createCampaign({
    owner_user_id: 'owner-1',
    title: '표지 시험',
    summary: '요약',
    goal_amount: 100_000,
  })
}

/** 파일 하나를 담은 POST 요청을 만들어 라우트를 직접 부른다. */
async function postCover(campaignId, { bytes, name, type }) {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  const request = new Request(`http://localhost/api/mypage/funding/campaigns/${campaignId}/cover`, {
    method: 'POST',
    body: form,
    headers: { 'x-forwarded-for': `10.0.0.${++rowSeq % 250}` },
  })
  const response = await POST(request, { params: Promise.resolve({ id: campaignId }) })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

const validPng = () => ({ bytes: pngBytes, name: 'cover.png', type: 'image/png' })

// ------------------------------------------------------------ 되는 경우

test('개설자가 올린 이미지는 저장되고, 돌려준 주소는 캠페인 저장이 받아들인다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()

  const { status, body } = await postCover(campaign.id, validPng())
  assert.equal(status, 201)

  const url = body.data.public_url
  assert.equal(typeof url, 'string')
  // 저장 경로에 임자가 보인다 — 캠페인 밑이다.
  assert.ok(
    body.data.path.startsWith(`funding/${campaign.id}/`),
    `경로가 캠페인 밑이 아니다: ${body.data.path}`
  )
  // PATCH가 오리진으로 대조한다. 여기서 막히면 올려 놓고 저장이 안 된다.
  assert.equal(isBlobPublicUrl(url), true)
  const parsed = parseCampaignPatch({ cover_image: url }, 'contentOnly')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.patch.cover_image, url)

  // 업로드 원장에 남는다 — 남지 않으면 저장하지 않고 떠난 이미지를 정리할
  // 수단이 없다.
  const ledger = await client.execute({
    sql: 'SELECT user_id, bucket, path FROM media_uploads WHERE url = ?',
    args: [url],
  })
  assert.equal(ledger.rows.length, 1)
  assert.equal(ledger.rows[0].user_id, 'owner-1')
  assert.equal(ledger.rows[0].bucket, 'attachments')
})

test('사무국(관리자)도 남의 캠페인 표지를 바꿀 수 있다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()
  globalThis.__coverTestSession = {
    id: 'admin-1',
    profile: { registration_status: 'approved', is_active: true, is_admin: true },
  }

  const { status } = await postCover(campaign.id, validPng())
  assert.equal(status, 201)
})

// ------------------------------------------------------------ 임자가 아니면

test('남의 캠페인에는 올릴 수 없다 — 없는 캠페인과 같은 답(404)을 준다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()
  globalThis.__coverTestSession = OTHER

  const mine = await postCover(campaign.id, validPng())
  assert.equal(mine.status, 404)

  // 있지도 않은 id도 같은 답이어야 한다. 답이 갈리면 id를 훑어 존재를 알아낸다.
  const nowhere = await postCover('00000000-0000-0000-0000-000000000000', validPng())
  assert.equal(nowhere.status, 404)
  assert.equal(mine.body.error, nowhere.body.error)
})

test('로그인하지 않았으면 401이다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()
  globalThis.__coverTestSession = null

  const { status } = await postCover(campaign.id, validPng())
  assert.equal(status, 401)
})

// ------------------------------------------------------------ 스위치 둘

test('펀딩 스위치가 꺼져 있으면 표지도 올라가지 않는다', async () => {
  await putFeature('funding_features', { enabled: false })
  const campaign = await makeCampaign()

  const { status, body } = await postCover(campaign.id, validPng())
  assert.equal(status, 503)
  assert.match(body.error, /펀딩을 준비 중/)
})

test('펀딩 설정 행이 아예 없어도 꺼짐이다 — 펀딩만 fail-closed', async () => {
  const campaign = await makeCampaign()
  const { status } = await postCover(campaign.id, validPng())
  assert.equal(status, 503)
})

test('파일 업로드 스위치를 꺼도 표지는 그대로 올라간다 — 이 라우트는 그 스위치와 무관하다', async () => {
  await enableFunding()
  await putFeature('file_upload', { enabled: false })
  const campaign = await makeCampaign()

  const { status, body } = await postCover(campaign.id, validPng())
  assert.equal(status, 201)
  assert.equal(isBlobPublicUrl(body.data.public_url), true)
})

// ------------------------------------------------------------ 이미지가 아니면

test('이미지가 아닌 파일은 타입 목록에서 걸린다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()

  const { status, body } = await postCover(campaign.id, {
    bytes: Buffer.from('%PDF-1.4 표지인 척'),
    name: 'cover.pdf',
    type: 'application/pdf',
  })
  assert.equal(status, 400)
  assert.match(body.error, /지원하지 않는 파일 형식/)
})

test('확장자와 헤더만 이미지인 파일은 내용 대조에서 걸린다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()

  const { status, body } = await postCover(campaign.id, {
    bytes: Buffer.from('<?php echo 1; ?>'),
    name: 'cover.png',
    type: 'image/png',
  })
  assert.equal(status, 400)
  assert.match(body.error, /이미지가 아닙니다/)
})

test('상한(5MB)을 넘는 이미지는 거절한다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()

  const { status, body } = await postCover(campaign.id, {
    bytes: Buffer.concat([pngBytes, Buffer.alloc(5 * 1024 * 1024)]),
    name: 'cover.png',
    type: 'image/png',
  })
  assert.equal(status, 400)
  assert.match(body.error, /파일 크기가 너무 큽니다/)
})

test('파일을 안 보내면 무엇을 해야 하는지 말한다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()

  const request = new Request(
    `http://localhost/api/mypage/funding/campaigns/${campaign.id}/cover`,
    { method: 'POST', body: new FormData() }
  )
  const response = await POST(request, { params: Promise.resolve({ id: campaign.id }) })
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /표지 이미지를 선택해 주세요/)
})

// ------------------------------------------------------------ 상태

test('공개된 캠페인의 표지는 계속 바꿀 수 있다 — 표지는 내용 필드다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()
  await funding.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  await funding.transitionCampaign({
    id: campaign.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: `cover-live-${Date.now()}`,
    platformFeeRate: 0,
  })

  const { status } = await postCover(campaign.id, validPng())
  assert.equal(status, 201)
})

test('마감된 캠페인의 표지는 잠긴다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()
  await funding.transitionCampaign({ id: campaign.id, action: 'submit', expectedFrom: 'draft' })
  await funding.transitionCampaign({
    id: campaign.id,
    action: 'approve',
    expectedFrom: 'submitted',
    slug: `cover-closed-${Date.now()}`,
    platformFeeRate: 0,
  })
  await funding.transitionCampaign({ id: campaign.id, action: 'close', expectedFrom: 'active' })

  const { status, body } = await postCover(campaign.id, validPng())
  assert.equal(status, 400)
  assert.match(body.error, /바꿀 수 없습니다/)
})

// ------------------------------------------------------------ 저장소가 없으면

test('저장소 자격 증명이 없으면 사무국에 물으라고 말한다', async () => {
  await enableFunding()
  const campaign = await makeCampaign()
  globalThis.__coverTestBlobConfigured = false

  const { status, body } = await postCover(campaign.id, validPng())
  assert.equal(status, 503)
  assert.match(body.error, /contact@ggac\.kr/)
})
