/**
 * 업무툴 사람 목록(원본 `work.staff` 자리) — ggac `member_profiles`에서 읽는다(설계 §3: 구성원 표를 따로 두지 않는다).
 *
 * 권한을 모른다: 누가 "활성 구성원"인지(`canAccessBoardRoom`)는 호출부가 함께 돌려준 권한 필드로 판정한다.
 * 그래서 여기서는 **후보**만 넓게 읽는다 — 지금 이사·감사·관리자인 사람 + 업무툴에 흔적(멤버십·작성 글)이 남은 사람
 * (이사에서 빠진 사람의 옛 글에도 이름이 붙게 — 원본 staff 행이 status 'left'로 남던 것과 같은 자리).
 *
 * 개인정보: 화면에 쓰는 이름·직함과 권한 판정 필드만 꺼낸다(연락처·계좌·실명은 읽지 않는다).
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm'

import { db } from '../../client.ts'
import { memberProfiles, workMemberPrefs } from '../../schema/index.ts'

import { iso } from './_shared.ts'

export type WorkPersonRow = {
  user_id: string
  display_name: string
  director_title: string | null
  /** canAccessBoardRoom 판정용 */
  is_admin: boolean
  is_director: boolean
  is_auditor: boolean
  registration_status: string | null
  is_active: boolean
  status_emoji: string | null
  status_text: string | null
  status_until: string | null
}

const personColumns = {
  userId: memberProfiles.id,
  displayName: memberProfiles.displayName,
  directorTitle: memberProfiles.directorTitle,
  isAdmin: memberProfiles.isAdmin,
  isDirector: memberProfiles.isDirector,
  isAuditor: memberProfiles.isAuditor,
  registrationStatus: memberProfiles.registrationStatus,
  isActive: memberProfiles.isActive,
  statusEmoji: workMemberPrefs.statusEmoji,
  statusText: workMemberPrefs.statusText,
  statusUntil: workMemberPrefs.statusUntil,
}

type PersonSelect = {
  userId: string
  displayName: string
  directorTitle: string | null
  isAdmin: boolean
  isDirector: boolean
  isAuditor: boolean
  registrationStatus: string | null
  isActive: boolean
  statusEmoji: string | null
  statusText: string | null
  statusUntil: Date | null
}

function toPerson(r: PersonSelect): WorkPersonRow {
  return {
    user_id: r.userId,
    display_name: r.displayName?.trim() || '이름 없음',
    director_title: r.directorTitle?.trim() || null,
    is_admin: r.isAdmin,
    is_director: r.isDirector,
    is_auditor: r.isAuditor,
    registration_status: r.registrationStatus,
    is_active: r.isActive,
    status_emoji: r.statusEmoji,
    status_text: r.statusText,
    status_until: iso(r.statusUntil),
  }
}

/** 디렉터리 후보 전원(이름순). */
export async function listWorkPeople(): Promise<WorkPersonRow[]> {
  const rows = await db
    .select(personColumns)
    .from(memberProfiles)
    .leftJoin(workMemberPrefs, eq(workMemberPrefs.userId, memberProfiles.id))
    .where(
      or(
        and(
          eq(memberProfiles.registrationStatus, 'approved'),
          eq(memberProfiles.isActive, true),
          or(
            eq(memberProfiles.isDirector, true),
            eq(memberProfiles.isAdmin, true),
            eq(memberProfiles.isAuditor, true)
          )
        ),
        sql`${memberProfiles.id} in (select user_id from work_channel_members)`,
        sql`${memberProfiles.id} in (select author_id from work_messages where author_id is not null)`
      )
    )
  return rows.map(toPerson).sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko'))
}

/** id로 몇 명(멤버 추가·DM 상대 확인용). 없는 id는 결과에 없다 */
export async function getWorkPeople(userIds: string[]): Promise<Map<string, WorkPersonRow>> {
  const out = new Map<string, WorkPersonRow>()
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return out
  const rows = await db
    .select(personColumns)
    .from(memberProfiles)
    .leftJoin(workMemberPrefs, eq(workMemberPrefs.userId, memberProfiles.id))
    .where(inArray(memberProfiles.id, ids))
  for (const r of rows) out.set(r.userId, toPerson(r))
  return out
}

/** 표시 이름만(작성자 이름표·그룹 이름 나열) */
export async function getDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(userIds.filter(Boolean))]
  if (ids.length === 0) return out
  const rows = await db
    .select({ id: memberProfiles.id, name: memberProfiles.displayName })
    .from(memberProfiles)
    .where(inArray(memberProfiles.id, ids))
  for (const r of rows) out.set(r.id, r.name?.trim() || '이름 없음')
  return out
}
