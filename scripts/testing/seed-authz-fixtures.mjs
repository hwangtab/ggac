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
const { memberProfiles: tursoMemberProfiles } = await import('@/db/schema/identity')
const { WITHDRAWN_DISPLAY_NAME, withdrawnEmailFor } = await import('@/constants/memberProfile')
const {
  boardMeetings: tursoBoardMeetings,
  boardAgendas: tursoBoardAgendas,
  boardAgendaComments: tursoBoardAgendaComments,
} = await import('@/db/schema/board')
const { eq } = await import('drizzle-orm')

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
  // 이사 경계(`e2e/authz-roles.spec.ts`)의 **허용 쪽**. 관리자가 아니라
  // `is_director`만으로 이사회에 들어갈 수 있어야 `canAccessBoardRoom`이
  // 실제로 이사 판정을 하는지 증명된다 — admin 계정으로 확인하면
  // `is_admin` 분기만 타서 이사 판정은 여전히 검사되지 않는다.
  {
    key: 'director',
    id: '00000000-0000-4000-8000-00000000b005',
    email: 'authz-director@test.local',
    password: 'Authz!Direct2026',
    profile: {
      is_admin: false,
      registration_status: 'approved',
      is_active: true,
      is_director: true,
      director_title: '이사',
    },
  },
  // 관리자 전용 **쓰기** 경계(회원 승인)의 대상. `pending` 계정을 그대로
  // 쓰면 `authz-ownership.spec.ts`의 "미승인 조합원" 단정 2건이 기대하는
  // 상태를 이 스펙이 승인해버려 무너뜨린다 — 그래서 승인당해도 되는 계정을
  // 따로 둔다. 로그인 대상이 아니므로 `e2e/authz.setup.ts`에는 없다.
  {
    key: 'approvalTarget',
    id: '00000000-0000-4000-8000-00000000b006',
    email: 'authz-approval-target@test.local',
    password: 'Authz!Target2026',
    profile: { is_admin: false, registration_status: 'pending', is_active: false },
  },
  // 탈퇴 "신청" 상태(Task 8) — 설계가 상태값이 아니라
  // `withdrawal_requested_at` 타임스탬프로 바뀐 핵심을 검증하는 계정이다.
  // `registration_status`는 여전히 'approved'이고 로그인·마이페이지·게시판
  // 접근이 그대로 되어야 한다. 로그인 대상이므로 `e2e/authz.setup.ts`에도
  // 있다.
  {
    key: 'withdrawalRequested',
    id: '00000000-0000-4000-8000-00000000b007',
    email: 'authz-withdrawal-requested@test.local',
    password: 'Authz!WithdrawReq2026',
    profile: {
      is_admin: false,
      registration_status: 'approved',
      is_active: true,
      withdrawal_requested_at: new Date('2026-08-25T00:00:00.000Z'),
    },
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

/**
 * 픽스처 계정의 **권한·승인 컬럼**이 가져야 할 값. 여기에 없는 컬럼은 이
 * 스크립트가 강제하지 않는다.
 *
 * `upsertProfile()`은 이 컬럼들을 **절대 되돌리지 못한다.** 그 함수의 충돌
 * 갱신 화이트리스트(`CONFLICT_UPDATABLE_FIELDS`,
 * `src/db/queries/profiles.ts`)가 권한·승인 컬럼을 의도적으로 제외하기
 * 때문이다 — 그건 운영을 지키는 올바른 설계다(재이관·재가입이 관리자 플래그나
 * 승인 상태를 덮어쓰면 안 된다). 그래서 **되돌리는 책임이 시드 쪽에 있다.**
 *
 * 왜 필요한가(실측 시나리오): `updateProfile()`의 `where`가 빠지는 회귀 —
 * 즉 `e2e/authz-roles.spec.ts`가 잡으라고 존재하는 바로 그 회귀 — 상태로
 * 스위트를 한 번 돌리면 관리자 승인 액션이 **전 회원 행**에 적용돼
 * `authz-pending`까지 `approved`가 된다. 그 뒤 시드를 몇 번 다시 돌려도
 * `upsertProfile`만으로는 복구되지 않고, `authz-ownership.spec.ts`의 "미승인
 * 조합원" 단정이 **원인이 앱에 있는 것처럼 보이는** 메시지로 계속 빨간불이
 * 된다. 하필 그 회귀를 고치고 검증하려는 순간(컷오버 직전)에 걸린다.
 *
 * 새 권한 컬럼이 생기면 여기에 추가한다. 추가를 잊어도 조용히 넘어가지
 * 않는다 — `expectedAuthzState()`가 계정 정의에 있는 미등록 키를 던진다.
 */
const AUTHZ_DEFAULTS = {
  registrationStatus: 'pending',
  isActive: false,
  isAdmin: false,
  isDirector: false,
  isAuditor: false,
  isSuspended: false,
  directorTitle: null,
  suspensionReason: null,
  suspensionUntil: null,
  approvedAt: null,
  approvedBy: null,
  rejectedBy: null,
  // Task 8: 탈퇴 신청 여부. AUTHZ_DEFAULTS에 없으면 `expectedAuthzState()`가
  // 'withdrawalRequested' 계정의 profile 키를 보고 던진다 — 그 가드가 여기
  // 추가를 강제한다.
  withdrawalRequestedAt: null,
}

const toCamelCaseKey = key => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())

/** 계정 정의(`profile`, snake_case)를 컬럼 기대값(camelCase)으로 편다. */
function expectedAuthzState(account) {
  const state = { ...AUTHZ_DEFAULTS }
  for (const [key, value] of Object.entries(account.profile)) {
    const column = toCamelCaseKey(key)
    if (!(column in AUTHZ_DEFAULTS)) {
      throw new Error(
        `계정 '${account.key}'의 profile에 있는 '${key}'가 AUTHZ_DEFAULTS에 없다. ` +
          '권한·승인 컬럼이면 AUTHZ_DEFAULTS에 기본값과 함께 추가할 것 ' +
          '(추가하지 않으면 시드가 그 컬럼을 되돌리지 못한다).'
      )
    }
    state[column] = value
  }
  return state
}

const formatCell = value => {
  if (value === null || value === undefined) return 'null'
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

const AUTHZ_COLUMNS = Object.keys(AUTHZ_DEFAULTS)

async function readAuthzState(id) {
  const rows = await db
    .select()
    .from(tursoMemberProfiles)
    .where(eq(tursoMemberProfiles.id, id))
    .limit(1)
  if (!rows[0]) return null
  const state = {}
  for (const column of AUTHZ_COLUMNS) state[column] = rows[0][column] ?? null
  return state
}

function diffAuthzState(found, expected) {
  return AUTHZ_COLUMNS.filter(column => {
    const a = found[column]
    const b = expected[column]
    if (b === null) return !(a === null || a === undefined)
    if (b instanceof Date) return !(a instanceof Date) || a.getTime() !== b.getTime()
    return a !== b
  }).map(column => ({ column, found: found[column], expected: expected[column] }))
}

/**
 * 한 계정의 권한·승인 컬럼을 기대값으로 **강제로** 되돌린다.
 *
 * 조용히 고치지 않는다: 되돌리기 전 상태와 다르면 무엇이 어떻게 달랐는지
 * 반환하고, 호출부가 경고로 찍는다. 그러지 않으면 "왜 오염됐는지"를 아무도
 * 못 보게 된다 — 이 시드는 회귀 조사 중에 돌아갈 때가 가장 많다.
 *
 * 되돌린 **뒤에는 다시 읽어 대조하고, 그래도 다르면 던진다**(fail-closed).
 * 여기서 조용히 넘어가면 스위트가 "무엇을 검사했는지 알 수 없는 초록불"이
 * 될 수 있다 — `authz-maintenance.spec.ts`/`authz-roles.spec.ts`의
 * `rowsAffected` 검사와 같은 기준이다.
 *
 * UPDATE의 `where`를 이 스크립트가 직접 쓴다(앱의 `updateProfile()`을 쓰지
 * 않는다). 복구 도구가 검사 대상인 앱 코드에 의존하면, 바로 그
 * "`where` 누락" 회귀 상태에서 시드가 **전 회원 행을 마지막 계정 상태로
 * 덮어쓰는** 복구 불가능한 사고가 된다.
 */
async function enforceAuthzState(account) {
  const expected = expectedAuthzState(account)
  const before = await readAuthzState(account.id)
  if (!before) {
    throw new Error(
      `계정 '${account.key}'(${account.id})의 member_profiles 행이 없다. ` +
        'upsertProfile이 실패했는지 확인할 것.'
    )
  }

  const drift = diffAuthzState(before, expected)
  if (drift.length > 0) {
    const updated = await db
      .update(tursoMemberProfiles)
      .set(expected)
      .where(eq(tursoMemberProfiles.id, account.id))
      .returning({ id: tursoMemberProfiles.id })
    if (updated.length !== 1) {
      throw new Error(
        `계정 '${account.key}' 권한 상태 복구 실패: ${updated.length}개 행이 갱신됐다(1이어야 한다).`
      )
    }
  }

  const after = await readAuthzState(account.id)
  const remaining = diffAuthzState(after ?? {}, expected)
  if (remaining.length > 0) {
    throw new Error(
      `계정 '${account.key}'의 권한·승인 상태를 되돌리지 못했다:\n` +
        remaining
          .map(d => `  - ${d.column}: ${formatCell(d.found)} (기대: ${formatCell(d.expected)})`)
          .join('\n')
    )
  }
  return drift
}

async function main() {
  const ids = {}
  const driftReport = []
  for (const account of ACCOUNTS) {
    ids[account.key] = account.id
    await upsertTursoAuth(account)
    await upsertProfile({
      id: account.id,
      email: account.email,
      display_name: `authz-${account.key}`,
      ...account.profile,
    })
    const drift = await enforceAuthzState(account)
    if (drift.length > 0) driftReport.push({ key: account.key, drift })
  }

  // 탈퇴 **완료** 계정(Task 8). 위 ACCOUNTS 루프(`upsertTursoAuth`)에 넣지
  // 않는다 — 그 루프는 모든 계정에 로그인 가능한 `account`(비밀번호) 행을
  // 만드는데, 탈퇴 완료 계정은 정확히 그 행이 **없어야** `withdrawMember()`가
  // 만드는 실제 상태(로그인 수단 삭제)를 재현한다. `member_profiles`·`user`
  // 행은 앱이 탈퇴 확정 때 남기는 모양(묘비) 그대로 직접 심는다.
  const WITHDRAWN_ID = '00000000-0000-4000-8000-00000000b008'
  const withdrawnEmail = withdrawnEmailFor(WITHDRAWN_ID)

  const withdrawnUserValues = {
    id: WITHDRAWN_ID,
    name: WITHDRAWN_DISPLAY_NAME,
    email: withdrawnEmail,
    emailVerified: false,
  }
  await db
    .insert(tursoUser)
    .values(withdrawnUserValues)
    .onConflictDoUpdate({ target: tursoUser.id, set: withdrawnUserValues })
  // 로그인 수단을 없앤다 — 재실행 때 이전 실행이 만든 account 행이 남아
  // 있으면 안 되므로(멱등), insert가 아니라 매번 delete한다.
  await db.delete(tursoAccount).where(eq(tursoAccount.userId, WITHDRAWN_ID))

  const withdrawnProfileValues = {
    id: WITHDRAWN_ID,
    displayName: WITHDRAWN_DISPLAY_NAME,
    email: withdrawnEmail,
    registrationStatus: 'withdrawn',
    isActive: false,
    isAdmin: false,
    isMember: false,
    isArtist: false,
    isDirector: false,
    isAuditor: false,
    isSuspended: false,
    realName: null,
    phoneNumber: null,
    birthDate: null,
    bankName: null,
    accountNumber: null,
    accountHolder: null,
    monthlyFee: null,
    artistId: null,
    directorTitle: null,
    artistRole: 'owner',
    verificationStatus: { email: false, phone: false, identity: false },
    withdrawnAt: new Date('2026-08-30T00:00:00.000Z'),
    withdrawalRequestedAt: null,
  }
  await db
    .insert(tursoMemberProfiles)
    .values(withdrawnProfileValues)
    .onConflictDoUpdate({ target: tursoMemberProfiles.id, set: withdrawnProfileValues })

  ids.withdrawnEmail = withdrawnEmail

  // 고정 UUID를 쓴다 — 매번 새로 만들면 멱등이 깨지고, 실패한 실행이 쓰레기를 남긴다.
  const POST_ID = '00000000-0000-4000-8000-00000000a001'
  const COMMENT_ID = '00000000-0000-4000-8000-00000000a002'
  const NOTIFICATION_ID = '00000000-0000-4000-8000-00000000a003'
  const MAINTENANCE_SETTING_ID = '00000000-0000-4000-8000-00000000a004'
  const BOARD_MEETING_ID = '00000000-0000-4000-8000-00000000a006'
  const BOARD_AGENDA_ID = '00000000-0000-4000-8000-00000000a007'
  const BOARD_COMMENT_ID = '00000000-0000-4000-8000-00000000a008'
  const BOARD_COMMENT_DELETABLE_ID = '00000000-0000-4000-8000-00000000a009'
  const BOARD_COMMENT_BY_ADMIN_ID = '00000000-0000-4000-8000-00000000a00a'
  const REGISTRATION_SETTING_ID = '00000000-0000-4000-8000-00000000a005'

  // `isDeleted: false`가 여기 있어야 시드가 **복구 수단**이 된다. 이 스크립트는
  // 스스로 "멱등이다 — 실패한 실행을 그대로 다시 돌려 복구할 수 있어야 한다"고
  // 적고 있지만, 이 키가 빠져 있으면 `onConflictDoUpdate`의 set에도 들어가지
  // 않아 소프트 삭제된 픽스처 글(`is_deleted = 1`)이 되돌아오지 않았다.
  // 삭제 인가 검사에 회귀가 생기면 스위트가 픽스처 글을 실제로 지우는데,
  // 하필 **그 회귀를 수정하고 검증하려는 순간**(컷오버 직전) 시드를 다시
  // 돌려도 소유권·첨부 스펙이 "403 기대 → 404" 같은 엉뚱한 메시지로 계속
  // 빨간불이라 원인이 앱에 있는 것처럼 보였다. 손으로 UPDATE해야만 풀렸다.
  // (`posts`에는 deleted_at/deleted_by 계열 컬럼이 없다 — 소프트 삭제 상태는
  // 이 한 컬럼이 전부다: `src/db/schema/content.ts`.)
  const postValues = {
    id: POST_ID,
    title: 'authz 픽스처 글',
    content: '<p>소유권 경계 테스트용</p>',
    contentFormat: 'html',
    category: '잡담',
    authorId: ids.owner,
    isPinned: false,
    isDeleted: false,
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

  // 이사회 안건 토론 픽스처. 작성자는 `director`다 — 관리자(admin)가 남의
  // 발언을 **수정은 못 하고 삭제만 할 수 있다**는 경계를 두 계정으로 재현한다.
  // 댓글이 둘인 이유: 관리자 삭제 테스트가 하나를 소모하므로, 남겨 두는 쪽
  // (BOARD_COMMENT_ID)이 없으면 같은 파일의 뒤 테스트가 404로 흔들린다.
  const boardMeetingValues = {
    id: BOARD_MEETING_ID,
    title: 'authz 픽스처 이사회',
    status: 'scheduled',
    createdBy: ids.admin,
  }
  await db
    .insert(tursoBoardMeetings)
    .values(boardMeetingValues)
    .onConflictDoUpdate({ target: tursoBoardMeetings.id, set: boardMeetingValues })

  const boardAgendaValues = {
    id: BOARD_AGENDA_ID,
    meetingId: BOARD_MEETING_ID,
    title: 'authz 픽스처 안건',
    content: '토론 경계 테스트용',
    sortOrder: 0,
    status: 'proposed',
    proposedBy: ids.director,
  }
  await db
    .insert(tursoBoardAgendas)
    .values(boardAgendaValues)
    .onConflictDoUpdate({ target: tursoBoardAgendas.id, set: boardAgendaValues })

  // `isDeleted: false`는 픽스처 글과 같은 이유로 반드시 set에도 들어간다 —
  // 관리자 삭제 스펙이 soft delete를 남기므로 시드가 되돌리지 못하면 다음
  // 실행이 404로 시작한다.
  // 세 번째 댓글의 작성자는 **관리자**다 — "이사이지만 작성자가 아닌 사람"
  // 경계(이사가 남의 발언을 지우거나 고치지 못한다)를 표현하려면 director가
  // 작성자가 **아닌** 댓글이 하나 있어야 한다.
  const boardCommentAuthors = {
    [BOARD_COMMENT_ID]: ids.director,
    [BOARD_COMMENT_DELETABLE_ID]: ids.director,
    [BOARD_COMMENT_BY_ADMIN_ID]: ids.admin,
  }
  for (const [id, authorId] of Object.entries(boardCommentAuthors)) {
    const values = {
      id,
      agendaId: BOARD_AGENDA_ID,
      authorId,
      content: 'authz 픽스처 안건 의견',
      isDeleted: false,
    }
    await db
      .insert(tursoBoardAgendaComments)
      .values(values)
      .onConflictDoUpdate({ target: tursoBoardAgendaComments.id, set: values })
  }

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
    boardMeetingId: BOARD_MEETING_ID,
    boardAgendaId: BOARD_AGENDA_ID,
    boardCommentId: BOARD_COMMENT_ID,
    boardCommentDeletableId: BOARD_COMMENT_DELETABLE_ID,
    boardCommentByAdminId: BOARD_COMMENT_BY_ADMIN_ID,
  }
  writeFileSync(OUT_FILE, JSON.stringify(fixtures, null, 2) + '\n')

  // 되돌렸다는 사실을 **크게** 알린다. 조용히 고치면 "왜 오염됐는지"를 못 보게
  // 되고, 다음 사람이 같은 회귀를 다시 만난다.
  if (driftReport.length > 0) {
    console.warn('\n⚠ 픽스처 계정의 권한·승인 상태가 기대와 달랐다 — 시드가 되돌렸다:')
    for (const { key, drift } of driftReport) {
      for (const d of drift) {
        console.warn(`  - ${key}.${d.column}: ${formatCell(d.found)} → ${formatCell(d.expected)}`)
      }
    }
    console.warn(
      '  이 값들은 앱을 통해서만 바뀐다. 직전에 돌린 스위트가 권한 경계 회귀\n' +
        '  (예: updateProfile의 where 누락)를 탔는지 확인할 것 — 픽스처가 오염됐다는 것은\n' +
        '  같은 쓰기가 운영에서도 전 회원 행에 적용된다는 뜻이다.\n'
    )
  }

  console.log(`픽스처 시드 완료 → ${OUT_FILE}`)
  console.log(
    `  계정 ${Object.keys(ids).length}개, 글 1, 댓글 1, 알림 1, 좋아요 1, ` +
      `이사회 회의 1·안건 1·안건 의견 3, ` +
      `system_settings ${settingRows.length}행, default_settings ${DEFAULT_SETTINGS.length}행 (전부 Turso)`
  )
}

await main()
