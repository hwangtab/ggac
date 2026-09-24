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
const { requestWithdrawal, withdrawMember } = await import('@/db/queries/withdrawal')
const {
  boardMeetings: tursoBoardMeetings,
  boardAgendas: tursoBoardAgendas,
  boardAgendaComments: tursoBoardAgendaComments,
  boardMinutes: tursoBoardMinutes,
} = await import('@/db/schema/board')
const {
  fundingCampaigns: tursoFundingCampaigns,
  fundingRewards: tursoFundingRewards,
  fundingPledges: tursoFundingPledges,
} = await import('@/db/schema/funding')
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
  // 만드는데, 탈퇴 완료 계정은 정확히 그 행이 **없어야** 한다.
  //
  // **묘비를 손으로 심지 않는다.** 예전에는 `registration_status:'withdrawn'`
  // 부터 PII NULL까지 앱이 남기는 모양을 이 파일이 흉내 냈는데, 그러면
  // `withdrawMember()`가 무엇을 바꾸는지가 달라져도 이 픽스처는 조용히 옛
  // 모양을 유지한다 — 검증하려던 상태가 실제 상태와 갈라진다. 승인 상태로
  // 심은 뒤 **실제 프로덕션 함수를 그대로 부른다.**
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

  // 탈퇴 **전** 상태로 심는다 — 이름·PII가 들어 있는 평범한 승인 조합원.
  // 재실행 때 앞선 실행이 남긴 묘비를 덮어써야 하므로 모든 필드를 명시한다.
  const preWithdrawalProfile = {
    id: WITHDRAWN_ID,
    displayName: '탈퇴예정조합원',
    email: 'pre-withdrawal@ggac.test',
    registrationStatus: 'approved',
    isActive: true,
    isAdmin: false,
    isMember: true,
    isArtist: false,
    isDirector: false,
    isAuditor: false,
    isSuspended: false,
    realName: '홍길동',
    phoneNumber: '010-0000-0000',
    artistId: null,
    directorTitle: null,
    artistRole: 'owner',
    verificationStatus: { email: true, phone: false, identity: false },
    withdrawnAt: null,
    withdrawalRequestedAt: null,
  }
  await db
    .insert(tursoMemberProfiles)
    .values(preWithdrawalProfile)
    .onConflictDoUpdate({ target: tursoMemberProfiles.id, set: preWithdrawalProfile })

  // 실제 경로 그대로: 회원이 신청하고, 관리자가 확정한다. 둘 다 프로덕션
  // 함수다 — 이 두 함수가 만드는 상태가 바뀌면 픽스처도 함께 바뀐다.
  // requestWithdrawal은 boolean, withdrawMember는 {ok, reason}을 돌려준다.
  if (!(await requestWithdrawal(WITHDRAWN_ID))) {
    throw new Error('탈퇴 신청 픽스처 실패: rowsAffected가 0이다')
  }
  const withdrawn = await withdrawMember(WITHDRAWN_ID)
  if (!withdrawn.ok) {
    throw new Error(`탈퇴 확정 픽스처 실패: ${withdrawn.reason}`)
  }

  // 함수가 실제로 묘비를 남겼는지 확인한다 — 픽스처가 조용히 어긋나면
  // 이 시드에 기대는 E2E 전부가 엉뚱한 상태를 검증하게 된다.
  const [tombstone] = await db
    .select({
      status: tursoMemberProfiles.registrationStatus,
      email: tursoMemberProfiles.email,
      displayName: tursoMemberProfiles.displayName,
      realName: tursoMemberProfiles.realName,
      isActive: tursoMemberProfiles.isActive,
    })
    .from(tursoMemberProfiles)
    .where(eq(tursoMemberProfiles.id, WITHDRAWN_ID))
  if (
    tombstone?.status !== 'withdrawn' ||
    tombstone.email !== withdrawnEmail ||
    tombstone.displayName !== WITHDRAWN_DISPLAY_NAME ||
    tombstone.realName !== null ||
    tombstone.isActive !== false
  ) {
    throw new Error(`탈퇴 확정 뒤 상태가 기대와 다르다: ${JSON.stringify(tombstone)}`)
  }

  ids.withdrawnEmail = withdrawnEmail

  // 고정 UUID를 쓴다 — 매번 새로 만들면 멱등이 깨지고, 실패한 실행이 쓰레기를 남긴다.
  const POST_ID = '00000000-0000-4000-8000-00000000a001'
  const COMMENT_ID = '00000000-0000-4000-8000-00000000a002'
  const NOTIFICATION_ID = '00000000-0000-4000-8000-00000000a003'
  const MAINTENANCE_SETTING_ID = '00000000-0000-4000-8000-00000000a004'
  const BOARD_MEETING_ID = '00000000-0000-4000-8000-00000000a006'
  // 회의록 은닉 경계를 증명하려면 **내용이 있는 회의록**이 두 벌 필요하다.
  // scheduled 회의의 것은 조합원에게 가려야 하고 completed 회의의 것은 보여야
  // 하는데, 한 벌만 두면 "가려졌다"가 게이트 때문인지 데이터가 없어서인지
  // 구분되지 않는다.
  const BOARD_MEETING_DONE_ID = '00000000-0000-4000-8000-00000000a020'
  const BOARD_MINUTES_DRAFT_ID = '00000000-0000-4000-8000-00000000a021'
  const BOARD_MINUTES_DONE_ID = '00000000-0000-4000-8000-00000000a022'
  const BOARD_AGENDA_ID = '00000000-0000-4000-8000-00000000a007'
  const BOARD_COMMENT_ID = '00000000-0000-4000-8000-00000000a008'
  const BOARD_COMMENT_DELETABLE_ID = '00000000-0000-4000-8000-00000000a009'
  const BOARD_COMMENT_BY_ADMIN_ID = '00000000-0000-4000-8000-00000000a00a'
  const REGISTRATION_SETTING_ID = '00000000-0000-4000-8000-00000000a005'
  const FUNDING_SETTING_ID = '00000000-0000-4000-8000-00000000a00b'
  // 기능 스위치 넷(`e2e/authz-features.spec.ts`가 껐다 켠다). 시드가 이 행을
  // 만들지 않으면 스펙의 UPDATE가 0행에 적용되고, 그래도 "막히지 않는다"
  // 단정은 통과한다 — 유지보수 스펙이 예전에 정확히 그렇게 조용히 아무것도
  // 검사하지 않았다. 스펙 쪽이 영향 행 수를 확인해 그 재발을 막는다.
  const BOARD_FEATURE_SETTING_ID = '00000000-0000-4000-8000-00000000a00c'
  const ARTIST_FEATURE_SETTING_ID = '00000000-0000-4000-8000-00000000a00d'
  const COMMENT_FEATURE_SETTING_ID = '00000000-0000-4000-8000-00000000a00e'
  const FILE_UPLOAD_SETTING_ID = '00000000-0000-4000-8000-00000000a00f'
  // 펀딩 인가 경계(`e2e/authz-funding.spec.ts`)용 픽스처. 캠페인을 둘 둔다 —
  // 하나는 `owner`의 편집 가능한 초안(읽기·수정·리워드·본인 제출 경계),
  // 다른 하나는 이미 심사 대기 중인 캠페인(관리자 심사 경계)이다. 한 캠페인으로
  // 두 목적을 다 채우려 하면 "본인이 제출한다" 테스트가 상태를 submitted로
  // 옮겨버려, 그 뒤에 도는 관리자 심사 테스트가 기대하는 시작 상태(submitted)와
  // 충돌하거나 실행 순서에 스위트가 종속된다.
  const FUNDING_DRAFT_CAMPAIGN_ID = '00000000-0000-4000-8000-00000000f001'
  const FUNDING_DRAFT_REWARD_ID = '00000000-0000-4000-8000-00000000f002'
  const FUNDING_REVIEW_CAMPAIGN_ID = '00000000-0000-4000-8000-00000000f003'
  const FUNDING_REVIEW_REWARD_ID = '00000000-0000-4000-8000-00000000f004'

  // 관리자 전용 동작(approve·reject·settle)을 **동작마다 한 캠페인씩** 둔다.
  //
  // 왜 캠페인을 나누는가: 짝 단정(개설자는 거부 · 관리자는 성공)이 실제로
  // 같은 동작을 두 번 시도한다. 한 캠페인을 돌려쓰면 관리자 쪽이 먼저 상태를
  // 옮겨버려 다음 동작의 시작 상태가 스위트 실행 순서에 종속된다. 그리고
  // `settle`은 시작 상태가 `closed`여야 전이표를 지난다 — 시작 상태가 다르면
  // 가드를 지워도 400(전이 불가)이 나서 "막혔다"와 구별되지 않는다.
  const FUNDING_APPROVE_CAMPAIGN_ID = '00000000-0000-4000-8000-00000000f005'
  const FUNDING_APPROVE_REWARD_ID = '00000000-0000-4000-8000-00000000f006'
  const FUNDING_REJECT_CAMPAIGN_ID = '00000000-0000-4000-8000-00000000f007'
  const FUNDING_REJECT_REWARD_ID = '00000000-0000-4000-8000-00000000f008'
  const FUNDING_SETTLE_CAMPAIGN_ID = '00000000-0000-4000-8000-00000000f009'
  const FUNDING_SETTLE_REWARD_ID = '00000000-0000-4000-8000-00000000f00a'

  // 후원 취소 경계(`POST /api/funding/pledges/cancel`)용. 공개(active) 캠페인
  // 하나에 결제가 끝난 후원 둘 — 회원(`other`)의 것과 비회원의 것.
  //
  // **후원자는 `owner`가 아니다.** 감사가 짚은 시나리오가 "개설자의 대시보드가
  // 자기 캠페인의 후원 id를 전부 건네준다"이므로, 거부당해야 하는 쪽이
  // 개설자(`owner`)이고 허용돼야 하는 쪽이 후원자(`other`)여야 그 시나리오를
  // 그대로 재현한다.
  //
  // `paymentId`는 **일부러 비워 둔다.** 취소 라우트의 성공 경로는 토스에 실제
  // 환불을 요청하는데(`API_BASE`가 상수라 가짜 서버로 돌릴 수 없다) E2E에서
  // 그걸 부를 수는 없다. 결제 연결이 없으면 라우트는 신원 확인을 **지난 뒤**
  // 400 `결제 정보를 확인할 수 없습니다`로 답한다 — 거부(404 `찾을 수 없습니다`)와
  // 글자 단위로 다른 답이라, 신원 관문을 통과했다는 사실만은 돈을 움직이지 않고
  // 증명할 수 있다. 선점(`claimPledgeForCancel`)은 이 검사보다 뒤에 있으므로
  // 어느 쪽 요청도 행을 바꾸지 않는다.
  const FUNDING_ACTIVE_CAMPAIGN_ID = '00000000-0000-4000-8000-00000000f00b'
  const FUNDING_ACTIVE_REWARD_ID = '00000000-0000-4000-8000-00000000f00c'
  const FUNDING_MEMBER_PLEDGE_ID = '00000000-0000-4000-8000-00000000f00d'
  const FUNDING_GUEST_PLEDGE_ID = '00000000-0000-4000-8000-00000000f00e'
  const FUNDING_MEMBER_PLEDGE_CODE = 'FND-20260901-MEMBER22'
  const FUNDING_GUEST_PLEDGE_CODE = 'FND-20260901-GUEST222'
  const FUNDING_GUEST_BACKER_EMAIL = 'authz-guest-backer@test.local'
  // 회원 후원자(`other`)의 가입 이메일과 같은 값이다. 비회원 경로의 열쇠
  // 절반이라 스펙이 그대로 쓴다.
  const FUNDING_MEMBER_BACKER_EMAIL = 'authz-other@test.local'

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

  const boardMeetingDoneValues = {
    id: BOARD_MEETING_DONE_ID,
    title: 'authz 픽스처 완료 이사회',
    status: 'completed',
    createdBy: ids.admin,
  }
  await db
    .insert(tursoBoardMeetings)
    .values(boardMeetingDoneValues)
    .onConflictDoUpdate({ target: tursoBoardMeetings.id, set: boardMeetingDoneValues })

  const minutesDraftValues = {
    id: BOARD_MINUTES_DRAFT_ID,
    meetingId: BOARD_MEETING_ID,
    content: '작성 중인 회의록 본문 — 조합원에게 보이면 안 된다',
    contentFormat: 'markdown',
    authorId: ids.director,
  }
  await db
    .insert(tursoBoardMinutes)
    .values(minutesDraftValues)
    .onConflictDoUpdate({ target: tursoBoardMinutes.id, set: minutesDraftValues })

  const minutesDoneValues = {
    id: BOARD_MINUTES_DONE_ID,
    meetingId: BOARD_MEETING_DONE_ID,
    content: '확정된 회의록 본문 — 조합원도 읽는다',
    contentFormat: 'markdown',
    authorId: ids.director,
  }
  await db
    .insert(tursoBoardMinutes)
    .values(minutesDoneValues)
    .onConflictDoUpdate({ target: tursoBoardMinutes.id, set: minutesDoneValues })

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

  // 펀딩 초안 캠페인. `status`·`submittedAt`·`reviewNote`를 매번 set에
  // 넣어 강제로 draft로 되돌린다 — "본인은 제출할 수 있다" 스펙이 이 캠페인을
  // submitted로 옮기므로, 그 값이 set에 없으면 시드를 다시 돌려도 draft로
  // 복구되지 않아 그 스펙이 원래 전제(캠페인이 초안이다)를 다시 만들지 못한다
  // (픽스처 글의 `isDeleted: false`와 같은 이유다).
  const fundingDraftCampaignValues = {
    id: FUNDING_DRAFT_CAMPAIGN_ID,
    slug: 'authz-e2e-funding-draft',
    ownerUserId: ids.owner,
    title: 'authz 픽스처 펀딩(초안)',
    summary: '권한 경계 테스트용 초안 캠페인',
    story: '',
    category: '기타',
    goalAmount: 1000000,
    status: 'draft',
    submittedAt: null,
    reviewNote: null,
  }
  await db
    .insert(tursoFundingCampaigns)
    .values(fundingDraftCampaignValues)
    .onConflictDoUpdate({ target: tursoFundingCampaigns.id, set: fundingDraftCampaignValues })

  const fundingDraftRewardValues = {
    id: FUNDING_DRAFT_REWARD_ID,
    campaignId: FUNDING_DRAFT_CAMPAIGN_ID,
    title: '얼리버드',
    description: '권한 경계 테스트용 리워드',
    amount: 10000,
    totalQuantity: null,
    requiresShipping: false,
    sortOrder: 0,
  }
  await db
    .insert(tursoFundingRewards)
    .values(fundingDraftRewardValues)
    .onConflictDoUpdate({ target: tursoFundingRewards.id, set: fundingDraftRewardValues })

  // 펀딩 심사 대기 캠페인 — 관리자 심사 경계(`GET /api/admin/funding/campaigns`·
  // `POST /api/admin/funding/campaigns/[id]/transition`) 전용. "관리자는
  // 반려할 수 있다" 스펙이 이 캠페인을 draft로 되돌리므로, 여기서도 status·
  // submittedAt·reviewNote를 강제로 submitted로 되돌린다.
  const fundingReviewCampaignValues = {
    id: FUNDING_REVIEW_CAMPAIGN_ID,
    slug: 'authz-e2e-funding-review',
    ownerUserId: ids.owner,
    title: 'authz 픽스처 펀딩(심사중)',
    summary: '관리자 심사 경계 테스트용 캠페인',
    story: '',
    category: '기타',
    goalAmount: 500000,
    status: 'submitted',
    submittedAt: new Date('2026-09-01T00:00:00.000Z'),
    reviewNote: null,
  }
  await db
    .insert(tursoFundingCampaigns)
    .values(fundingReviewCampaignValues)
    .onConflictDoUpdate({ target: tursoFundingCampaigns.id, set: fundingReviewCampaignValues })

  const fundingReviewRewardValues = {
    id: FUNDING_REVIEW_REWARD_ID,
    campaignId: FUNDING_REVIEW_CAMPAIGN_ID,
    title: '얼리버드',
    description: '관리자 심사 경계 테스트용 리워드',
    amount: 20000,
    totalQuantity: null,
    requiresShipping: false,
    sortOrder: 0,
  }
  await db
    .insert(tursoFundingRewards)
    .values(fundingReviewRewardValues)
    .onConflictDoUpdate({ target: tursoFundingRewards.id, set: fundingReviewRewardValues })

  // 관리자 전용 동작 경계용 캠페인 셋. 위 두 캠페인과 같은 이유로
  // `status`·`submittedAt`·`reviewNote`·`approvedAt`·`settledAt`을 매번 set에
  // 넣어 시작 상태로 되돌린다 — 짝 단정의 허용 쪽이 상태를 옮기기 때문이다.
  const adminActionCampaigns = [
    {
      id: FUNDING_APPROVE_CAMPAIGN_ID,
      rewardId: FUNDING_APPROVE_REWARD_ID,
      slug: 'authz-e2e-funding-approve',
      title: 'authz 픽스처 펀딩(승인 경계)',
      summary: '관리자 전용 동작 approve 경계 테스트용 캠페인',
      status: 'submitted',
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      closedAt: null,
    },
    {
      id: FUNDING_REJECT_CAMPAIGN_ID,
      rewardId: FUNDING_REJECT_REWARD_ID,
      slug: 'authz-e2e-funding-reject',
      title: 'authz 픽스처 펀딩(반려 경계)',
      summary: '관리자 전용 동작 reject 경계 테스트용 캠페인',
      status: 'submitted',
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      closedAt: null,
    },
    {
      id: FUNDING_SETTLE_CAMPAIGN_ID,
      rewardId: FUNDING_SETTLE_REWARD_ID,
      slug: 'authz-e2e-funding-settle',
      title: 'authz 픽스처 펀딩(정산 경계)',
      summary: '관리자 전용 동작 settle 경계 테스트용 캠페인',
      // settle은 `closed`에서만 전이표를 지난다.
      status: 'closed',
      submittedAt: new Date('2026-09-01T00:00:00.000Z'),
      closedAt: new Date('2026-09-02T00:00:00.000Z'),
    },
  ]
  for (const c of adminActionCampaigns) {
    const campaignValues = {
      id: c.id,
      slug: c.slug,
      ownerUserId: ids.owner,
      title: c.title,
      summary: c.summary,
      story: '',
      category: '기타',
      goalAmount: 500000,
      status: c.status,
      submittedAt: c.submittedAt,
      approvedAt: null,
      closedAt: c.closedAt,
      settledAt: null,
      reviewNote: null,
    }
    await db
      .insert(tursoFundingCampaigns)
      .values(campaignValues)
      .onConflictDoUpdate({ target: tursoFundingCampaigns.id, set: campaignValues })

    const rewardValues = {
      id: c.rewardId,
      campaignId: c.id,
      title: '얼리버드',
      description: '관리자 전용 동작 경계 테스트용 리워드',
      amount: 20000,
      totalQuantity: null,
      requiresShipping: false,
      sortOrder: 0,
    }
    await db
      .insert(tursoFundingRewards)
      .values(rewardValues)
      .onConflictDoUpdate({ target: tursoFundingRewards.id, set: rewardValues })
  }

  // 후원 취소 경계용 공개 캠페인과 후원 둘. 위 상수 선언부에 왜 이 모양인지
  // (후원자가 `owner`가 아닌 이유, `paymentId`를 비워 두는 이유) 적어 두었다.
  const fundingActiveCampaignValues = {
    id: FUNDING_ACTIVE_CAMPAIGN_ID,
    slug: 'authz-e2e-funding-active',
    ownerUserId: ids.owner,
    title: 'authz 픽스처 펀딩(공개중)',
    summary: '후원 취소 경계 테스트용 공개 캠페인',
    story: '',
    category: '기타',
    goalAmount: 300000,
    status: 'active',
    submittedAt: new Date('2026-09-01T00:00:00.000Z'),
    approvedAt: new Date('2026-09-02T00:00:00.000Z'),
    closedAt: null,
    settledAt: null,
    reviewNote: null,
  }
  await db
    .insert(tursoFundingCampaigns)
    .values(fundingActiveCampaignValues)
    .onConflictDoUpdate({ target: tursoFundingCampaigns.id, set: fundingActiveCampaignValues })

  const fundingActiveRewardValues = {
    id: FUNDING_ACTIVE_REWARD_ID,
    campaignId: FUNDING_ACTIVE_CAMPAIGN_ID,
    title: '응원 리워드',
    description: '후원 취소 경계 테스트용 리워드',
    amount: 15000,
    totalQuantity: null,
    // **배송 리워드다.** 개설자 화면(`ownerPledgeView`)은 배송 리워드에만
    // 배송지 묶음을 싣는다. 이 값이 false면 "개설자 화면에 후원자 이메일이
    // 없다"는 단정이 게이트 덕분인지 리워드가 배송이 아니어서인지 구분되지
    // 않는다 — 공허하게 통과한다. 같은 이유로 아래 후원 행에 배송지도 심는다.
    requiresShipping: true,
    // **결제가 붙은 리워드다.** 공개 상세가 리워드 행을 통째로 내보내지
    // 않는다는 단정은 표에 `locked_at`이 실제로 찍혀 있을 때만 의미가 있다 —
    // 비어 있으면 응답에 그 키가 없는 것이 게이트 덕분인지 값이 없어서인지
    // 구분되지 않는다.
    lockedAt: new Date('2026-09-02T00:00:00.000Z'),
    sortOrder: 0,
  }
  await db
    .insert(tursoFundingRewards)
    .values(fundingActiveRewardValues)
    .onConflictDoUpdate({ target: tursoFundingRewards.id, set: fundingActiveRewardValues })

  const pledgeRows = [
    {
      id: FUNDING_MEMBER_PLEDGE_ID,
      pledgeCode: FUNDING_MEMBER_PLEDGE_CODE,
      userId: ids.other,
      orderId: 'authz-e2e-funding-order-member',
      backerName: 'authz 회원 후원자',
      backerEmail: FUNDING_MEMBER_BACKER_EMAIL,
    },
    {
      id: FUNDING_GUEST_PLEDGE_ID,
      pledgeCode: FUNDING_GUEST_PLEDGE_CODE,
      userId: null,
      orderId: 'authz-e2e-funding-order-guest',
      backerName: 'authz 비회원 후원자',
      backerEmail: FUNDING_GUEST_BACKER_EMAIL,
    },
  ]
  for (const p of pledgeRows) {
    // status·fulfillmentStatus·paymentId를 매번 set에 넣어 되돌린다 — 취소
    // 경계가 회귀하면 스위트가 실제로 이 행을 canceled로 옮기고, 그 상태로는
    // 다음 실행이 원래 전제(결제가 끝난 후원이다)를 다시 만들지 못한다.
    const values = {
      id: p.id,
      pledgeCode: p.pledgeCode,
      campaignId: FUNDING_ACTIVE_CAMPAIGN_ID,
      rewardId: FUNDING_ACTIVE_REWARD_ID,
      userId: p.userId,
      orderId: p.orderId,
      paymentId: null,
      backerName: p.backerName,
      backerEmail: p.backerEmail,
      rewardTitle: '응원 리워드',
      unitAmount: 15000,
      quantity: 1,
      additionalAmount: 0,
      totalAmount: 15000,
      status: 'paid',
      holdExpiresAt: null,
      paidAt: new Date('2026-09-03T00:00:00.000Z'),
      canceledAt: null,
      refundedAt: null,
      fulfillmentStatus: 'none',
      entrySource: 'online',
      // 배송 리워드라 개설자 화면이 이 묶음을 싣는다. 택배를 부치는 데 필요한
      // 것은 여기까지다 — 이메일은 싣지 않는다(그 결정과 이유는 라우트 주석에).
      shippingName: p.backerName,
      shippingPhone: '010-0000-0000',
      shippingPostcode: '00000',
      shippingAddress1: '경기도 어딘가 1',
      shippingAddress2: '101호',
    }
    await db
      .insert(tursoFundingPledges)
      .values(values)
      .onConflictDoUpdate({ target: tursoFundingPledges.id, set: values })
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

  // system_settings: 미들웨어(`src/middleware/settings.ts`)가 읽는 두 행과
  // 기능 스위치들.
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
    // 펀딩 기능 스위치 — **로컬 테스트 DB에서만** 켠다. 운영 `system_settings`에는
    // `features/funding_features` 행 자체가 없어(2026-09-23 확인)
    // `scripts/turso/seed-funding-settings.mjs`가 `enabled: false`로 따로 심는다 —
    // 그 두 자리는 서로 다른 목적이라 값도 다르다. `isFundingEnabled()`가 꺼짐으로
    // 읽으면 마이페이지·관리자 쓰기 라우트가 인가 판정 전에 503을 던져
    // `e2e/authz-funding.spec.ts`의 모든 쓰기 경계 단정이 인가와 무관한 503으로
    // 가려진다 — 그래서 권한 E2E 전용으로 여기서 켠다.
    {
      id: FUNDING_SETTING_ID,
      category: 'features',
      settingKey: 'funding_features',
      settingValue: { enabled: true, platform_fee_rate_bp: 250, hold_minutes: 10 },
      description: 'authz E2E 픽스처',
      isSensitive: false,
    },
    // 기능 스위치 넷. 운영과 같은 값(전부 켜짐)으로 심는다 — 나머지 스펙이
    // 기대하는 상태가 그것이고, `e2e/authz-features.spec.ts`는 자기가 끈 뒤
    // 반드시 다시 켠다.
    {
      id: BOARD_FEATURE_SETTING_ID,
      category: 'features',
      settingKey: 'board_features',
      settingValue: {
        enabled: true,
        categories: ['공지', '잡담', '홍보', '건의'],
        allow_anonymous: false,
        moderation_enabled: true,
      },
      description: 'authz E2E 픽스처',
      isSensitive: false,
    },
    {
      id: ARTIST_FEATURE_SETTING_ID,
      category: 'features',
      settingKey: 'artist_features',
      settingValue: {
        registration_enabled: true,
        portfolio_upload: true,
        public_profile: true,
        collaboration_requests: true,
      },
      description: 'authz E2E 픽스처',
      isSensitive: false,
    },
    {
      id: COMMENT_FEATURE_SETTING_ID,
      category: 'features',
      settingKey: 'comment_features',
      settingValue: {
        enabled: true,
        nested_replies: true,
        max_depth: 3,
        moderation_enabled: true,
        allow_editing: true,
      },
      description: 'authz E2E 픽스처',
      isSensitive: false,
    },
    {
      id: FILE_UPLOAD_SETTING_ID,
      category: 'features',
      settingKey: 'file_upload',
      settingValue: {
        enabled: true,
        max_size_mb: 50,
        allowed_types: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'docx'],
        virus_scan: false,
      },
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
    boardMeetingDoneId: BOARD_MEETING_DONE_ID,
    boardAgendaId: BOARD_AGENDA_ID,
    boardCommentId: BOARD_COMMENT_ID,
    boardCommentDeletableId: BOARD_COMMENT_DELETABLE_ID,
    boardCommentByAdminId: BOARD_COMMENT_BY_ADMIN_ID,
    fundingDraftCampaignId: FUNDING_DRAFT_CAMPAIGN_ID,
    fundingDraftRewardId: FUNDING_DRAFT_REWARD_ID,
    fundingReviewCampaignId: FUNDING_REVIEW_CAMPAIGN_ID,
    fundingReviewRewardId: FUNDING_REVIEW_REWARD_ID,
    fundingApproveCampaignId: FUNDING_APPROVE_CAMPAIGN_ID,
    fundingApproveCampaignSlug: 'authz-e2e-funding-approve',
    fundingRejectCampaignId: FUNDING_REJECT_CAMPAIGN_ID,
    fundingSettleCampaignId: FUNDING_SETTLE_CAMPAIGN_ID,
    fundingActiveCampaignId: FUNDING_ACTIVE_CAMPAIGN_ID,
    fundingActiveCampaignSlug: 'authz-e2e-funding-active',
    fundingActiveRewardId: FUNDING_ACTIVE_REWARD_ID,
    fundingMemberPledgeId: FUNDING_MEMBER_PLEDGE_ID,
    fundingMemberPledgeCode: FUNDING_MEMBER_PLEDGE_CODE,
    fundingMemberBackerEmail: FUNDING_MEMBER_BACKER_EMAIL,
    fundingGuestPledgeId: FUNDING_GUEST_PLEDGE_ID,
    fundingGuestPledgeCode: FUNDING_GUEST_PLEDGE_CODE,
    fundingGuestBackerEmail: FUNDING_GUEST_BACKER_EMAIL,
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
      `이사회 회의 2(scheduled·completed)·회의록 2·안건 1·안건 의견 3, ` +
      `펀딩 캠페인 6(draft·submitted 3·closed·active)·리워드 6·후원 2(회원·비회원), ` +
      `system_settings ${settingRows.length}행, default_settings ${DEFAULT_SETTINGS.length}행 (전부 Turso)`
  )
}

await main()
