/**
 * 행사·워크숍 신청 사진 — **공개 저장소에 영구 보관하지 않는다**.
 *
 * 왜: 신청 사진은 신청자의 얼굴·작업물이 담긴 개인정보인데, 2026-11-06 점검 당시
 * 업로드 라우트(`/api/event-applications/photo`)가 공개 Blob 저장소에 그대로 올리고
 * 그 URL 을 신청 행에 저장했다. URL 이 추측 불가능해도 **영구히 공개**이고, 지우는
 * 장치도 없었다(관리자 화면에서만 보이지만 주소를 아는 사람은 누구나 열 수 있다).
 *
 * 지금: 신청 폼은 작성 중 미리보기를 위해 공개 저장소에 임시로 올리고(그 순간만),
 * **제출할 때 이 모듈이 비공개 저장소로 옮긴 뒤 공개 사본을 지운다.** 행에는 공개 URL
 * 대신 비공개 경로(`event-applications/<slug>/<file>`)를 남기고, 관리자 화면은
 * 인증된 스트리밍 라우트(`/api/admin/event-applications/<id>/photo`)로 읽는다.
 *
 * 폼을 채우다 만 업로드는 제출되지 않으므로 공개 저장소에 남는다 — 그 정리는
 * 업로드 정리 크론의 몫이고, 이 모듈은 "제출된 것은 공개로 남기지 않는다"만 책임진다.
 */
import { deleteObject, putObject } from '@/lib/storage/blob'
import { isBlobPublicUrl } from '@/lib/storage/provider'
import { createLogger } from '@/utils/logger'

const log = createLogger('lib/eventApplications/photo')

/** 공개 저장소에서 신청 사진이 놓이는 접두 — 업로드 라우트와 같아야 한다 */
const PUBLIC_PREFIX = 'attachments/event-applications/'
/** 비공개 저장소의 접두(공개 접두에서 `attachments/`만 뗀 모양) */
const PRIVATE_PREFIX = 'event-applications/'

/** 저장된 값이 **비공개 경로**인가. 절대 URL(옛 행)이면 false */
export function isPrivateEventPhotoRef(ref: unknown): ref is string {
  return (
    typeof ref === 'string' &&
    ref.startsWith(PRIVATE_PREFIX) &&
    !ref.includes('..') &&
    !/^https?:\/\//i.test(ref)
  )
}

/**
 * 공개 Blob URL → 저장소 경로. 우리 공개 저장소가 아니거나 신청 사진 접두가 아니면 null.
 * (`isBlobPublicUrl`이 베이스 URL 대조를 하므로 남의 저장소 URL 을 옮기려 들지 않는다.)
 */
export function publicEventPhotoPath(url: string): string | null {
  if (!isBlobPublicUrl(url)) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
  if (!pathname.startsWith(PUBLIC_PREFIX)) return null
  if (pathname.includes('..')) return null
  return pathname
}

/**
 * 공개 사진을 비공개 저장소로 옮기고 **비공개 경로**를 돌려준다. 옮길 수 없으면 null.
 *
 * 공개 사본 삭제는 실패해도 경로를 돌려준다 — 행이 이미 비공개 경로를 가리키게 되므로
 * 화면은 정상이고, 남은 공개 사본은 로그로 남겨 사람이 지울 수 있게 한다(조용히 넘기지 않는다).
 */
export async function moveEventPhotoToPrivate(url: string): Promise<string | null> {
  const publicPath = publicEventPhotoPath(url)
  if (!publicPath) return null

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    log.warn('신청 사진을 읽지 못해 비공개로 옮기지 못했다', { status: response.status })
    return null
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.byteLength === 0) return null
  const contentType = response.headers.get('content-type') || 'application/octet-stream'
  const privatePath = `${PRIVATE_PREFIX}${publicPath.slice(PUBLIC_PREFIX.length)}`

  await putObject('private', privatePath, buffer, contentType)

  try {
    await deleteObject('public', publicPath)
  } catch (error) {
    log.error('비공개로 옮긴 뒤 공개 사본을 지우지 못했다 — 수동 정리 필요', {
      publicPath,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return privatePath
}
