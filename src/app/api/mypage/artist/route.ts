import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createOptionsResponse } from '@/utils/apiResponse'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { invalidateArtistsCache } from '@/lib/data'
import {
  getArtistCoreRevalidationPaths,
  getProjectListRevalidationPaths,
  getProjectDetailRevalidationPaths,
} from '@/lib/revalidationPaths'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { isProjectStorageObjectPath } from '@/utils/storageUrlValidation'
import { logicalPathFromUrl } from '@/lib/storage/paths'
import { createLogger } from '@/utils/logger'
import { getProfileById } from '@/db/queries/profiles'
import { getArtistByLegacyId, updateArtistByLegacyId } from '@/db/queries/artists'
import { getProjects } from '@/lib/data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = createLogger('api/mypage/artist')

// 아티스트 업데이트 스키마 정의
const ArtistUpdateSchema = z.object({
  name: z
    .string()
    .min(1, '아티스트 이름은 필수입니다.')
    .max(100, '아티스트 이름은 100자 이내여야 합니다.'),
  category: z.array(z.string()).min(1, '최소 하나의 카테고리를 선택해주세요.'),
  one_liner: z
    .string()
    .min(1, '한 줄 소개는 필수입니다.')
    .max(100, '한 줄 소개는 100자 이내여야 합니다.'),
  bio: z
    .string()
    .min(1, '아티스트 소개는 필수입니다.')
    .max(5000, '아티스트 소개는 5000자 이내여야 합니다.'),
  template_type: z.enum(['미니멀형', '콜라주형']),
  profile_photo_url: z.string().nullable().optional(),
  profile_photo_metadata: z
    .object({
      original_filename: z.string().optional(),
      file_size: z.number().optional(),
      content_type: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      uploaded_at: z.string().optional(),
      processed: z.boolean().optional(),
      versions: z
        .object({
          thumbnail: z.string().optional(),
          medium: z.string().optional(),
          large: z.string().optional(),
        })
        .optional(),
      crop_info: z
        .object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        })
        .optional(),
      variants: z
        .object({
          original: z.string(),
          webp: z.string().optional(),
          fallback: z.string().optional(),
        })
        .optional(),
      variant_urls: z
        .object({
          original: z.string().optional(),
          webp: z.string().optional(),
          fallback: z.string().optional(),
        })
        .optional(),
      variant_metadata: z
        .object({
          original: z
            .object({
              size: z.number().optional(),
              content_type: z.string().optional(),
            })
            .optional(),
          webp: z
            .object({
              size: z.number().optional(),
              content_type: z.string().optional(),
            })
            .optional(),
          fallback: z
            .object({
              size: z.number().optional(),
              content_type: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .optional(),
  portfolio_links: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url('올바른 URL 형식을 입력해주세요.'),
      })
    )
    .optional(),
  youtube_videos: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url('올바른 YouTube URL을 입력해주세요.'),
      })
    )
    .optional(),
  contact: z.string().email('올바른 이메일 형식을 입력해주세요.').optional().or(z.literal('')),
})

// GET: 현재 사용자의 아티스트 정보 조회
export async function GET(request: NextRequest) {
  try {
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 사용자의 프로필 정보 조회 (아티스트 ID 확인). 프로필 권위는 Turso다.
    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      profile = await getProfileById(user.id)
    } catch (error) {
      console.error('Profile fetch error:', error)
      return ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.').toNextResponse()
    }
    if (!profile) {
      console.error('Profile fetch error: not found')
      return ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.').toNextResponse()
    }

    // 아티스트 권한 확인
    if (!profile.is_artist || !profile.artist_id) {
      return ApiError.forbidden('아티스트 권한이 없습니다.').toNextResponse()
    }

    // 아티스트 정보 조회. Task 4: artists 권위가 Turso로 옮겨졌다.
    let artist: Awaited<ReturnType<typeof getArtistByLegacyId>>
    try {
      artist = await getArtistByLegacyId(profile.artist_id)
    } catch (error) {
      console.error('Artist fetch error:', error)
      return ApiError.internalServerError('아티스트 정보를 조회할 수 없습니다.').toNextResponse()
    }
    if (!artist) {
      console.error('Artist fetch error: not found')
      return ApiError.internalServerError('아티스트 정보를 조회할 수 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok({ artist }).toNextResponse()
  } catch (error) {
    console.error('Artist GET error:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

// PATCH: 아티스트 정보 업데이트
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    // 요청 데이터 파싱 및 검증
    const body = await parseJsonObjectBody(request)
    if (!body) {
      return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    }

    const validationResult = ArtistUpdateSchema.safeParse(body)
    if (!validationResult.success) {
      return ApiError.badRequest('입력 데이터가 올바르지 않습니다.').toNextResponse()
    }

    const updateData = validationResult.data

    // 사용자의 프로필 정보 조회 (아티스트 ID 확인). 프로필 권위는 Turso다.
    let profile: Awaited<ReturnType<typeof getProfileById>>
    try {
      profile = await getProfileById(user.id)
    } catch (error) {
      console.error('Profile fetch error:', error)
      return ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.').toNextResponse()
    }
    if (!profile) {
      console.error('Profile fetch error: not found')
      return ApiError.internalServerError('프로필 정보를 조회할 수 없습니다.').toNextResponse()
    }

    // 아티스트 권한 확인
    if (!profile.is_artist || !profile.artist_id) {
      return ApiError.forbidden('아티스트 권한이 없습니다.').toNextResponse()
    }

    // 포트폴리오 링크 유효성 검사
    if (updateData.portfolio_links) {
      for (const link of updateData.portfolio_links) {
        if (link.url && !/^https?:\/\/.+/.test(link.url)) {
          return ApiError.badRequest(
            '포트폴리오 링크는 올바른 URL 형식이어야 합니다.'
          ).toNextResponse()
        }
      }
    }

    // 유튜브 동영상 유효성 검사
    if (updateData.youtube_videos) {
      for (const video of updateData.youtube_videos) {
        if (video.url && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/.test(video.url)) {
          return ApiError.badRequest(
            '유튜브 동영상은 올바른 YouTube URL이어야 합니다.'
          ).toNextResponse()
        }
      }
    }

    if (
      updateData.profile_photo_url &&
      logicalPathFromUrl(updateData.profile_photo_url, 'artists', profile.artist_id) === null
    ) {
      return ApiError.badRequest(
        '프로필 사진은 전용 업로드로 등록된 Storage URL이어야 합니다.'
      ).toNextResponse()
    }
    const photoVariants = updateData.profile_photo_metadata?.variants
    const variantPaths = [photoVariants?.original, photoVariants?.webp, photoVariants?.fallback]
    if (
      variantPaths.some(
        variantPath =>
          typeof variantPath === 'string' &&
          !isProjectStorageObjectPath(variantPath, profile.artist_id)
      )
    ) {
      return ApiError.badRequest(
        '프로필 사진 메타데이터의 Storage 경로가 올바르지 않습니다.'
      ).toNextResponse()
    }
    const variantUrls = updateData.profile_photo_metadata?.variant_urls
    const variantPublicUrls = [variantUrls?.original, variantUrls?.webp, variantUrls?.fallback]
    if (
      variantPublicUrls.some(
        variantUrl =>
          typeof variantUrl === 'string' &&
          logicalPathFromUrl(variantUrl, 'artists', profile.artist_id) === null
      )
    ) {
      return ApiError.badRequest(
        '프로필 사진 메타데이터의 공개 URL이 올바르지 않습니다.'
      ).toNextResponse()
    }

    // 연락처 정리 (빈 문자열을 null로 변환)
    const contactValue = updateData.contact === '' ? null : updateData.contact

    // 이전엔 `.eq('id', user.id).eq('artist_id', profile.artist_id)`로 두
    // 조건을 DB에서 걸렀지만, getProfileById는 id 하나만 받으므로 조회 후
    // artist_id 일치를 코드에서 검사한다(동일한 최종 판정).
    let ownerCheck: Awaited<ReturnType<typeof getProfileById>>
    try {
      ownerCheck = await getProfileById(user.id)
    } catch (error) {
      console.error('Owner check fetch error:', error)
      ownerCheck = null
    }

    if (
      !ownerCheck ||
      ownerCheck.artist_id !== profile.artist_id ||
      !ownerCheck.is_artist ||
      !ownerCheck.is_active ||
      ownerCheck.registration_status !== 'approved'
    ) {
      return ApiError.forbidden('아티스트 권한이 없거나 비활성 상태입니다.').toNextResponse()
    }

    let updatedArtist: Awaited<ReturnType<typeof updateArtistByLegacyId>>
    try {
      updatedArtist = await updateArtistByLegacyId(profile.artist_id, {
        name: updateData.name,
        category: updateData.category,
        one_liner: updateData.one_liner,
        bio: updateData.bio,
        template_type: updateData.template_type,
        profile_photo_url: updateData.profile_photo_url,
        profile_photo_metadata: updateData.profile_photo_metadata,
        portfolio_links: updateData.portfolio_links || [],
        youtube_videos: updateData.youtube_videos || [],
        contact: contactValue,
      })
    } catch (error) {
      console.error('Artist update error:', error)
      return ApiError.internalServerError('아티스트 정보 업데이트에 실패했습니다.').toNextResponse()
    }
    if (!updatedArtist) {
      console.error('Artist update error: not found')
      return ApiError.internalServerError('아티스트 정보 업데이트에 실패했습니다.').toNextResponse()
    }

    // 🚀 즉시 캐시 무효화 - 웹사이트에 실시간 반영
    try {
      // 아티스트 슬러그는 위에서 이미 받은 updatedArtist에 들어 있다 —
      // 별도 재조회가 필요 없다(원본은 Supabase RLS 재확인 관례로 다시
      // 조회했지만, Turso는 그 관례가 필요 없다).
      const artistForSlug = updatedArtist

      if (artistForSlug?.slug) {
        // 관련된 모든 페이지의 캐시 무효화 (즉시 반영) — ko(내부 rewrite 경로
        // `/ko/...`)와 en(`/en/...`) 두 로케일 경로를 모두 무효화해야 한다.
        // revalidatePath는 렌더된 실제 경로에만 정확히 매칭되므로 로케일별로
        // 각각 호출이 필요하다. 자세한 배경은 @/lib/revalidationPaths 참고.
        for (const revalidationPath of getArtistCoreRevalidationPaths(artistForSlug.slug)) {
          revalidatePath(revalidationPath)
        }
        revalidateTag('artists') // 아티스트 관련 모든 캐시

        // 인메모리 캐시 강제 무효화 (즉시 최신 데이터 반영)
        invalidateArtistsCache()

        // 아티스트가 포함된 프로젝트 상세 페이지들도 함께 무효화.
        // 이전엔 여기서만 raw fs로 data/projects.json을 다시 읽었다(동적
        // `await import('fs')`까지 동원) — getProjects()를 우회해 en 폴백
        // 규칙도, 모듈 레벨 캐시(@/lib/data)도 적용받지 못했다. 로딩 경로를
        // getProjects() 하나로 합친다.
        try {
          const projects = await getProjects()
          const affected = projects.filter(
            p => Array.isArray(p.artistIds) && p.artistIds.includes(profile.artist_id)
          )
          for (const p of affected) {
            if (p?.slug) {
              for (const projectPath of getProjectDetailRevalidationPaths(p.slug)) {
                revalidatePath(projectPath)
              }
            }
          }
          // 목록 페이지도 함께
          for (const projectsListPath of getProjectListRevalidationPaths()) {
            revalidatePath(projectsListPath)
          }
        } catch (e) {
          console.warn('Projects revalidation skipped:', (e as any)?.message || e)
        }

        log.debug('Successfully invalidated artist caches', { slug: artistForSlug.slug })
      }
    } catch (cacheError) {
      console.error('Cache invalidation error (non-blocking):', cacheError)
    }

    return ApiSuccess.ok(
      { artist: updatedArtist },
      '아티스트 정보가 성공적으로 업데이트되었습니다. 웹사이트에 즉시 반영됩니다.'
    ).toNextResponse()
  } catch (error) {
    console.error('Artist PATCH error:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
