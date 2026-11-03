/**
 * 조합 업무 자원 — 손들기(POST)와 철회(DELETE) (스펙 §6 2항).
 *
 * - 지명·배정은 없다. 조합원이 스스로 누른 기록만 남고, 조합 업무 지급(Task 9)은
 *   철회하지 않은 기록이 있는 사람에게만 한다.
 * - POST: `requireTimebankParticipant` + **`coop_tasks_enabled === true`**(§7.2 표:
 *   꺼지면 자원 표시 불가) + 열린 `coop_task` 글. 새로 자원했을 때만 글쓴
 *   관리자에게 알린다(`notifyVolunteer`).
 * - DELETE: 철회는 자기 기록을 거두는 일이라 꺼짐·탈퇴 신청 중에도 막지 않는다
 *   (§7.2가 pending 취소를 막지 않는 것과 같은 이유) — `requireTimebankReader`.
 * - 글이 없거나 `coop_task`가 아니면 404.
 */

import { NextRequest, NextResponse } from 'next/server'
import { apiDelete, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import {
  requireTimebankParticipant,
  requireTimebankReader,
  timebankRateLimit,
} from '@/lib/server/timebankAuth'
import { applyRouteRateLimit } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { notifyVolunteer } from '@/lib/server/timebankNotify'
import { getTimebankListingOwner, volunteer, withdrawVolunteer } from '@/db/queries/timebankBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const NOT_FOUND = '조합 업무 글을 찾을 수 없습니다.'

async function readListingId(context: RouteContext) {
  const { id } = await context.params
  const validation = validateUUID(id, '글 ID')
  if (!validation.isValid) {
    return { error: ApiError.badRequest(validation.errors[0] || '잘못된 글 ID 형식입니다.') }
  }
  return { id: validation.sanitized }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireTimebankParticipant()
  if (auth instanceof NextResponse) return auth
  const { user, settings } = auth

  if (settings.coop_tasks_enabled !== true) {
    return ApiError.forbidden('조합 업무 참여가 지금 꺼져 있습니다.').toNextResponse()
  }

  const rl = await applyRouteRateLimit(request, timebankRateLimit('volunteer', user.id))
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  return apiPost(
    async () => {
      const owner = await getTimebankListingOwner(listingId)
      if (!owner || owner.kind !== 'coop_task') throw ApiError.notFound(NOT_FOUND)
      if (owner.status !== 'open') throw ApiError.conflict('마감된 조합 업무입니다.')

      const { changed } = await volunteer(listingId, user.id)
      if (changed) {
        await notifyVolunteer({
          listingId,
          listingTitle: owner.title,
          authorId: owner.author_id,
          volunteerId: user.id,
        })
      }
      return ApiSuccess.ok({ id: listingId, volunteered: true }, '참여 의사를 남겼습니다.')
    },
    `/api/timebank/listings/${listingId}/volunteer`,
    { userId: user.id }
  )
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const routeId = await readListingId(context)
  if (routeId.error) return routeId.error.toNextResponse()
  const listingId = routeId.id

  const auth = await requireTimebankReader()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiDelete(
    async () => {
      const owner = await getTimebankListingOwner(listingId)
      if (!owner || owner.kind !== 'coop_task') throw ApiError.notFound(NOT_FOUND)

      await withdrawVolunteer(listingId, user.id)
      return ApiSuccess.ok({ id: listingId, volunteered: false }, '참여 의사를 거두었습니다.')
    },
    `/api/timebank/listings/${listingId}/volunteer`,
    { userId: user.id }
  )
}
