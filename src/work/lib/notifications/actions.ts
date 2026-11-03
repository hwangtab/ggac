'use server'

import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { loadChannelAccess, viewerOf } from '@/lib/server/boardWorkChannelAuth'
import { setNotifyLevelRow } from '@/db/queries/work/channels'
import { upsertMemberPrefs } from '@/db/queries/work/prefs'
import { dbFailure, fail, invalid, ok, type ActionResult } from '@work/lib/channels/action-result'
import { refreshShell } from '@work/lib/channels/action-support'
import { effectiveNotifyLevel, levelToStore, notifyLevelOptions, type NotifyLevel } from './levels'
import { channelNotifyInputSchema, notificationPrefsInputSchema } from './schema'
import { resolveStatusUntil, statusInputSchema } from './status'

/**
 * 알림·상태·첫 사용 안내 server action — 원본 kosmart-work `lib/notifications/actions.ts`와 같은 이름·모양.
 * 본인 행만 바뀐다(원본 trg_10_harden·RLS 자리 — user_id는 가드의 사용자로 고정).
 * 상태 메시지는 원본 `staff` 행 자리인 `work_member_prefs`에 둔다(설계 §3).
 */

/** 채널별 알림 수준. 기본값과 같은 선택은 null로 저장해 "기본"을 유지한다. */
export async function setChannelNotifyLevel(
  input: unknown
): Promise<ActionResult<{ level: NotifyLevel }>> {
  const ctx = await requireWorkStaff()
  const parsed = channelNotifyInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { channelId, level } = parsed.data

  let access: Awaited<ReturnType<typeof loadChannelAccess>>
  try {
    access = await loadChannelAccess(viewerOf(ctx), channelId)
  } catch (e) {
    return dbFailure('setChannelNotifyLevel:channel', e)
  }
  // 읽을 수 없는 채널은 있는지조차 알리지 않는다(원본 channels_select)
  if (!access || !access.canRead) return fail('채널을 찾을 수 없습니다.')
  // 1:1 DM은 "멘션만"이 의미 없다 — 화면이 안 보여 주는 값을 직접 호출로 저장하지 못하게 한다
  if (!notifyLevelOptions(access.kind, access.isGroup).includes(level)) {
    return fail('이 대화에서는 선택할 수 없는 알림 수준입니다.')
  }

  let updated: boolean
  try {
    updated = await setNotifyLevelRow(channelId, ctx.user.id, levelToStore(level, access.kind))
  } catch (e) {
    return dbFailure('setChannelNotifyLevel', e)
  }
  if (!updated) return fail('참여한 채널에서만 바꿀 수 있습니다.')
  refreshShell()
  return ok({ level: effectiveNotifyLevel(level, access.kind) })
}

/** 방해 금지 시간 + 메일 다이제스트 설정 저장. */
export async function saveNotificationPrefs(input: unknown): Promise<ActionResult> {
  const { user } = await requireWorkStaff()
  const parsed = notificationPrefsInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { quiet, digestMode } = parsed.data
  try {
    await upsertMemberPrefs(user.id, {
      quietEnabled: quiet.enabled,
      quietStart: quiet.start,
      quietEnd: quiet.end,
      quietWeekends: quiet.weekends,
      digestMode,
    })
  } catch (e) {
    return dbFailure('saveNotificationPrefs', e)
  }
  refreshShell()
  return ok(undefined)
}

/** 상태 메시지 설정(이모지·문구·만료). */
export async function setMyStatus(input: unknown): Promise<ActionResult> {
  const { user } = await requireWorkStaff()
  const parsed = statusInputSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const { emoji, text, expiry } = parsed.data
  const until = expiry === 'keep' ? undefined : resolveStatusUntil(expiry)
  try {
    await upsertMemberPrefs(user.id, {
      statusEmoji: emoji === '' ? null : emoji,
      statusText: text === '' ? null : text,
      // 'keep'이면 만료 시각을 건드리지 않는다(저장된 값 유지)
      ...(until === undefined ? {} : { statusUntil: until ? new Date(until) : null }),
    })
  } catch (e) {
    return dbFailure('setMyStatus', e)
  }
  refreshShell()
  return ok(undefined)
}

export async function clearMyStatus(): Promise<ActionResult> {
  const { user } = await requireWorkStaff()
  try {
    await upsertMemberPrefs(user.id, { statusEmoji: null, statusText: null, statusUntil: null })
  } catch (e) {
    return dbFailure('clearMyStatus', e)
  }
  refreshShell()
  return ok(undefined)
}

/** 첫 사용 안내를 마쳤거나 건너뜀 — 서버에 기록해 다시 보이지 않게 한다. */
export async function completeOnboarding(): Promise<ActionResult> {
  const { user } = await requireWorkStaff()
  try {
    await upsertMemberPrefs(user.id, { onboardedAt: new Date() })
  } catch (e) {
    return dbFailure('completeOnboarding', e)
  }
  refreshShell()
  return ok(undefined)
}

/** 설정에서 안내를 다시 보기. */
export async function resetOnboarding(): Promise<ActionResult> {
  const { user } = await requireWorkStaff()
  try {
    await upsertMemberPrefs(user.id, { onboardedAt: null })
  } catch (e) {
    return dbFailure('resetOnboarding', e)
  }
  refreshShell()
  return ok(undefined)
}
