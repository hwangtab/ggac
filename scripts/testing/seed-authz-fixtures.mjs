/**
 * 권한 경계 E2E용 픽스처를 로컬 스택에 심는다.
 *
 *   E2E_SUPABASE_URL=http://127.0.0.1:54321 \
 *   E2E_SUPABASE_SERVICE_ROLE_KEY=<로컬 service_role> \
 *   TURSO_DATABASE_URL=<로컬 파일 DB, 예: file:/tmp/ggac-2b6-local.db> \
 *   node --experimental-strip-types scripts/testing/seed-authz-fixtures.mjs
 *
 * **단계 2c(Task 3~7)에서 member_profiles·posts·comments·notifications·
 * post_likes가 전부 Turso 권위로 넘어갔다.** 이 스크립트는 원래 이
 * 다섯 테이블을 전부 Supabase에만 심었다 — API가 Turso를 읽도록
 * 바뀐 뒤에도 이 스크립트는 고쳐지지 않아, 앱이 실제로 보는 데이터와
 * 픽스처가 심는 데이터가 서로 다른 저장소에 있는 상태가 됐다(권한
 * 경계 e2e 30건 중 다수가 이 어긋남으로 깨지거나 거짓 통과했다 —
 * `authz-remaining.spec.ts`의 "남의 알림 PATCH → 404" 단정이 실제로는
 * "행 자체가 존재하지 않아서" 404가 나는 거짓 양성이 된 것이 대표
 * 사례다). 지금은 다음처럼 나뉜다:
 *
 *   - **Turso 전용**: comments·notifications·post_likes — API가 Turso만
 *     읽고, 이 테이블들을 참조하는 다른 Supabase 권위 테이블도 없다(FK
 *     로 걸린 게 comment_likes/post_attachments의 부모 방향뿐인데, 그
 *     둘 다 Task 6에서 이미 Turso로 전환됐거나 아예 이 스펙이 안 건드린다
 *     — `grep -rln "REFERENCES.*comments(id)\|REFERENCES.*notifications(id)\|
 *     REFERENCES.*post_likes(id)" supabase/migrations/*.sql`로 확인, 부모
 *     방향 FK만 있고 외부 참조 없음).
 *   - **양쪽 다**: member_profiles·posts — Turso가 권위(API가 여기를
 *     읽는다)지만, **Supabase에도 그대로 남겨야 한다.** 이유:
 *     `post_attachments`(Task 8 대상, 아직 Supabase 권위)가
 *     `posts(id)`를 FK로 참조하고, `posts.author_id`는 다시
 *     `member_profiles(id)`를 FK로 참조한다(둘 다
 *     `supabase/migrations/20250106090010_init_member_profiles.sql` 확인).
 *     `authz-remaining.spec.ts`가 실제로 픽스처 글에 첨부파일을 업로드하는
 *     테스트를 갖고 있어(정책 36), 이 FK 사슬이 살아있는 한 Supabase 쪽
 *     posts/member_profiles를 지우면 그 테스트가 FK 위반으로 깨진다.
 *     Task 8이 post_attachments를 Turso로 옮기면 이 이중 시딩도 함께
 *     걷어내야 한다.
 *
 * `--experimental-strip-types`가 필요하다 — 이 스크립트가 `@/db/client`·
 * `@/db/schema/auth`·`@/db/schema/content`·`@/db/queries/profiles`·
 * `@/lib/auth/password`(전부 `.ts`)를 동적 import한다.
 *
 * 단계 2b-6(Task 4) 수정 라운드 1: 로그인이 Supabase Auth에서 Better
 * Auth(Turso)로 넘어간 뒤 이 스크립트가 만든 계정이 로그인에 쓸 수 없게
 * 됐다(Supabase Auth Admin API만 썼기 때문 — Better Auth는 그 계정을
 * 전혀 모른다). 그래서 Turso `user`/`account` 시드를 추가했다. id는
 * Supabase 쪽에서 만든 값을 그대로 재사용한다 — `member_profiles.id`와
 * Turso `user.id`가 어긋나면 로그인 후 `getSessionContext()`가 엉뚱한(또는
 * 존재하지 않는) 프로필을 찾는다.
 *
 * 멱등이다 — 다시 실행해도 계정과 데이터가 늘지 않는다. 실패한 실행을
 * 그대로 다시 돌려 복구할 수 있어야 하기 때문이다. Turso 쪽도
 * `onConflictDoUpdate`/`onConflictDoNothing`으로 같은 성질을 유지한다.
 *
 * 안전장치: 비로컬 호스트/DB면 거부한다. 이 스크립트는 계정을 만들고
 * 글을 쓰므로 운영에 실행되면 실제 데이터가 오염된다. Supabase는 호스트가
 * 로컬(127.0.0.1/localhost/::1)이어야 하고, Turso는 `TURSO_DATABASE_URL`이
 * `libsql://`로 시작하면(=운영) 즉시 거부한다 — 운영 확인용 스크립트가
 * "운영이 아니면 거부"하는 것과 반대 방향의 같은 원칙이다.
 *
 * 스키마 편차 (운영 덤프 실물과 대조해 확인함, Supabase 쪽에 그대로
 * 적용됨 — posts는 여전히 양쪽에 쓰므로 유효):
 *   - posts.category는 CHECK (category IN ('공지','잡담','홍보','건의'))이고
 *     '자유'는 그 안에 없다. 자유게시판에 가장 가까운 값인 '잡담'을 쓴다.
 *   - (참고, 더는 Supabase에 쓰지 않지만 기록으로 남긴다) notifications.type은
 *     notification_type enum이고 'comment'는 그 안에 없었다 — 댓글 알림에
 *     가장 가까운 값 'post_reply'를 썼다. Turso 쪽도 같은 이유로 'post_reply'를
 *     그대로 쓴다(스키마 enum 자체가 이 값들을 그대로 승계했다).
 */

import { writeFileSync } from 'node:fs'
import { register } from 'node:module'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const OUT_FILE = 'e2e/.authz-fixtures.json'

// memberAuth.test.mjs(Task 1)와 동일한 리졸브 훅 — 확장자 없는 상대 경로
// import(`./schema` → `./schema/index.ts`)를 Node 네이티브 ESM 리졸버가
// 못 푸는 문제를 우회한다. `@/*` tsconfig 별칭도 여기서 직접 해석한다.
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

const { hashPassword } = await import('@/lib/auth/password')
const { db } = await import('@/db/client')
const { user: tursoUser, account: tursoAccount } = await import('@/db/schema/auth')
const {
  posts: tursoPosts,
  comments: tursoComments,
  notifications: tursoNotifications,
  postLikes: tursoPostLikes,
} = await import('@/db/schema/content')
const { upsertProfile } = await import('@/db/queries/profiles')

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

  const tursoUrl = process.env.TURSO_DATABASE_URL
  if (!tursoUrl) {
    throw new Error('TURSO_DATABASE_URL이 필요하다 (로컬 파일 DB를 가리켜야 한다)')
  }
  if (tursoUrl.startsWith('libsql://')) {
    throw new Error(`운영으로 보이는 TURSO_DATABASE_URL에는 시드하지 않는다: ${tursoUrl}`)
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

/**
 * Better Auth(Turso)의 user/account 행을 같은 id로 만들거나 갱신한다.
 * Supabase 쪽 id를 그대로 받아 쓴다 — 두 스토어의 id가 어긋나면 로그인
 * 후 프로필 조회가 깨진다(파일 상단 주석 참고).
 */
async function upsertTursoAuth(id, account) {
  const hashed = await hashPassword(account.password)
  await db
    .insert(tursoUser)
    .values({
      id,
      name: `authz-${account.key}`,
      email: account.email,
      emailVerified: true,
    })
    .onConflictDoUpdate({
      target: tursoUser.id,
      set: { name: `authz-${account.key}`, email: account.email, emailVerified: true },
    })

  await db
    .insert(tursoAccount)
    .values({
      id: `${id}-cred`,
      accountId: id,
      providerId: 'credential',
      userId: id,
      password: hashed,
    })
    .onConflictDoUpdate({ target: tursoAccount.id, set: { password: hashed } })
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
    await upsertTursoAuth(ids[account.key], account)
  }

  // member_profiles: Turso가 권위지만, posts를 통해 걸리는 Supabase FK
  // 사슬(post_attachments → posts → member_profiles, 파일 상단 주석 참고)
  // 때문에 Supabase에도 그대로 남긴다.
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
  for (const account of ACCOUNTS) {
    await upsertProfile({
      id: ids[account.key],
      email: account.email,
      display_name: `authz-${account.key}`,
      ...account.profile,
    })
  }

  // 고정 UUID를 쓴다 — 매번 새로 만들면 멱등이 깨지고, 실패한 실행이 쓰레기를 남긴다.
  const POST_ID = '00000000-0000-4000-8000-00000000a001'
  const COMMENT_ID = '00000000-0000-4000-8000-00000000a002'
  const NOTIFICATION_ID = '00000000-0000-4000-8000-00000000a003'

  // posts: Turso가 권위지만, post_attachments(Task 8 대상, 아직 Supabase
  // 권위)의 FK 앵커로 Supabase에도 그대로 남긴다(파일 상단 주석 참고).
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
  const postValues = {
    id: POST_ID,
    title: 'authz 픽스처 글',
    content: '<p>소유권 경계 테스트용</p>',
    contentFormat: 'html',
    category: '잡담',
    authorId: ids.owner,
    isPinned: false,
  }
  await db
    .insert(tursoPosts)
    .values(postValues)
    .onConflictDoUpdate({ target: tursoPosts.id, set: postValues })

  // comments: Turso 전용(Task 6부터 권위) — Supabase에는 더 이상 쓰지
  // 않는다(파일 상단 주석 참고, 외부 FK 의존 없음을 확인함).
  const commentValues = {
    id: COMMENT_ID,
    postId: POST_ID,
    authorId: ids.owner,
    content: 'authz 픽스처 댓글',
  }
  await db
    .insert(tursoComments)
    .values(commentValues)
    .onConflictDoUpdate({ target: tursoComments.id, set: commentValues })

  // notifications: Turso 전용(Task 7부터 권위) — Supabase에는 더 이상
  // 쓰지 않는다. readAt을 매 시드마다 null로 되돌린다 — e2e 스펙 안의
  // resetNotificationUnread()가 테스트 사이 상태를 되돌리는 것과 별개로,
  // 시드 자체도 항상 "안 읽음"에서 시작해야 최초 실행이 결정적이다.
  const notificationValues = {
    id: NOTIFICATION_ID,
    userId: ids.owner,
    type: 'post_reply',
    title: 'authz 픽스처 알림',
    message: '소유권 경계 테스트용',
    readAt: null,
  }
  await db
    .insert(tursoNotifications)
    .values(notificationValues)
    .onConflictDoUpdate({ target: tursoNotifications.id, set: notificationValues })

  // post_likes: Turso 전용(Task 6부터 권위) — Supabase에는 더 이상 쓰지
  // 않는다. id가 아니라 (postId, userId) 복합 유니크가 충돌 대상이라
  // onConflictDoNothing만으로 충분하다(갱신할 다른 컬럼이 없다).
  await db
    .insert(tursoPostLikes)
    .values({ postId: POST_ID, userId: ids.owner })
    .onConflictDoNothing({ target: [tursoPostLikes.postId, tursoPostLikes.userId] })

  const fixtures = {
    users: ids,
    postId: POST_ID,
    commentId: COMMENT_ID,
    notificationId: NOTIFICATION_ID,
  }
  writeFileSync(OUT_FILE, JSON.stringify(fixtures, null, 2) + '\n')
  console.log(`픽스처 시드 완료 → ${OUT_FILE}`)
  console.log(
    `  계정 ${Object.keys(ids).length}개(Supabase+Turso), 글 1(양쪽), 댓글 1(Turso), 알림 1(Turso), 좋아요 1(Turso)`
  )
}

await main()
