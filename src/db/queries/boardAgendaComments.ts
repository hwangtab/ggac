/**
 * `board_agenda_comments` 쿼리 계층 (Turso/Drizzle) — 이사회 안건 토론.
 *
 * `board.ts`와 같은 규칙을 따른다. 이 모듈은 **권한을 모른다.** 인증·인가
 * 판정을 하지 않고, `NextResponse`를 만들지 않고, `next/headers`를 임포트하지
 * 않는다. 이사회 접근 판정(`requireBoardMember()`)과 작성자 소유권 검사는
 * 전부 호출부(`src/app/api/board-room/agendas/[id]/comments/*`)의 몫이다.
 *
 * 응답 형태는 snake_case다(CLAUDE.md).
 *
 * 삭제는 `is_deleted` soft delete뿐이다 — 이사회 발언은 회의록의 근거라
 * 행을 지우지 않는다. `listCommentsByAgenda`는 삭제된 댓글도 돌려주되
 * **본문을 담지 않는다**(라우트가 다시 거를 필요가 없게 여기서 끊는다).
 */

import { and, asc, count, eq, inArray, ne } from 'drizzle-orm'

import { db } from '../client.ts'
import { boardAgendaComments, boardAgendas, memberProfiles } from '../schema/index.ts'

import { toIso } from './_helpers.ts'

export interface AgendaCommentRow {
  id: string
  agenda_id: string
  author_id: string
  author_name: string
  author_title: string | null
  /** 삭제된 댓글은 `null`. */
  content: string | null
  is_deleted: boolean
  created_at: string
  updated_at: string
}

/** `GET /api/board-room/agendas/[id]/comments`. 시간 오름차순(대화 순서). */
export async function listCommentsByAgenda(agendaId: string): Promise<AgendaCommentRow[]> {
  const rows = await db
    .select({
      id: boardAgendaComments.id,
      agendaId: boardAgendaComments.agendaId,
      authorId: boardAgendaComments.authorId,
      authorName: memberProfiles.displayName,
      authorTitle: memberProfiles.directorTitle,
      content: boardAgendaComments.content,
      isDeleted: boardAgendaComments.isDeleted,
      createdAt: boardAgendaComments.createdAt,
      updatedAt: boardAgendaComments.updatedAt,
    })
    .from(boardAgendaComments)
    .innerJoin(memberProfiles, eq(memberProfiles.id, boardAgendaComments.authorId))
    .where(eq(boardAgendaComments.agendaId, agendaId))
    .orderBy(asc(boardAgendaComments.createdAt))

  return rows.map(row => ({
    id: row.id,
    agenda_id: row.agendaId,
    author_id: row.authorId,
    author_name: row.authorName,
    author_title: row.authorTitle,
    content: row.isDeleted ? null : row.content,
    is_deleted: row.isDeleted,
    created_at: toIso(row.createdAt) as string,
    updated_at: toIso(row.updatedAt) as string,
  }))
}

/**
 * 안건 id별 살아있는 댓글 수. 회의 상세가 안건 목록과 함께 배지를 그린다.
 * 안건이 없으면 쿼리를 실행하지 않는다.
 */
export async function countCommentsByAgendas(agendaIds: string[]): Promise<Record<string, number>> {
  if (agendaIds.length === 0) return {}
  const rows = await db
    .select({ agendaId: boardAgendaComments.agendaId, total: count() })
    .from(boardAgendaComments)
    .where(
      and(
        inArray(boardAgendaComments.agendaId, agendaIds),
        eq(boardAgendaComments.isDeleted, false)
      )
    )
    .groupBy(boardAgendaComments.agendaId)

  const out: Record<string, number> = {}
  for (const row of rows) out[row.agendaId] = row.total
  return out
}

/**
 * `exceptAuthorId` **말고 다른 사람**의 의견이 있는지. 안건 삭제 가드가 쓴다.
 *
 * 자기 혼자 메모처럼 남긴 의견까지 세면, 제안자가 자기 안건을 정리하려 할 때
 * 관리자를 불러야 한다. 가드가 지키려는 것은 **남의 발언**이다.
 *
 * 삭제된 의견도 센다(`is_deleted` 필터 없음). soft delete는 화면에서 가릴
 * 뿐 행은 남겨 두는 것이고, 안건 삭제는 그 행을 cascade로 **없앤다** — 여기서
 * 걸러 내면 "남이 썼다 지운 안건"은 제안자가 통째로 파기할 수 있게 된다.
 */
export async function hasCommentsByOthers(
  agendaId: string,
  exceptAuthorId: string
): Promise<boolean> {
  const [row] = await db
    .select({ total: count() })
    .from(boardAgendaComments)
    .where(
      and(
        eq(boardAgendaComments.agendaId, agendaId),
        ne(boardAgendaComments.authorId, exceptAuthorId)
      )
    )
  return (row?.total ?? 0) > 0
}

export interface CreateAgendaCommentInput {
  agendaId: string
  authorId: string
  content: string
}

export async function createAgendaComment(
  input: CreateAgendaCommentInput
): Promise<{ id: string }> {
  const [row] = await db
    .insert(boardAgendaComments)
    .values({
      agendaId: input.agendaId,
      authorId: input.authorId,
      content: input.content,
    })
    .returning({ id: boardAgendaComments.id })
  return { id: row.id }
}

/**
 * 안건 존재 확인 + 알림 대상 산출용. 없으면 `null`.
 * `proposed_by`는 회원이 지워졌으면 `null`일 수 있다(FK가 SET NULL).
 */
export async function getAgendaContext(
  agendaId: string
): Promise<{ meeting_id: string; title: string; proposed_by: string | null } | null> {
  const [row] = await db
    .select({
      meetingId: boardAgendas.meetingId,
      title: boardAgendas.title,
      proposedBy: boardAgendas.proposedBy,
    })
    .from(boardAgendas)
    .where(eq(boardAgendas.id, agendaId))
    .limit(1)
  if (!row) return null
  return { meeting_id: row.meetingId, title: row.title, proposed_by: row.proposedBy }
}

/** 해당 안건에 이미 발언한 사람들(삭제된 댓글 작성자 제외). 알림 대상. */
export async function listAgendaParticipants(agendaId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ authorId: boardAgendaComments.authorId })
    .from(boardAgendaComments)
    .where(
      and(eq(boardAgendaComments.agendaId, agendaId), eq(boardAgendaComments.isDeleted, false))
    )
  return rows.map(row => row.authorId)
}

/**
 * 소유권·경로 대조용. 없으면 `undefined`(404와 403을 라우트가 구분한다).
 * `agenda_id`를 함께 돌려주는 이유: 남의 안건 경로로 다른 안건의 댓글을
 * 지우려는 경로 위조를 라우트가 막을 수 있게 하기 위해서다.
 */
export async function getAgendaCommentOwner(
  id: string
): Promise<{ author_id: string; agenda_id: string; is_deleted: boolean } | undefined> {
  const [row] = await db
    .select({
      authorId: boardAgendaComments.authorId,
      agendaId: boardAgendaComments.agendaId,
      isDeleted: boardAgendaComments.isDeleted,
    })
    .from(boardAgendaComments)
    .where(eq(boardAgendaComments.id, id))
    .limit(1)
  if (!row) return undefined
  return { author_id: row.authorId, agenda_id: row.agendaId, is_deleted: row.isDeleted }
}

export async function updateAgendaCommentContent(id: string, content: string): Promise<void> {
  await db.update(boardAgendaComments).set({ content }).where(eq(boardAgendaComments.id, id))
}

/**
 * 행도 본문도 지우지 않는다 — `is_deleted`만 세운다. 화면·API에서 본문을
 * 가리는 일은 `listCommentsByAgenda`가 이미 하고 있고, 여기서 본문까지
 * 덮어쓰면 관리자가 이사의 발언을 **되돌릴 수 없게** 없애게 된다. 이 표는
 * 회의록의 근거다.
 */
export async function softDeleteAgendaComment(id: string): Promise<void> {
  await db
    .update(boardAgendaComments)
    .set({ isDeleted: true })
    .where(eq(boardAgendaComments.id, id))
}
