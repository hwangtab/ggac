'use server'

import { z } from 'zod'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { upsertMemberPrefs } from '@/db/queries/work/prefs'
import { dbFailure, invalid, ok, type ActionResult } from './action-result'
import { CHANNEL_SORTS, CHAT_SORTS, type ChannelSort, type ChatSort } from './sort'

/**
 * 목록 정렬 방식 저장 — 원본 kosmart-work `lib/channels/sort-actions.ts`와 같은 이름·모양.
 * 본인 prefs 행만(user_id는 서버 세션에서 얻는다). 화면은 낙관적으로 먼저 바꾸므로 revalidate하지 않는다.
 */
const channelSchema = z.object({ sort: z.enum(CHANNEL_SORTS) })
const chatSchema = z.object({ sort: z.enum(CHAT_SORTS) })

export async function setChannelSort(input: unknown): Promise<ActionResult<{ sort: ChannelSort }>> {
  const { user } = await requireWorkStaff()
  const parsed = channelSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    await upsertMemberPrefs(user.id, { channelSort: parsed.data.sort })
  } catch (e) {
    return dbFailure('setChannelSort', e)
  }
  return ok({ sort: parsed.data.sort })
}

export async function setChatSort(input: unknown): Promise<ActionResult<{ sort: ChatSort }>> {
  const { user } = await requireWorkStaff()
  const parsed = chatSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  try {
    await upsertMemberPrefs(user.id, { chatSort: parsed.data.sort })
  } catch (e) {
    return dbFailure('setChatSort', e)
  }
  return ok({ sort: parsed.data.sort })
}
