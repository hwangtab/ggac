/**
 * 업로드 토큰 발급·승격 판정(순수 — import 없음). `node --test`가 저장소·DB 없이 규칙만 본다
 * (scripts/testing/boardWorkFiles.test.mjs).
 *
 * 임시 업로드 → 첨부 승격 전 검사. 원본 kosmart-work `lib/files/promote.ts` promoteOne 의 앞부분을 떼어 냈다 —
 * `node --test`가 저장소 없이 규칙만 볼 수 있게 한다(scripts/testing/boardWorkFiles.test.mjs).
 *
 * 브라우저는 Blob 에 직접 올리므로 객체의 크기·형식은 브라우저가 정한다. 행에는 준비 단계에서 알린 크기·형식을 적어 두고,
 * 승격 때 저장소 `head()`가 돌려준 실제 값과 맞춰 본다:
 *   - 객체 없음                 → 업로드가 끝나지 않았다
 *   - 크기 > 상한               → 거부(토큰의 maximumSizeInBytes 가 1차로 막는다)
 *   - 크기 ≠ 알린 크기          → 거부(ggac 추가 — 행의 size 로 미리보기·다운로드 상한을 판정하므로 어긋나면 안 된다)
 *   - 형식이 행의 mime 과 다름  → 거부(원본 storedContentTypeMatches — 행 기준으로 inline 을 허용하므로 `text/html` 위장을 막는다)
 */

export type PromoteStat = { size: number; contentType: string | null } | null

export type PromoteFailure = 'incomplete' | 'too_large' | 'size_mismatch' | 'type_mismatch'

/** strict: false 라 판별 유니온 대신 한 모양으로 둔다(ok 가 거짓이면 reason 이 있다) */
export type PromoteCheck = { ok: boolean; reason?: PromoteFailure }

/** 원본 mime.ts baseMime — `;` 뒤 매개변수를 떼고 소문자 */
function baseMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase()
}

/**
 * 저장된 Content-Type 이 행의 mime 과 맞는가(원본 storedContentTypeMatches). 저장된 형식이 없거나
 * `application/octet-stream`이면 브라우저가 화면에 그리지 않으므로 통과시킨다.
 */
export function storedContentTypeMatches(
  stored: string | null | undefined,
  rowMime: string
): boolean {
  const s = baseMime(stored)
  if (!s || s === 'application/octet-stream') return true
  return s === baseMime(rowMime)
}

export function checkPromotable(
  row: { size: number; mime: string },
  stat: PromoteStat,
  maxBytes: number
): PromoteCheck {
  if (!stat) return { ok: false, reason: 'incomplete' }
  if (stat.size > maxBytes) return { ok: false, reason: 'too_large' }
  if (stat.size !== row.size) return { ok: false, reason: 'size_mismatch' }
  if (!storedContentTypeMatches(stat.contentType, row.mime)) {
    return { ok: false, reason: 'type_mismatch' }
  }
  return { ok: true }
}

export const PROMOTE_FAILURE_MESSAGE: Record<PromoteFailure, string> = {
  incomplete: '업로드가 완료되지 않았습니다.',
  too_large: '파일이 업로드 상한을 넘습니다.',
  size_mismatch: '파일 크기 정보가 일치하지 않습니다. 다시 올려 주세요.',
  type_mismatch: '파일 형식 정보가 일치하지 않습니다. 다시 올려 주세요.',
}

/** 토큰 발급 판정 결과 — 라우트가 handleUpload 의 onBeforeGenerateToken 에 그대로 쓴다 */
export type UploadTokenGrant = {
  allowedContentTypes: string[]
  maximumSizeInBytes: number
}

/** strict: false 라 판별 유니온 대신 한 모양으로 둔다(ok 면 grant, 아니면 status·error) */
export type UploadTokenDecision = {
  ok: boolean
  grant?: UploadTokenGrant
  status?: 400 | 403 | 404
  error?: string
}

/**
 * ①-2 업로드 토큰 발급 판정(순수 — 조회 결과를 받아 판단만 한다). 원본의 서명 업로드 URL 발급 자리다.
 *  - 본인의 임시 업로드 행이 있어야 하고(남의 uploadId·없는 id → 404)
 *  - 브라우저가 보낸 pathname 이 그 행의 키와 **정확히** 같아야 하며(다른 키로 토큰을 받지 못한다 → 403)
 *  - 지금도 그 채널의 멤버여야 한다(준비 뒤 나갔거나 보관됐으면 → 403)
 * 토큰은 그 행의 형식 하나·알린 크기까지만 허락한다(덮어쓰기·무작위 접미사는 라우트가 끈다).
 */
export function decideUploadToken(input: {
  pathname: string
  pending: { blobPath: string; mime: string; size: number; draftMeta: unknown } | null
  canPost: boolean
  maxBytes: number
}): UploadTokenDecision {
  const { pending } = input
  if (!pending) return { ok: false, status: 404, error: '업로드 정보를 찾을 수 없습니다.' }
  if (pending.draftMeta != null) {
    return { ok: false, status: 403, error: '이 업로드에는 토큰을 줄 수 없습니다.' }
  }
  if (input.pathname !== pending.blobPath) {
    return { ok: false, status: 403, error: '업로드 경로가 일치하지 않습니다.' }
  }
  if (!input.canPost) {
    return { ok: false, status: 403, error: '이 채널에 파일을 올릴 권한이 없습니다.' }
  }
  if (!(pending.size >= 0) || pending.size > input.maxBytes) {
    return { ok: false, status: 400, error: '파일이 업로드 상한을 넘습니다.' }
  }
  return {
    ok: true,
    grant: {
      allowedContentTypes: [pending.mime],
      // 0바이트 파일은 준비 단계에서 거르지만(클라이언트), 0은 SDK 가 "상한 없음"으로 볼 수 있어 1 이상으로 둔다
      maximumSizeInBytes: Math.max(1, pending.size),
    },
  }
}
