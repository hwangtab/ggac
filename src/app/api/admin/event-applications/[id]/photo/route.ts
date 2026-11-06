/**
 * 행사·워크숍 신청 사진 — 관리자 전용 스트리밍(2026-11-06 사각지대 점검).
 *
 * 신청 사진은 개인정보다. 예전에는 공개 Blob 저장소에 올려 그 URL 을 관리자 화면이 그대로 썼는데,
 * 주소를 아는 사람은 누구나 열 수 있고 지우는 장치도 없었다. 지금은 **제출 시점에 비공개 저장소로**
 * 옮기고(`src/lib/eventApplications/photo.ts`) 이 라우트로만 읽는다.
 *
 * 인증: 관리자만(`requireAdmin`). 캐시 금지 · nosniff · inline(이미지 미리보기).
 * 옛 행은 저장값이 공개 URL 이라 여기서 다루지 않는다 — 관리자 화면이 그 URL 을 그대로 쓴다.
 */
import { NextResponse } from 'next/server'

import { requireAdmin } from '@/lib/server/adminAuth'
import { getPrivateObject } from '@/lib/storage/blob'
import { getEventApplicationPhotoRef } from '@/db/queries/misc'
import { isPrivateEventPhotoRef } from '@/lib/eventApplications/photo'
import { isUuid } from '@/lib/server/memberDocumentsRoute'
import { ApiError } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!isUuid(id)) return ApiError.notFound('신청 사진을 찾을 수 없습니다.').toNextResponse()

  const ref = await getEventApplicationPhotoRef(id)
  if (!ref || !isPrivateEventPhotoRef(ref)) {
    return ApiError.notFound('신청 사진을 찾을 수 없습니다.').toNextResponse()
  }

  const object = await getPrivateObject(ref)
  if (!object) return ApiError.notFound('신청 사진을 찾을 수 없습니다.').toNextResponse()

  return new NextResponse(object.stream, {
    status: object.statusCode === 206 ? 206 : 200,
    headers: {
      'Content-Type': object.contentType || 'application/octet-stream',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  })
}
