/**
 * 권한 경계 E2E용 픽스처를 로컬 Turso에 심는다.
 *
 *   TURSO_DATABASE_URL=http://127.0.0.1:8901 \
 *   node --experimental-strip-types scripts/testing/seed-authz-fixtures.mjs
 *
 * **단계 4 Task 5에서 앱 코드의 Supabase가 0개가 됐다.** 그 전까지 이
 * 스크립트는 계정을 GoTrue admin API로 만들고 member_profiles·posts를
 * PostgREST로도 한 벌 더 심었다. 두 갈래 모두 사라졌다:
 *
 *   - 계정: 로그인은 Better Auth(Turso `user`/`account`)가 판정한다.
 *     Supabase `auth.users` 행은 아무도 읽지 않는다.
 *   - 이중 시딩: 이유였던 FK 사슬(post_attachments → posts →
 *     member_profiles)의 `post_attachments`가 Turso로 넘어왔다
 *     (`src/db/schema/content.ts`). Supabase 쪽에 앵커를 남길 이유가 없다.
 *
 * 그래서 이 스크립트는 이제 Turso 한 곳만 쓴다. 로컬 Supabase 스택이
 * 없어도 권한 E2E를 전부 돌릴 수 있다.
 *
 * **`system_settings`를 함께 심는다.** `e2e/authz-maintenance.spec.ts`가
 * 유지보수 모드를 켜고 끄는 대상이 이 행이다. 미들웨어는 단계 4부터
 * Turso의 `system_settings`를 읽는데(`src/middleware/settings.ts`) 시드가
 * 그 행을 만들지 않아, 스펙의 UPDATE가 0행에 적용되고 유지보수 모드가
 * 아예 켜지지 않았다 — 그 상태로도 "503이 아니다" 계열 단정은 통과해서
 * 스펙이 조용히 아무것도 검사하지 않는 구간이 생겼다. 스펙 쪽은 UPDATE의
 * 영향 행 수를 확인해 이 시드 누락이 다시 조용히 넘어가지 않게 한다.
 *
 * `--experimental-strip-types`가 필요하다 — 이 스크립트가 `@/db/client`·
 * `@/db/schema/auth`·`@/db/schema/content`·`@/db/schema/ops`·
 * `@/db/queries/profiles`·`@/lib/auth/password`·
 * `e2e/helpers/authState.ts`(전부 `.ts`)를 동적 import한다.
 *
 * 멱등이다 — 다시 실행해도 계정과 데이터가 늘지 않는다. 실패한 실행을
 * 그대로 다시 돌려 복구할 수 있어야 하기 때문이다. 모든 insert가
 * `onConflictDoUpdate`/`onConflictDoNothing`이고 id는 전부 고정값이다.
 *
 * 안전장치: 대상이 로컬 Turso가 아니면 아무것도 쓰기 전에 거부한다.
 * 판정은 `e2e/helpers/authState.ts`의 `assertLocalTurso()`를 **그대로
 * 재사용한다** — 시드와 스펙이 서로 다른 판정을 갖게 되면 한쪽만 조이는
 * 순간 다른 쪽으로 운영에 쓰는 경로가 남는다.
 *
 * 스키마 편차(운영 덤프 실물과 대조해 확인함):
 *   - posts.category는 CHECK (category IN ('공지','잡담','홍보','건의'))이고
 *     '자유'는 그 안에 없다. 자유게시판에 가장 가까운 값인 '잡담'을 쓴다.
 *   - notifications.type은 notification_type enum이고 'comment'는 그 안에
 *     없었다 — 댓글 알림에 가장 가까운 값 'post_reply'를 쓴다(Turso 스키마도
 *     이 enum을 그대로 승계했다).
 */

import { writeFileSync } from 'node:fs'
import { register } from 'node:module'

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

// 대상 판정을 **DB 모듈을 로드하기 전에** 끝낸다. `@/db/client`는 import
// 시점에 커넥션을 만들지 않지만(lazy proxy), 순서를 지켜두면 "가드보다 먼저
// 뭔가가 연결됐다"는 회귀가 구조적으로 불가능해진다.
const { assertLocalTurso } = await import('../../e2e/helpers/authState.ts')
assertLocalTurso()

const { hashPassword } = await import('@/lib/auth/password')
const { db } = await import('@/db/client')
const { user: tursoUser, account: tursoAccount } = await import('@/db/schema/auth')
const {
  posts: tursoPosts,
  comments: tursoComments,
  notifications: tursoNotifications,
  postLikes: tursoPostLikes,
} = await import('@/db/schema/content')
const { systemSettings: tursoSystemSettings, defaultSettings: tursoDefaultSettings } = await import(
  '@/db/schema/ops'
)
const { upsertProfile } = await import('@/db/queries/profiles')

// id는 전부 고정값이다. 예전에는 Supabase가 만들어준 uuid를 그대로 받아
// 썼는데, 그쪽이 사라진 지금 매번 새로 뽑으면 재실행마다 계정이 늘고
// `e2e/.authz-fixtures.json`이 가리키는 이전 행이 고아가 된다.
// uuid 형식을 유지하는 이유는 이관된 기존 회원 23명의 id가 전부 uuid라
// 로컬 픽스처만 형식이 달라질 이유가 없기 때문이다.
export const ACCOUNTS = [
  {
    key: 'admin',
    id: '00000000-0000-4000-8000-00000000b001',
    email: 'authz-admin@test.local',
    password: 'Authz!Admin2026',
    profile: { is_admin: true, registration_status: 'approved', is_active: true },
  },
  {
    key: 'owner',
    id: '00000000-0000-4000-8000-00000000b002',
    email: 'authz-owner@test.local',
    password: 'Authz!Owner2026',
    profile: { is_admin: false, registration_status: 'approved', is_active: true },
  },
  {
    key: 'other',
    id: '00000000-0000-4000-8000-00000000b003',
    email: 'authz-other@test.local',
    password: 'Authz!Other2026',
    profile: { is_admin: false, registration_status: 'approved', is_active: true },
  },
  {
    key: 'pending',
    id: '00000000-0000-4000-8000-00000000b004',
    email: 'authz-pending@test.local',
    password: 'Authz!Pend2026',
    profile: { is_admin: false, registration_status: 'pending', is_active: false },
  },
]

/**
 * Better Auth(Turso)의 user/account 행을 만들거나 갱신한다. `user.id`와
 * `member_profiles.id`가 어긋나면 로그인 후 `getSessionContext()`가 엉뚱한
 * (또는 존재하지 않는) 프로필을 찾으므로 같은 id를 쓴다.
 */
async function upsertTursoAuth(account) {
  const id = account.id
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

async function main() {
  const ids = {}
  for (const account of ACCOUNTS) {
    ids[account.key] = account.id
    await upsertTursoAuth(account)
    await upsertProfile({
      id: account.id,
      email: account.email,
      display_name: `authz-${account.key}`,
      ...account.profile,
    })
  }

  // 고정 UUID를 쓴다 — 매번 새로 만들면 멱등이 깨지고, 실패한 실행이 쓰레기를 남긴다.
  const POST_ID = '00000000-0000-4000-8000-00000000a001'
  const COMMENT_ID = '00000000-0000-4000-8000-00000000a002'
  const NOTIFICATION_ID = '00000000-0000-4000-8000-00000000a003'
  const MAINTENANCE_SETTING_ID = '00000000-0000-4000-8000-00000000a004'
  const REGISTRATION_SETTING_ID = '00000000-0000-4000-8000-00000000a005'

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

  // readAt을 매 시드마다 null로 되돌린다 — e2e 스펙 안의
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

  // post_likes: id가 아니라 (postId, userId) 복합 유니크가 충돌 대상이라
  // onConflictDoNothing만으로 충분하다(갱신할 다른 컬럼이 없다).
  await db
    .insert(tursoPostLikes)
    .values({ postId: POST_ID, userId: ids.owner })
    .onConflictDoNothing({ target: [tursoPostLikes.postId, tursoPostLikes.userId] })

  // system_settings: 미들웨어(`src/middleware/settings.ts`)가 읽는 두 행.
  // 유지보수는 항상 **꺼진 상태**로 되돌린다 — 앞선 실행이 켜진 채로 죽으면
  // 다음 실행의 authz-setup 로그인이 통째로 503에 막힌다.
  // 충돌 대상은 id가 아니라 (category, setting_key) 유니크 인덱스다.
  const settingRows = [
    {
      id: MAINTENANCE_SETTING_ID,
      category: 'site',
      settingKey: 'maintenance_mode',
      settingValue: { enabled: false, message: '점검 중입니다.' },
      description: 'authz E2E 픽스처',
      isSensitive: false,
    },
    {
      id: REGISTRATION_SETTING_ID,
      category: 'site',
      settingKey: 'registration_enabled',
      settingValue: { enabled: true },
      description: 'authz E2E 픽스처',
      isSensitive: false,
    },
  ]
  for (const row of settingRows) {
    await db
      .insert(tursoSystemSettings)
      .values(row)
      .onConflictDoUpdate({
        target: [tursoSystemSettings.category, tursoSystemSettings.settingKey],
        set: { settingValue: row.settingValue, isSensitive: row.isSensitive },
      })
  }

  // default_settings: 사용자 설정 조회(`getUserSettings`)는 이 표를 **왼쪽
  // 테이블**로 쓴다 — 여기 없는 키는 사용자가 값을 저장해도 조회 결과에
  // 나타나지 않는다. 운영에는 마이그레이션
  // (`supabase/migrations/20250719090070_create_user_settings.sql`)이 심어둔
  // 16행이 있지만 빈 로컬 DB에는 0행이라, 정책 58 스펙("내가 저장한 값이 내
  // 조회에는 보이고 남의 조회에는 없다")이 **양쪽 다 빈 목록**이라는 이유로
  // 깨졌다. 아래 목록은 그 마이그레이션과 같은 내용이다(참조 데이터).
  const DEFAULT_SETTINGS = [
    [
      'notification',
      'email_notifications',
      {
        enabled: true,
        post_notifications: true,
        comment_notifications: true,
        system_notifications: true,
      },
      '이메일 알림 설정',
      true,
    ],
    [
      'notification',
      'web_notifications',
      {
        enabled: true,
        post_notifications: true,
        comment_notifications: true,
        mention_notifications: true,
      },
      '웹 푸시 알림 설정',
      true,
    ],
    [
      'notification',
      'notification_frequency',
      { value: 'immediate', options: ['immediate', 'daily', 'weekly', 'never'] },
      '알림 빈도 설정',
      true,
    ],
    [
      'privacy',
      'profile_visibility',
      { level: 'members', options: ['public', 'members', 'private'] },
      '프로필 공개 범위',
      true,
    ],
    [
      'privacy',
      'activity_visibility',
      { show_activity: true, show_last_seen: false },
      '활동 내역 공개 설정',
      false,
    ],
    [
      'privacy',
      'contact_visibility',
      { show_email: false, show_phone: false },
      '연락처 공개 설정',
      false,
    ],
    [
      'interface',
      'theme',
      { mode: 'light', options: ['light', 'dark', 'auto'] },
      '테마 설정',
      true,
    ],
    ['interface', 'language', { locale: 'ko', options: ['ko', 'en'] }, '언어 설정', true],
    ['interface', 'timezone', { value: 'Asia/Seoul' }, '시간대 설정', true],
    [
      'interface',
      'post_display',
      { items_per_page: 20, view_mode: 'card', show_images: true },
      '게시글 표시 설정',
      false,
    ],
    [
      'security',
      'session_timeout',
      { minutes: 480, options: [60, 240, 480, 1440] },
      '세션 타임아웃 설정',
      false,
    ],
    [
      'security',
      'login_notifications',
      { notify_new_device: true, notify_suspicious: true },
      '로그인 알림 설정',
      false,
    ],
    [
      'security',
      'two_factor',
      { enabled: false, method: 'none', options: ['none', 'email', 'sms'] },
      '2단계 인증 설정',
      false,
    ],
    [
      'preference',
      'content_filter',
      { adult_content: false, violence_content: false },
      '콘텐츠 필터링 설정',
      false,
    ],
    [
      'preference',
      'accessibility',
      { high_contrast: false, large_text: false, reduced_motion: false },
      '접근성 설정',
      false,
    ],
    ['preference', 'auto_save', { enabled: true, interval_minutes: 5 }, '자동 저장 설정', false],
  ]
  for (const [category, settingKey, defaultValue, description, isRequired] of DEFAULT_SETTINGS) {
    await db
      .insert(tursoDefaultSettings)
      .values({ category, settingKey, defaultValue, description, isRequired })
      .onConflictDoUpdate({
        target: [tursoDefaultSettings.category, tursoDefaultSettings.settingKey],
        set: { defaultValue, description, isRequired },
      })
  }

  const fixtures = {
    users: ids,
    postId: POST_ID,
    commentId: COMMENT_ID,
    notificationId: NOTIFICATION_ID,
  }
  writeFileSync(OUT_FILE, JSON.stringify(fixtures, null, 2) + '\n')
  console.log(`픽스처 시드 완료 → ${OUT_FILE}`)
  console.log(
    `  계정 ${Object.keys(ids).length}개, 글 1, 댓글 1, 알림 1, 좋아요 1, ` +
      `system_settings ${settingRows.length}행, default_settings ${DEFAULT_SETTINGS.length}행 (전부 Turso)`
  )
}

await main()
