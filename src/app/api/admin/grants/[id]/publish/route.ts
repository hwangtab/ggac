/**
 * 지원사업 회차 발행. 게시글·인앱 알림·이메일이 여기서 나간다.
 *
 * 절차 자체는 `src/lib/server/grantPublish.ts`가 갖고 있고 여기는 **배선만** 한다 —
 * 조회로 재료를 모으고, 주입하고, 결과를 회차에 기록한다.
 */
import { claimGrantDigestForPublish, getGrantDigestById } from '@/db/queries/grantDigests'
import { FEATURE_DISABLED_MESSAGES, isBoardEnabled } from '@/lib/features/settings'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { publishClaimedDigest } from '@/lib/server/grantPublishWiring'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { maskId } from '@/utils/logger'

export const runtime = 'nodejs'
/** 18통 순차 발송 + 게시글 + 알림. 조합원이 크게 늘면 이 값을 다시 본다. */
export const maxDuration = 300

export const POST = defineApiRoute({
  method: 'POST',
  name: 'admin.grants.publish',
  rateLimit: { ...RATE_LIMITS.ADMIN_API, keyGenerator: createUserKeyGenerator('admin_grants') },
  rateLimitHeaders: true,
  auth: 'admin',
  handler: async ({ params, auth }) => {
    const id = String(params.id)
    const adminId = (auth as { user: { id: string } }).user.id

    // 게시판 스위치를 먼저 본다. 발행은 `createPost`로 **새 게시글을 만드는**
    // 동작이고, 기능 스위치 모듈은 "관리자도 걸린다"고 선언한다
    // (`@/lib/features/settings` 파일 머리). 여기만 확인을 빼놓고 있었다 —
    // 사무국이 게시판을 껐는데도 지원사업 발행은 계속 새 글을 올렸다.
    //
    // 선점(`claimGrantDigestForPublish`)보다 **앞에** 둔다. 뒤에 두면 막을
    // 때마다 회차가 'publishing'에 갇힌다.
    if ((await isBoardEnabled()) === false) {
      throw ApiError.serviceUnavailable(FEATURE_DISABLED_MESSAGES.board)
    }

    const digest = await getGrantDigestById(id)
    if (!digest) throw ApiError.notFound('회차를 찾을 수 없습니다.')
    if (digest.status !== 'draft') {
      throw ApiError.badRequest('이미 발행되었거나 폐기된 회차입니다.')
    }

    // draft → publishing 조건부 선점. 동시에 두 요청이 여기 도달해도 UPDATE ... WHERE
    // status='draft'는 하나만 갱신된 행을 돌려준다 — 나머지는 null을 받고 400으로 빠진다.
    // 이 선점이 없으면 위의 존재·상태 확인과 아래 status:'published' 기록 사이에 경쟁
    // 창이 생겨, 같은 회차가 두 번 발행되면(더블클릭·재시도·관리자 두 명) 조합원
    // 전원에게 메일이 두 번 나간다 — 이미 나간 메일은 회수되지 않는다.
    const claimed = await claimGrantDigestForPublish(id)
    if (!claimed) {
      throw ApiError.badRequest('이미 발행 중이거나 발행된 회차입니다.')
    }

    const result = await publishClaimedDigest({
      claimed,
      authorId: adminId,
      actor: maskId(adminId),
    })

    return ApiSuccess.ok(result, '발행했습니다.')
  },
})
