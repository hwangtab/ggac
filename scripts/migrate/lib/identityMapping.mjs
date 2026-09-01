import { pgTimestampToMs, pgArrayToJsonText } from './pgDumpParser.mjs'

/**
 * SQLite에는 불리언 타입이 없다. Drizzle의 mode:'boolean'도 0/1을 읽는다.
 *
 * 알려진 토큰 밖이면 조용히 0으로 떨어뜨리지 않고 던진다(contentMapping.mjs의
 * toBool과 같은 이유·같은 형태) — 예전에는 `'true'|'t'|'1'` 밖의 모든 값이
 * 전부 0으로 떨어졌다. `artists.is_active`가 이 함수를 거치므로, 덤프 표기가
 * 바뀌어 여기서 침묵하면 아티스트 13명 전원이 `is_active=0`이 되어 공개
 * 사이트에서 사라지는데 검증은 매핑 결과 자체와 대조하므로 통과해버린다.
 */
function bool(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value === 'true' || value === 't' || value === '1' || value === 1) return 1
  if (value === 'false' || value === 'f' || value === '0' || value === 0) return 0
  throw new Error(`boolean으로 해석할 수 없다: ${JSON.stringify(value)}`)
}

/** JSON 컬럼(mode:'json')은 텍스트에 직렬화된 형태로 저장된다. */
function json(value, fallback) {
  if (value === null || value === undefined) {
    return fallback === undefined ? null : JSON.stringify(fallback)
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function int(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`정수가 아니다: ${value}`)
  return n
}

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

/**
 * 매핑이 일부러 비워두는 컬럼.
 * 로더의 런타임 게이트가 PRAGMA 결과와 매핑 키를 대조할 때, 여기 없는
 * 미매핑 컬럼을 발견하면 중단한다. 새 컬럼이 스키마에 생기면 이 목록에
 * 적거나 매핑에 추가해야만 이관이 통과한다.
 */
export const INTENTIONALLY_DEFAULTED = {
  // Better Auth가 OAuth·토큰 갱신에만 쓰는 컬럼들. email/password 계정에는
  // 값이 없다(실측: auth.identities 19행 전원 provider='email').
  account: [
    'access_token',
    'refresh_token',
    'id_token',
    'access_token_expires_at',
    'refresh_token_expires_at',
    'scope',
  ],
  user: [],
  member_profiles: [],
  artists: [],
}

/** artists 13행. 컬럼 20개를 하나도 빠짐없이 명시한다(스프레드 금지). */
export function toArtistRow(a) {
  return {
    id: a.id,
    legacy_id: a.legacy_id,
    slug: a.slug,
    name: a.name,
    // Postgres text[] 컬럼. PostgREST 경로(identity.mjs)는 진짜 배열을
    // 주지만, 덤프 경로(stage4.mjs가 이 함수를 재사용)는 `{연주자,창작자}`
    // 형태의 배열 리터럴 문자열을 준다. json()의 typeof==='string' 그대로
    // 통과 규칙에 걸리면 그 문자열이 파싱 불가능한 값으로 그대로 저장돼
    // 읽는 쪽 JSON.parse가 던진다 — pgArrayToJsonText가 두 소스 모두
    // 안전하게 처리한다.
    category: pgArrayToJsonText(a.category),
    one_liner: a.one_liner,
    bio: a.bio,
    template_type: a.template_type,
    // Turso 스키마가 notNull().default([]) — 운영에 NULL이 1건 있어 정규화한다.
    portfolio_links: json(a.portfolio_links, []),
    youtube_videos: json(a.youtube_videos, []),
    contact: a.contact,
    created_at: pgTimestampToMs(a.created_at),
    updated_at: pgTimestampToMs(a.updated_at),
    profile_photo_url: a.profile_photo_url,
    profile_photo_metadata: json(a.profile_photo_metadata),
    is_active: bool(a.is_active),
    name_en: a.name_en,
    one_liner_en: a.one_liner_en,
    bio_en: a.bio_en,
    template_type_en: a.template_type_en,
  }
}

/**
 * Better Auth `user` 테이블.
 * id는 Supabase UUID를 그대로 쓴다 — 전 테이블의 user_id 참조가 수정 없이
 * 유효해야 하기 때문이다(스펙 5절).
 */
export function toUserRow(profile, authUser) {
  return {
    id: profile.id,
    name: profile.display_name,
    email: profile.email,
    email_verified: authUser.email_confirmed_at ? 1 : 0,
    image: null,
    created_at: pgTimestampToMs(authUser.created_at),
    updated_at: pgTimestampToMs(authUser.updated_at),
  }
}

/**
 * Better Auth `account` 테이블 — 비밀번호가 사는 곳.
 *
 * id·account_id를 사용자 UUID로 고정해 재실행이 같은 행을 덮게 만든다
 * (랜덤 id를 쓰면 --apply를 두 번 돌릴 때 계정이 두 개가 된다).
 * 해시는 bcrypt 그대로 저장한다 — `src/lib/auth/password.ts`의
 * verifyPassword가 `$2[aby]$` 접두를 보고 bcrypt.compare로 검증한다.
 */
export function toAccountRow(authUser) {
  const password = authUser.encrypted_password
  if (!password || !BCRYPT_RE.test(password)) {
    // 조용히 통과시키면 그 조합원은 영원히 로그인하지 못한다.
    throw new Error(`bcrypt 해시가 아니다 (user=${authUser.id})`)
  }
  return {
    id: authUser.id,
    account_id: authUser.id,
    provider_id: 'credential',
    user_id: authUser.id,
    password,
    created_at: pgTimestampToMs(authUser.created_at),
    updated_at: pgTimestampToMs(authUser.updated_at),
  }
}

/** member_profiles 19행. 컬럼 35개를 하나도 빠짐없이 명시한다. */
export function toMemberProfileRow(p) {
  return {
    id: p.id,
    display_name: p.display_name,
    email: p.email,
    phone_number: p.phone_number,
    // date 전용 컬럼 — 'YYYY-MM-DD' 문자열 그대로. 밀리초로 바꾸면
    // 타임존 해석이 끼어들어 생일이 하루 밀린다.
    birth_date: p.birth_date,
    real_name: p.real_name,
    monthly_fee: int(p.monthly_fee),
    bank_name: p.bank_name,
    account_number: p.account_number,
    account_holder: p.account_holder,
    registration_status: p.registration_status,
    is_active: bool(p.is_active),
    is_admin: bool(p.is_admin),
    created_at: pgTimestampToMs(p.created_at),
    updated_at: pgTimestampToMs(p.updated_at),
    approved_at: pgTimestampToMs(p.approved_at),
    approved_by: p.approved_by,
    last_login_at: pgTimestampToMs(p.last_login_at),
    rejected_by: p.rejected_by,
    suspension_reason: p.suspension_reason,
    suspension_until: pgTimestampToMs(p.suspension_until),
    is_suspended: bool(p.is_suspended),
    profile_completeness_score: int(p.profile_completeness_score),
    verification_status: json(p.verification_status),
    membership_type: p.membership_type,
    engagement_score: int(p.engagement_score),
    is_member: bool(p.is_member),
    // 운영 실측: 이 값은 artists.id(UUID)가 아니라 artists.legacy_id
    // ('artist-014')다. 15건 중 3건은 대상이 없다. 읽는 코드가 문자열을
    // 그대로 화면에 찍기만 하므로 UUID로 고쳐 쓰지 않고 원문을 옮긴다.
    artist_id: p.artist_id,
    is_artist: bool(p.is_artist),
    artist_role: p.artist_role,
    is_director: bool(p.is_director),
    director_title: p.director_title,
    is_auditor: bool(p.is_auditor),
    // 컷오버 후(단계 4 Task 2 — member-calendar) 추가된 컬럼이라 Supabase
    // 덤프에는 대응 값이 없다(p.interest_genres는 항상 undefined). Turso
    // 스키마의 NOT NULL DEFAULT '[]'와 같은 의미로 json()이 빈 배열을 채운다
    // — artists.portfolio_links와 같은 패턴.
    interest_genres: json(p.interest_genres, []),
    interest_regions: json(p.interest_regions, []),
    // 0010에서 신설된 컬럼. 이관 대상 Supabase 데이터에는 애초에 없던 값이고,
    // 이관 시점(탈퇴 기능 이전)엔 탈퇴자가 있을 수 없으므로 NULL이 맞다.
    withdrawn_at: null,
    // 0011에서 신설된 컬럼. 같은 이유로 NULL — 이관 시점엔 탈퇴 "신청"
    // 개념 자체가 없었다.
    withdrawal_requested_at: null,
  }
}
