/**
 * `artists` 쿼리 계층 (Turso/Drizzle). 단계 4 Task 4.
 *
 * 이 모듈은 **권한을 모른다.** 인증·인가 판정을 하지 않고, `NextResponse`를
 * 만들지 않고, `next/headers`를 임포트하지 않는다. 권한 판정(본인 아티스트
 * 소유 확인, 관리자 여부)은 호출부(`src/lib/data.ts`, `src/app/api/mypage/
 * artist/*`, `src/app/api/admin/artists/*`)의 몫이다.
 *
 * 응답 형태는 snake_case다(CLAUDE.md — strict: false라 키가 바뀌어도 타입
 * 검사가 못 잡고 화면이 조용히 빈다). `src/types/artist.ts`의
 * `DatabaseArtist`와 필드명이 정확히 일치한다.
 *
 * `category`는 Postgres에서 `text[]`였고 Turso 스키마(`src/db/schema/
 * identity.ts`)는 `mode:'json'`으로 JSON 배열을 저장한다 — Drizzle이
 * 직렬화/역직렬화를 알아서 하므로 이 모듈에서 추가 변환은 필요 없지만,
 * 값이 `null`일 수 있다(컬럼이 NOT NULL이 아니다). 호출부(`src/lib/data.ts`의
 * `convertDatabaseArtistToArtist`)가 이미 `dbArtist.category || []`로
 * null을 방어한다 — 그 계약을 그대로 유지한다.
 *
 * `legacy_id`가 이 테이블의 두 번째 자연키다. `member_profiles.artist_id`와
 * 이사회/관리자 라우트 다수가 `id`(uuid)가 아니라 `legacy_id`(예:
 * 'artist-015')로 조회한다 — Postgres 시절부터의 관례를 그대로 유지한다.
 */

import { and, asc, eq } from 'drizzle-orm'

import { db } from '../client.ts'
import { artists } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export interface ArtistRow {
  id: string
  legacy_id: string
  slug: string
  name: string
  category: string[] | null
  one_liner: string | null
  bio: string | null
  template_type: string | null
  portfolio_links: unknown[]
  youtube_videos: unknown[]
  contact: string | null
  created_at: string
  updated_at: string
  profile_photo_url: string | null
  profile_photo_metadata: Record<string, unknown>
  is_active: boolean
  name_en: string | null
  one_liner_en: string | null
  bio_en: string | null
  template_type_en: string | null
}

function rowToArtist(row: typeof artists.$inferSelect): ArtistRow {
  return {
    id: row.id,
    legacy_id: row.legacyId,
    slug: row.slug,
    name: row.name,
    category: row.category,
    one_liner: row.oneLiner,
    bio: row.bio,
    template_type: row.templateType,
    portfolio_links: row.portfolioLinks,
    youtube_videos: row.youtubeVideos,
    contact: row.contact,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
    profile_photo_url: row.profilePhotoUrl,
    profile_photo_metadata: row.profilePhotoMetadata,
    is_active: row.isActive,
    name_en: row.nameEn,
    one_liner_en: row.oneLinerEn,
    bio_en: row.bioEn,
    template_type_en: row.templateTypeEn,
  }
}

/**
 * 전체 아티스트 목록. `src/lib/data.ts`의 `getArtistsFromDB`가 이전엔
 * Supabase `.select('*').order('created_at', {ascending:true})`로 조회하던
 * 것을 대체한다 — 정렬 방향(created_at 오름차순)을 그대로 유지한다.
 *
 * **기본은 `is_active=1`만 낸다.** 공개 페이지가 소비하는 함수라 — 탈퇴
 * 확정 시 `withdrawMember`(`src/db/queries/withdrawal.ts`)가 대상 아티스트
 * 행을 `is_active=0`으로 내리는데, 여기서 그 값을 안 보면 개인정보만 지워진
 * 빈 행이 여전히 공개 목록·상세 페이지에 남는다. 관리자 화면처럼 비활성
 * 행도 봐야 하는 소비처는 `{ activeOnly: false }`를 명시한다
 * (`src/app/api/admin/artists/route.ts`가 쓴다).
 */
export async function listArtists(options: { activeOnly?: boolean } = {}): Promise<ArtistRow[]> {
  const { activeOnly = true } = options
  const rows = await db
    .select()
    .from(artists)
    .where(activeOnly ? eq(artists.isActive, true) : undefined)
    .orderBy(asc(artists.createdAt))
  return rows.map(rowToArtist)
}

/**
 * `slug`로 단건 조회. `src/lib/data.ts`의 `getArtistBySlugFromDB` 대체.
 *
 * `listArtists`와 같은 이유로 기본은 `is_active=1`만 낸다 — 유일한 호출부
 * (`src/app/[locale]/artists/[slug]/page.tsx`)는 공개 상세 페이지이므로,
 * 탈퇴로 비활성화된 아티스트는 "없는 아티스트"(notFound)로 처리돼야 한다.
 */
export async function getArtistBySlug(
  slug: string,
  options: { activeOnly?: boolean } = {}
): Promise<ArtistRow | null> {
  const { activeOnly = true } = options
  const [row] = await db
    .select()
    .from(artists)
    .where(and(eq(artists.slug, slug), activeOnly ? eq(artists.isActive, true) : undefined))
    .limit(1)
  return row ? rowToArtist(row) : null
}

/**
 * `legacy_id`로 단건 조회(전체 컬럼). `src/app/api/mypage/artist/route.ts`
 * GET, `src/app/api/admin/artists/[id]/members/route.ts`의 존재 확인이
 * 쓴다.
 */
export async function getArtistByLegacyId(legacyId: string): Promise<ArtistRow | null> {
  const [row] = await db.select().from(artists).where(eq(artists.legacyId, legacyId)).limit(1)
  return row ? rowToArtist(row) : null
}

export interface ArtistPhotoInfo {
  profile_photo_url: string | null
  profile_photo_metadata: Record<string, unknown>
  slug: string
}

/**
 * `legacy_id`로 사진 관련 컬럼만 조회. `src/app/api/mypage/artist/photo/
 * route.ts`의 PUT/DELETE/GET이 쓰던 `select('profile_photo_url,
 * profile_photo_metadata, slug')` 대체. Turso는 RLS가 없으므로 이전의
 * "일반 클라이언트로 먼저 시도 → 비면 service-role로 재시도" 이중 경로가
 * 필요 없다(단일 조회로 충분 — PUT 라우트의 다른 조회들에 이미 적용된
 * 근거와 동일).
 */
export async function getArtistPhotoInfoByLegacyId(
  legacyId: string
): Promise<ArtistPhotoInfo | null> {
  const [row] = await db
    .select({
      profilePhotoUrl: artists.profilePhotoUrl,
      profilePhotoMetadata: artists.profilePhotoMetadata,
      slug: artists.slug,
    })
    .from(artists)
    .where(eq(artists.legacyId, legacyId))
    .limit(1)
  if (!row) return null
  return {
    profile_photo_url: row.profilePhotoUrl,
    profile_photo_metadata: row.profilePhotoMetadata,
    slug: row.slug,
  }
}

export interface ArtistUpdatePatch {
  name?: string
  category?: string[]
  one_liner?: string
  bio?: string
  template_type?: string
  profile_photo_url?: string | null
  profile_photo_metadata?: Record<string, unknown> | null
  portfolio_links?: unknown[]
  youtube_videos?: unknown[]
  contact?: string | null
}

/**
 * `legacy_id`로 갱신 후 전체 행을 돌려준다. `src/app/api/mypage/artist/
 * route.ts` PATCH의 `.update({...}).eq('legacy_id', ...).select().single()`
 * 대체. `updated_at`은 스키마의 `updatedAt()`이 `$onUpdate`로 자동 채운다
 * (Postgres에는 이 자동 갱신을 위한 트리거가 없었다 — 앱이 매번
 * `updated_at: new Date().toISOString()`을 직접 실어 보냈다; Drizzle
 * `$onUpdate`가 같은 결과를 만든다).
 * @returns 대상이 없으면 `null`(원본의 `.single()` 오류 대신 — 호출부가
 * 스스로 확인한 `profile.artist_id`를 쓰므로 실무에서는 항상 존재한다).
 */
export async function updateArtistByLegacyId(
  legacyId: string,
  patch: ArtistUpdatePatch
): Promise<ArtistRow | null> {
  const values: Partial<typeof artists.$inferInsert> = {}
  if (patch.name !== undefined) values.name = patch.name
  if (patch.category !== undefined) values.category = patch.category
  if (patch.one_liner !== undefined) values.oneLiner = patch.one_liner
  if (patch.bio !== undefined) values.bio = patch.bio
  if (patch.template_type !== undefined) values.templateType = patch.template_type
  if (patch.profile_photo_url !== undefined) values.profilePhotoUrl = patch.profile_photo_url
  if (patch.profile_photo_metadata !== undefined) {
    values.profilePhotoMetadata = patch.profile_photo_metadata ?? {}
  }
  if (patch.portfolio_links !== undefined) values.portfolioLinks = patch.portfolio_links
  if (patch.youtube_videos !== undefined) values.youtubeVideos = patch.youtube_videos
  if (patch.contact !== undefined) values.contact = patch.contact

  const [row] = await db
    .update(artists)
    .set(values)
    .where(eq(artists.legacyId, legacyId))
    .returning()

  return row ? rowToArtist(row) : null
}
