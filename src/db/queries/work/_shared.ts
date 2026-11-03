/**
 * 이사회 업무툴 쿼리 계층 공용 — docs/board-work/01-설계.md §5·§6.
 *
 * `src/db/queries/*`의 규칙 그대로 **권한을 모른다.** 누가 이 채널을 읽을 수 있는지·관리자인지는
 * 호출부(`src/lib/server/boardWorkChannelAuth.ts` → server action)가 판정해 **인자로** 넘긴다
 * (읽기 범위 `readable`, 쓰기 자격 플래그). 대신 원본 Postgres BEFORE/AFTER 트리거가 지키던
 * **데이터 정합성**(작성자 강제·답글 수 재계산·보관 채널 쓰기 금지 …)은 여기 쓰기 함수가 같은
 * 트랜잭션 안에서 지킨다 — 호출부가 무엇을 넘기든 깨지지 않아야 하는 규칙이라서다.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import {
  workAttachments,
  workChannelMembers,
  workChannels,
  workMemberPrefs,
  workMessages,
} from '../../schema/index.ts'

export type WorkDb = typeof db
export type WorkTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type WorkExecutor = WorkDb | WorkTx

/**
 * 쓰기 함수가 원본 트리거의 `raise exception` 자리에서 던지는 오류. action이 `code`로 사용자 문구를 고른다.
 * - not_found      대상(채널·메시지)이 없다
 * - archived       보관된 채널(원본 42501 '보관된 채널에는 쓸 수 없습니다')
 * - owners_only    공지 채널 최상위 글(원본 42501 '소유자만')
 * - invalid_parent 답글 대상이 없거나·최상위가 아니거나·다른 채널(원본 23503/23514)
 * - invalid_quote  인용 대상이 없거나 다른 채널(원본 23503/23514 '인용')
 * - forbidden      작성자·관리자가 아닌 수정·삭제 등(원본 RLS 0행)
 * - deleted        지워진 메시지에 대한 쓰기(원본 *_live_insert)
 * - conflict       유일성 충돌(원본 23505)
 * - invalid_target 대상이 그 채널 것이 아니다(원본 23514 '고정할 메시지가 이 채널에 없습니다')
 * - invalid        원본 CHECK·하드닝이 거절한 값(23514 — 'https 주소만', 길이). 메시지는 사용자에게 보여도 된다
 * - limit          개수 상한(23514 — '탭은 대화당 20개까지', '메모는 대화당 30개까지'). 메시지는 사용자에게 보여도 된다
 */
export type WorkWriteErrorCode =
  | 'not_found'
  | 'archived'
  | 'owners_only'
  | 'invalid_parent'
  | 'invalid_quote'
  | 'forbidden'
  | 'deleted'
  | 'conflict'
  | 'invalid_target'
  | 'invalid'
  | 'limit'

export class WorkWriteError extends Error {
  readonly code: WorkWriteErrorCode
  constructor(code: WorkWriteErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'WorkWriteError'
    this.code = code
  }
}

export function isWorkWriteError(e: unknown, code?: WorkWriteErrorCode): e is WorkWriteError {
  return e instanceof WorkWriteError && (code === undefined || e.code === code)
}

/** Date | null → ISO | null (원본 timestamptz 문자열 자리) */
export function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/** null이 아닌 Date → ISO */
export function isoNN(value: Date): string {
  return value.toISOString()
}

/** `inArray`는 빈 배열에서 무효 SQL을 만든다 — 호출부가 먼저 거르지만 한 번 더. */
export function nonEmpty<T>(list: readonly T[]): boolean {
  return list.length > 0
}

export function chunks<T>(list: readonly T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * 채널 변경 번호를 1 올리고 새 값을 돌려준다(§6-1). 메시지·반응·답글 수가 바뀌는 쓰기는 **같은 트랜잭션에서**
 * 이 값을 바뀐 메시지의 `rev`에 적는다 — 폴링은 "내가 본 rev보다 큰 메시지"만 다시 읽는다.
 *
 * 고정·탭은 커서를 따로 두지 않는다: 같은 번호를 올리고 `pins_rev`/`tabs_rev`에 **그때의 rev**를 적는다.
 * 그래서 클라이언트는 채널마다 rev 하나만 들고 있으면 되고, 서버는 `pins_rev > 요청 rev`로 "고정이 바뀌었나"를 안다.
 * (SQLite UPDATE의 SET 식은 갱신 전 값을 읽으므로 `rev + 1`이 곧 새 rev다.)
 */
export async function bumpChannelRev(
  tx: WorkExecutor,
  channelId: string,
  opts: { pins?: boolean; tabs?: boolean } = {}
): Promise<number> {
  const next = sql`${workChannels.rev} + 1`
  const [row] = await tx
    .update(workChannels)
    .set({
      rev: next,
      ...(opts.pins ? { pinsRev: next } : {}),
      ...(opts.tabs ? { tabsRev: next } : {}),
    })
    .where(eq(workChannels.id, channelId))
    .returning({ rev: workChannels.rev })
  if (!row) throw new WorkWriteError('not_found', '채널이 없습니다')
  return row.rev
}

/**
 * 사용자 단위 변경 번호(§6-1) — 사이드바 목록 자체가 바뀌었다(새 채널에 들어감·나감·새 DM·그룹 변경·보관).
 * 원본 `user:<uid>` 토픽의 MEMBER_ADDED·DM_MESSAGE 자리. prefs 행이 없으면 만든다.
 */
export async function bumpMembershipRev(
  tx: WorkExecutor,
  userIds: readonly string[]
): Promise<void> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return
  for (const part of chunks(ids)) {
    await tx
      .insert(workMemberPrefs)
      .values(part.map(userId => ({ userId, membershipRev: 1 })))
      .onConflictDoUpdate({
        target: workMemberPrefs.userId,
        set: { membershipRev: sql`${workMemberPrefs.membershipRev} + 1` },
      })
  }
}

/** 채널 멤버 전원의 id(보관·멤버 변경처럼 모두의 사이드바가 바뀔 때 membership_rev 대상) */
export async function channelMemberIds(tx: WorkExecutor, channelId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: workChannelMembers.userId })
    .from(workChannelMembers)
    .where(eq(workChannelMembers.channelId, channelId))
  return rows.map(r => r.userId)
}

/** 계보 키 coalesce(version_root_id, id) — 0028 유일 인덱스와 같은 식 */
export const lineageKeySql = sql`coalesce(${workAttachments.versionRootId}, ${workAttachments.id})`

/**
 * 원본 recompute_attachment_latest(0032): 계보 안에서 **메시지가 지워지지 않은 가장 높은 번호** 행만 is_latest.
 * 첨부를 넣은 뒤·게시물을 지운 뒤 같은 트랜잭션에서 부른다. 살아 있는 버전이 하나도 없으면 전부 false.
 */
export async function recomputeAttachmentLatest(tx: WorkExecutor, rootId: string): Promise<void> {
  const [latest] = await tx
    .select({ id: workAttachments.id })
    .from(workAttachments)
    .innerJoin(workMessages, eq(workMessages.id, workAttachments.messageId))
    .where(and(sql`${lineageKeySql} = ${rootId}`, isNull(workMessages.deletedAt)))
    .orderBy(desc(workAttachments.versionNo))
    .limit(1)
  const latestId = latest?.id ?? null
  await tx
    .update(workAttachments)
    .set({
      isLatest: latestId
        ? sql`case when ${workAttachments.id} = ${latestId} then 1 else 0 end`
        : false,
    })
    .where(sql`${lineageKeySql} = ${rootId}`)
}

/** 원본 recompute_latest_after_message_delete: 그 메시지 첨부가 속한 계보마다 재계산 */
export async function recomputeLatestForMessage(
  tx: WorkExecutor,
  messageId: string
): Promise<void> {
  const roots = await tx
    .selectDistinct({ root: sql<string>`${lineageKeySql}` })
    .from(workAttachments)
    .where(eq(workAttachments.messageId, messageId))
  for (const r of roots) await recomputeAttachmentLatest(tx, r.root)
}
