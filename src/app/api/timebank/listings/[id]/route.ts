/**
 * 타임뱅크 글 하나 — 읽기(GET) · 수정(PATCH) · 삭제(DELETE).
 *
 * 경계:
 *   - 읽기: 승인 조합원(`requireTimebankReader`, 꺼져도 읽는다)
 *   - 수정: **글쓴이 본인만**, `requireTimebankParticipant`(쓰기). 본문에 `status`만
 *     오면 열기·닫기만 한다(다시 열 때는 열린 글 상한을 다시 본다)
 *   - 삭제: 글쓴이 또는 관리자(`canRemoveTimebankItem`). 지우는 것은 노출을 줄이는
 *     쪽이라 꺼짐·미동의·탈퇴 신청 중에도 막지 않는다 — `requireTimebankReader`
 *   - `coop_task` 글은 조합원 라우트로 수정·삭제할 수 없다 → 404(관리자 라우트 몫)
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, apiGet, apiPatch, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  MAX_OPEN_TIMEBANK_LISTINGS,
  requireTimebankParticipant,
  requireTimebankReader,
} from '@/lib/server/timebankAuth'
import { canRemoveTimebankItem } from '@/lib/server/authz'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { validateUUID } from '@/utils/validation'
import { parseListingInput, parseListingStatus } from '@/lib/timebank/validate'
import {
  countOpenListingsByAuthor,
  getTimebankListing,
  getTimebankListingOwner,
  isVolunteering,
  setTimebankListingStatus,
  softDeleteTimebankListing,
  updateTimebankListing,
} from '@/db/queries/timebankBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const NOT_FOUND = '글을 찾을 수 없습니다.'

async function readListingId(context: RouteContext) {
  const { id } = await context.params
  const validation = validateUUID(id, '글 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 글 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiGet(
    async () => {
      const listing = await getTimebankListing(listingId)
      if (!listing) throw ApiError.notFound(NOT_FOUND)
      const myVolunteered =
        listing.kind === 'coop_task' ? await isVolunteering(listingId, user.id) : false
      return ApiSuccess.ok({ listing, my_volunteered: myVolunteered })
    },
    `/api/timebank/listings/${listingId}`,
    { userId: user.id }
  )
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireTimebankParticipant()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPatch(
    async () => {
      const owner = await getTimebankListingOwner(listingId)
      if (!owner || owner.kind === 'coop_task') throw ApiError.notFound(NOT_FOUND)
      if (owner.author_id !== user.id) throw ApiError.forbidden('수정 권한이 없습니다.')

      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')

      if (Object.keys(body).length === 1 && 'status' in body) {
        const status = parseListingStatus(body.status)
        if (!status) throw ApiError.badRequest('글 상태 값이 올바르지 않습니다.')
        if (status === owner.status) return ApiSuccess.ok({ id: listingId, status })
        if (
          status === 'open' &&
          (await countOpenListingsByAuthor(user.id)) >= MAX_OPEN_TIMEBANK_LISTINGS
        ) {
          throw ApiError.badRequest(
            `열린 글은 ${MAX_OPEN_TIMEBANK_LISTINGS}개까지 둘 수 있습니다. 끝난 글을 닫아 주세요.`
          )
        }
        await setTimebankListingStatus(listingId, status)
        return ApiSuccess.ok({ id: listingId, status }, '글 상태가 바뀌었습니다.')
      }

      const parsed = parseListingInput(body)
      if (parsed.error !== null) throw ApiError.badRequest(parsed.error)

      await updateTimebankListing(listingId, parsed.value)
      return ApiSuccess.ok({ id: listingId }, '글이 수정되었습니다.')
    },
    `/api/timebank/listings/${listingId}`,
    { userId: user.id }
  )
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user, profile } = auth

  return apiDelete(
    async () => {
      const owner = await getTimebankListingOwner(listingId)
      if (!owner || owner.kind === 'coop_task') throw ApiError.notFound(NOT_FOUND)
      if (!canRemoveTimebankItem(profile, user.id, owner.author_id)) {
        throw ApiError.forbidden('삭제 권한이 없습니다.')
      }

      await softDeleteTimebankListing(listingId)
      return ApiSuccess.ok({ id: listingId }, '글이 삭제되었습니다.')
    },
    `/api/timebank/listings/${listingId}`,
    { userId: user.id }
  )
}
