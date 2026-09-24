/**
 * 캠페인 표지 이미지 업로드 — `POST /api/mypage/funding/campaigns/[id]/cover`.
 *
 * **왜 범용 업로드에서 떼어냈나.** 표지는 예전에 `POST /api/media/upload`로
 * 갔다. 그 주소는 관리자 화면의 **파일 업로드 스위치**가 다스린다. 그래서
 * 게시판이 시끄러워 업로드를 잠깐 내리면, 아무 상관 없는 펀딩 편집기의 표지
 * 선택도 함께 멈췄다 — 스위치 설명에 "펀딩을 여는 동안에는 켜 두세요"라는
 * 단서를 달아 두는 것으로 버티고 있었다. 단서는 설계가 아니다. 표지는 **한
 * 캠페인에 딸린 한 장**이므로 그 캠페인의 라우트가 받고, 펀딩 스위치가
 * 다스린다.
 *
 * 그래서 두 스위치가 이 주소에 하는 일이 이렇게 갈린다.
 *
 * - **펀딩 스위치 꺼짐** → 503. 펀딩 전체가 닫혀 있으니 표지도 올라가지 않는다.
 * - **파일 업로드 스위치 꺼짐** → 아무 일도 없다. 표지는 계속 올라간다.
 *
 * **이 라우트는 범용 구멍이 아니다.** 받는 것은 이미지 한 장이고, 그 캠페인을
 * 다룰 수 있는 사람만, 아직 내용을 고칠 수 있는 상태에서만 된다. 검사 자체
 * (허용 타입·크기 상한·매직 바이트·변형 생성·경로 규칙)는 `media/upload`와
 * **같은 구현**(`@/lib/storage/imageUpload`)을 부른다 — 베껴 오면 한쪽만
 * 고쳐지는 날이 온다.
 *
 * **없는 캠페인과 남의 캠페인에 같은 답을 준다**(404). 다른 펀딩 라우트와 같은
 * 규칙이다 — 답이 갈리면 id를 훑어 "그 캠페인이 있다"를 알아낼 수 있다.
 *
 * **저장만 하고 반영은 하지 않는다.** 돌려주는 것은 URL 하나이고, 그것을
 * `cover_image`에 넣는 것은 편집기의 저장(PATCH)이다. PATCH는 이미지 주소가
 * 이 사이트 저장소의 것인지 오리진으로 대조하므로(`isBlobPublicUrl`), 여기서
 * 돌려주는 Blob 공개 URL이 그 검사를 그대로 통과한다.
 */
import { NextRequest, NextResponse } from 'next/server'

import { getCampaignById } from '@/db/queries/funding'
import { recordUpload } from '@/db/queries/uploads'
import { isFundingEnabled } from '@/lib/funding/settings'
import { editScope, type CampaignStatus } from '@/lib/funding/transitions'
import { canManageCampaign } from '@/lib/server/fundingAuth'
import { requireActiveMember } from '@/lib/server/memberAuth'
import { applyRouteRateLimit, createIPKeyGenerator } from '@/lib/server/rateLimit'
import { hasPublicBlobStore } from '@/lib/storage/blob'
import {
  buildStoragePaths,
  checkMagicBytes,
  uploadImageWithVariants,
  validateUploadFile,
  IMAGE_ONLY_TYPES,
} from '@/lib/storage/imageUpload'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/mypage/funding/cover')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** 표지 한 장에 필요한 만큼. 이미지만 받고, 아티스트 사진과 같은 5MB 상한이다. */
const COVER_LIMITS = {
  allowed_types: IMAGE_ONLY_TYPES,
  max_file_size: 5 * 1024 * 1024,
}

/** 공개 첨부와 같은 저장소를 쓰되, 경로는 **캠페인 밑**이다(임자가 경로에 보인다). */
const COVER_BUCKET = 'attachments'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 펀딩 스위치를 인증보다 먼저 본다 — 다른 펀딩 쓰기 라우트와 같은 순서다.
    if ((await isFundingEnabled()) === false)
      return ApiError.serviceUnavailable('펀딩을 준비 중입니다.').toNextResponse()

    // 빈도 제한. 범용 업로드 라우트의 보호는 주소가 달라지면 따라오지 않는다.
    //
    // 상한을 **시간당 20회**로 잡는다. 이 화면에서 정상적으로 일어나는 일은
    // "표지 한 장을 고른다"이고, 마음에 안 들어 몇 번 바꿔 보는 것까지 세도 한
    // 자리 수다. 20회면 그 여유를 다 덮으면서도, 자동화된 반복 업로드가
    // 저장소를 채우는 것은 막는다. 창이 분이 아니라 시간인 이유는 값비싼 것이
    // 순간 부하가 아니라 **쌓이는 Blob 객체**여서다(한 번에 원본·WebP·폴백 셋이
    // 올라간다). 키는 IP다 — 레이트리밋은 인증보다 먼저 돌아 그 시점에 신원이
    // 없고, 클라이언트가 바꿀 수 없는 축은 IP뿐이다(다른 펀딩 라우트와 같다).
    const rl = await applyRouteRateLimit(request, {
      name: 'funding_cover_upload',
      windowMs: 60 * 60 * 1000,
      maxRequests: 20,
      message: '표지 이미지 업로드가 너무 잦습니다. 잠시 후 다시 시도해 주세요.',
      keyGenerator: createIPKeyGenerator('funding-cover-upload'),
    })
    if (!rl.success && rl.response?.status === 429) return rl.response

    const auth = await requireActiveMember()
    if (auth instanceof NextResponse) return auth
    const { id } = await params

    const campaign = await getCampaignById(id)
    if (
      !campaign ||
      !canManageCampaign(auth.profile, auth.user.id, campaign as { owner_user_id: string | null })
    ) {
      return ApiError.notFound('프로젝트를 찾을 수 없습니다.').toNextResponse()
    }

    // 표지는 내용 필드다 — 공개된 뒤(`active`)에도 바꿀 수 있고, 마감·정산
    // 뒤에는 잠긴다. 판정은 편집 범위 표(`editScope`)가 한다.
    if (editScope(campaign.status as CampaignStatus) === 'none')
      return ApiError.badRequest('지금 상태에서는 표지 이미지를 바꿀 수 없습니다.').toNextResponse()

    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return ApiError.badRequest('표지 이미지를 선택해 주세요.').toNextResponse()
    }

    const validation = validateUploadFile(file, COVER_LIMITS)
    if (validation.valid === false) {
      return ApiError.badRequest(validation.error).toNextResponse()
    }

    if (!hasPublicBlobStore()) {
      log.error('PUBLIC_BLOB_READ_WRITE_TOKEN 미설정 (FUNDING COVER)')
      return ApiError.serviceUnavailable(
        '이미지 저장소를 사용할 수 없습니다. 사무국(contact@ggac.kr)으로 문의해 주세요.'
      ).toNextResponse()
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    // 확장자와 헤더는 거짓말을 할 수 있다. 내용 선두 바이트를 대조한다.
    if (!checkMagicBytes(fileBuffer, file.type)) {
      return ApiError.badRequest(
        '파일 내용이 이미지가 아닙니다. 다른 파일을 선택해 주세요.'
      ).toNextResponse()
    }

    const paths = buildStoragePaths(`funding/${id}`, auth.user.id, file.name)

    let uploaded
    try {
      uploaded = await uploadImageWithVariants(COVER_BUCKET, paths, fileBuffer, file.type)
    } catch (error) {
      log.error('표지 이미지 업로드 실패', { campaignId: id, error })
      return ApiError.internalServerError(
        '표지 이미지를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.'
      ).toNextResponse()
    }

    const publicUrl = uploaded.webp?.url || uploaded.original.url
    const primaryPath = uploaded.webp?.path || uploaded.original.path

    // 업로드 원장. 저장은 됐는데 캠페인에 반영되지 않은 이미지(고르고 저장하지
    // 않은 경우)는 이 기록이 없으면 추적할 수단이 없는 고아가 된다. 기록에
    // 실패해도 업로드는 성공으로 돌려준다 — media/upload와 같은 판단이다.
    if (publicUrl) {
      try {
        await recordUpload({
          user_id: auth.user.id,
          bucket: COVER_BUCKET,
          path: primaryPath,
          url: publicUrl,
          mime_type: uploaded.webp?.contentType || uploaded.original.contentType,
          size_bytes: uploaded.webp?.size ?? uploaded.original.size,
        })
      } catch (error) {
        log.error('업로드 원장 기록 실패(고아 파일이 될 수 있음)', { path: primaryPath, error })
      }
    }

    return ApiSuccess.created({
      public_url: publicUrl,
      path: primaryPath,
      variants: {
        original: uploaded.original.path,
        webp: uploaded.webp?.path,
        fallback: uploaded.fallback?.path,
      },
      variant_urls: {
        original: uploaded.original.url,
        webp: uploaded.webp?.url,
        fallback: uploaded.fallback?.url,
      },
    }).toNextResponse()
  } catch (error) {
    log.error('표지 이미지 라우트 오류', error)
    return ApiError.internalServerError(
      '표지 이미지를 올리지 못했습니다. 잠시 후 다시 시도해 주세요.'
    ).toNextResponse()
  }
}
