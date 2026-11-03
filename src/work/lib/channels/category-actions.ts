'use server'

import { isWorkAdminRole, requireWorkStaff } from '@/lib/server/boardWorkAuth'
import {
  createCategoryRow,
  deleteCategoryRow,
  moveChannelCategoryRow,
  renameCategoryRow,
  reorderCategoryRows,
} from '@/db/queries/work/channels'
import { logAudit } from '@work/lib/audit/log'
import { dbFailure, fail, FORBIDDEN_MESSAGE, invalid, ok, type ActionResult } from './action-result'
import { refreshShell, writeLimited } from './action-support'
import {
  createCategorySchema,
  deleteCategorySchema,
  moveChannelCategorySchema,
  renameCategorySchema,
  reorderCategoriesSchema,
} from './schema'

/**
 * 채널 카테고리 server action — 원본 kosmart-work `lib/channels/category-actions.ts`와 같은 이름·입력·반환 모양.
 * 카테고리는 공용이라 만들기·이름·순서·삭제·채널 옮기기는 업무툴 관리자만(원본 RLS is_work_admin + action 검사).
 * 원본처럼 관리자가 아니면 리다이렉트가 아니라 실패 결과(FORBIDDEN)를 돌려준다 — 화면이 토스트로 알린다.
 */

const DUPLICATE_MESSAGE = '같은 이름의 카테고리가 있습니다.'

export async function createCategory(
  input: unknown
): Promise<ActionResult<{ id: string; name: string; position: number }>> {
  const { staff } = await requireWorkStaff()
  if (!isWorkAdminRole(staff.role)) return fail(FORBIDDEN_MESSAGE)
  const parsed = createCategorySchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const limited = await writeLimited(staff.user_id)
  if (limited) return limited

  const id = crypto.randomUUID()
  let outcome: Awaited<ReturnType<typeof createCategoryRow>>
  try {
    outcome = await createCategoryRow({ id, name: parsed.data.name, createdBy: staff.user_id })
  } catch (e) {
    return dbFailure('createCategory', e)
  }
  if (outcome.status === 'conflict') return fail(DUPLICATE_MESSAGE)
  await logAudit(
    staff.user_id,
    'channel_category.create',
    { type: 'channel_category', id },
    { name: parsed.data.name }
  )
  refreshShell()
  return ok({ id, name: parsed.data.name, position: outcome.position })
}

export async function renameCategory(input: unknown): Promise<ActionResult> {
  const { staff } = await requireWorkStaff()
  if (!isWorkAdminRole(staff.role)) return fail(FORBIDDEN_MESSAGE)
  const parsed = renameCategorySchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  let outcome: Awaited<ReturnType<typeof renameCategoryRow>>
  try {
    outcome = await renameCategoryRow(parsed.data.categoryId, parsed.data.name)
  } catch (e) {
    return dbFailure('renameCategory', e)
  }
  if (outcome === 'conflict') return fail(DUPLICATE_MESSAGE)
  if (outcome === 'not_found') return fail('카테고리를 찾을 수 없습니다.')
  await logAudit(
    staff.user_id,
    'channel_category.rename',
    { type: 'channel_category', id: parsed.data.categoryId },
    { name: parsed.data.name }
  )
  refreshShell()
  return ok(undefined)
}

/** ids 순서대로 position 0..을 다시 매긴다. ids에 없는 카테고리는 건드리지 않는다 */
export async function reorderCategories(input: unknown): Promise<ActionResult> {
  const { staff } = await requireWorkStaff()
  if (!isWorkAdminRole(staff.role)) return fail(FORBIDDEN_MESSAGE)
  const parsed = reorderCategoriesSchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)
  const ids = [...new Set(parsed.data.ids)]
  try {
    await reorderCategoryRows(ids)
  } catch (e) {
    return dbFailure('reorderCategories', e)
  }
  await logAudit(staff.user_id, 'channel_category.reorder', null, { ids })
  refreshShell()
  return ok(undefined)
}

/** 카테고리 삭제 — 안의 채널은 기타(category_id null)로 */
export async function deleteCategory(input: unknown): Promise<ActionResult> {
  const { staff } = await requireWorkStaff()
  if (!isWorkAdminRole(staff.role)) return fail(FORBIDDEN_MESSAGE)
  const parsed = deleteCategorySchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  let row: Awaited<ReturnType<typeof deleteCategoryRow>>
  try {
    row = await deleteCategoryRow(parsed.data.categoryId)
  } catch (e) {
    return dbFailure('deleteCategory', e)
  }
  if (!row) return fail('카테고리를 찾을 수 없습니다.')
  await logAudit(
    staff.user_id,
    'channel_category.delete',
    { type: 'channel_category', id: parsed.data.categoryId },
    { name: row.name }
  )
  refreshShell()
  return ok(undefined)
}

/** 채널을 다른 카테고리로(null = 기타). DM은 대상이 아니다 */
export async function moveChannelToCategory(input: unknown): Promise<ActionResult> {
  const { staff } = await requireWorkStaff()
  if (!isWorkAdminRole(staff.role)) return fail(FORBIDDEN_MESSAGE)
  const parsed = moveChannelCategorySchema.safeParse(input)
  if (!parsed.success) return invalid(parsed.error)

  let outcome: Awaited<ReturnType<typeof moveChannelCategoryRow>>
  try {
    outcome = await moveChannelCategoryRow(parsed.data.channelId, parsed.data.categoryId)
  } catch (e) {
    return dbFailure('moveChannelToCategory', e)
  }
  if (outcome.status === 'category_missing') {
    return fail('카테고리를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.')
  }
  if (outcome.status === 'not_found') return fail('옮길 수 있는 채널이 아닙니다.')
  await logAudit(
    staff.user_id,
    'channel.move_category',
    { type: 'channel', id: parsed.data.channelId },
    { category_id: parsed.data.categoryId }
  )
  refreshShell()
  return ok(undefined)
}
