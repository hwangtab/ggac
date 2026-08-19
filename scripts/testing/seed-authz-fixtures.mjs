/**
 * 권한 경계 E2E용 픽스처를 로컬 Supabase 스택에 심는다.
 *
 *   E2E_SUPABASE_URL=http://127.0.0.1:54321 \
 *   E2E_SUPABASE_SERVICE_ROLE_KEY=<로컬 service_role> \
 *   node scripts/testing/seed-authz-fixtures.mjs
 *
 * 멱등이다 — 다시 실행해도 계정과 데이터가 늘지 않는다. 실패한 실행을
 * 그대로 다시 돌려 복구할 수 있어야 하기 때문이다.
 *
 * 안전장치: 비로컬 호스트면 거부한다. 이 스크립트는 계정을 만들고 글을
 * 쓰므로 운영에 실행되면 실제 데이터가 오염된다.
 *
 * 스키마 편차 (운영 덤프 실물과 대조해 확인함):
 *   - notifications.type은 notification_type enum이고 'comment'는 그 안에
 *     없다(post_new/post_reply/post_mention/member_approved/...). 댓글
 *     알림에 가장 가까운 값은 'post_reply'라 그것을 쓴다.
 *   - notifications에는 is_read 컬럼이 없고 read_at(timestamptz, null 허용)
 *     이 있다. 미읽음 상태는 값을 아예 안 넣는 것(NULL)으로 표현한다.
 *   - posts.category는 CHECK (category IN ('공지','잡담','홍보','건의'))이고
 *     '자유'는 그 안에 없다. 자유게시판에 가장 가까운 값인 '잡담'을 쓴다.
 */

import { writeFileSync } from 'node:fs'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const OUT_FILE = 'e2e/.authz-fixtures.json'

export const ACCOUNTS = [
  {
    key: 'admin',
    email: 'authz-admin@test.local',
    password: 'Authz!Admin2026',
    profile: { is_admin: true, registration_status: 'approved', is_active: true },
  },
  {
    key: 'owner',
    email: 'authz-owner@test.local',
    password: 'Authz!Owner2026',
    profile: { is_admin: false, registration_status: 'approved', is_active: true },
  },
  {
    key: 'other',
    email: 'authz-other@test.local',
    password: 'Authz!Other2026',
    profile: { is_admin: false, registration_status: 'approved', is_active: true },
  },
  {
    key: 'pending',
    email: 'authz-pending@test.local',
    password: 'Authz!Pend2026',
    profile: { is_admin: false, registration_status: 'pending', is_active: false },
  },
]

function requireLocalEnv() {
  const url = process.env.E2E_SUPABASE_URL
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('E2E_SUPABASE_URL과 E2E_SUPABASE_SERVICE_ROLE_KEY가 필요하다')
  }
  const { hostname } = new URL(url)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`로컬이 아닌 호스트에는 시드하지 않는다: ${hostname}`)
  }
  return { url, key }
}

function headers(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

/** 이메일로 기존 계정을 찾는다. 없으면 null. */
async function findUser(url, key, email) {
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: headers(key),
  })
  if (!res.ok) throw new Error(`사용자 목록 조회 실패: ${res.status}`)
  const body = await res.json()
  return (body.users ?? []).find(u => u.email === email) ?? null
}

/** 계정을 만들거나 이미 있으면 그대로 쓴다. 비밀번호는 매번 재설정해 시드가 자기완결이 되게 한다. */
async function upsertUser(url, key, account) {
  const existing = await findUser(url, key, account.email)
  if (existing) {
    const res = await fetch(`${url}/auth/v1/admin/users/${existing.id}`, {
      method: 'PUT',
      headers: headers(key),
      body: JSON.stringify({ password: account.password, email_confirm: true }),
    })
    if (!res.ok) throw new Error(`${account.email} 갱신 실패: ${res.status}`)
    return existing.id
  }
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify({ email: account.email, password: account.password, email_confirm: true }),
  })
  if (!res.ok) throw new Error(`${account.email} 생성 실패: ${res.status} ${await res.text()}`)
  return (await res.json()).id
}

/** PostgREST 업서트. service_role이라 RLS를 우회한다. */
async function upsert(url, key, table, rows, onConflict) {
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...headers(key), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`${table} 업서트 실패: ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const { url, key } = requireLocalEnv()

  const ids = {}
  for (const account of ACCOUNTS) {
    ids[account.key] = await upsertUser(url, key, account)
  }

  await upsert(
    url,
    key,
    'member_profiles',
    ACCOUNTS.map(a => ({
      id: ids[a.key],
      email: a.email,
      display_name: `authz-${a.key}`,
      ...a.profile,
    })),
    'id'
  )

  // 고정 UUID를 쓴다 — 매번 새로 만들면 멱등이 깨지고, 실패한 실행이 쓰레기를 남긴다.
  const POST_ID = '00000000-0000-4000-8000-00000000a001'
  const COMMENT_ID = '00000000-0000-4000-8000-00000000a002'
  const NOTIFICATION_ID = '00000000-0000-4000-8000-00000000a003'

  await upsert(
    url,
    key,
    'posts',
    [
      {
        id: POST_ID,
        title: 'authz 픽스처 글',
        content: '<p>소유권 경계 테스트용</p>',
        content_format: 'html',
        category: '잡담',
        author_id: ids.owner,
        is_pinned: false,
      },
    ],
    'id'
  )

  await upsert(
    url,
    key,
    'comments',
    [
      {
        id: COMMENT_ID,
        post_id: POST_ID,
        author_id: ids.owner,
        content: 'authz 픽스처 댓글',
      },
    ],
    'id'
  )

  await upsert(
    url,
    key,
    'notifications',
    [
      {
        id: NOTIFICATION_ID,
        user_id: ids.owner,
        type: 'post_reply',
        title: 'authz 픽스처 알림',
        message: '소유권 경계 테스트용',
      },
    ],
    'id'
  )

  await upsert(
    url,
    key,
    'post_likes',
    [{ post_id: POST_ID, user_id: ids.owner }],
    'post_id,user_id'
  )

  const fixtures = {
    users: ids,
    postId: POST_ID,
    commentId: COMMENT_ID,
    notificationId: NOTIFICATION_ID,
  }
  writeFileSync(OUT_FILE, JSON.stringify(fixtures, null, 2) + '\n')
  console.log(`픽스처 시드 완료 → ${OUT_FILE}`)
  console.log(`  계정 ${Object.keys(ids).length}개, 글 1, 댓글 1, 알림 1, 좋아요 1`)
}

await main()
