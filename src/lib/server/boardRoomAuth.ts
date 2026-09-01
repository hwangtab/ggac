import { NextResponse } from 'next/server'
import {
  canAccessBoardRoom,
  canReadBoardRecords,
  getSessionContext,
  isApprovedActiveAdmin,
} from '@/lib/server/authz'
import { listProfiles } from '@/db/queries/profiles'

export type BoardAuthSuccess = {
  user: { id: string }
  isAdmin: boolean
  isAuditor: boolean
}

/**
 * 열람 전용 접근의 결과. `isBoardMember`가 false면 **조합원 자격으로 읽고 있는
 * 것**이라, 호출부는 이사회 전용 정보(일정 투표·출석·정족수)를 응답에서 빼야
 * 한다. 이 플래그를 보지 않고 그대로 응답하면 열람 개방이 곧 이사회 내부
 * 정보 개방이 된다.
 */
export type BoardReadAuthSuccess = BoardAuthSuccess & { isBoardMember: boolean }

/**
 * 이사회 전용 API 권한 헬퍼.
 * - 미인증: 401
 * - 프로필 조회 실패: 500
 * - (is_director=false AND is_admin=false AND is_auditor=false) / 미승인 / 비활성: 403
 * 성공 시 user, isAdmin, isAuditor 반환.
 * 감사(is_auditor)는 감사 업무를 위해 이사회에 접근하나 정족수에는 산입되지 않는다.
 */
export async function requireBoardMember(): Promise<BoardAuthSuccess | NextResponse> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  if (session.profileError || !session.profile) {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }

  if (!canAccessBoardRoom(session.profile)) {
    return NextResponse.json({ error: '이사회 접근 권한이 없습니다.' }, { status: 403 })
  }

  return {
    user: { id: session.user.id },
    isAdmin: isApprovedActiveAdmin(session.profile),
    isAuditor: session.profile.is_auditor === true,
  }
}

/**
 * 이사회 기록(회의 목록·안건·토론·회의록) **읽기** 전용 게이트.
 * 승인·활성 조합원이면 통과하고, 이사·감사·관리자인지는 `isBoardMember`로 알린다.
 *
 * 쓰기 라우트에는 절대 쓰지 마라 — 안건 작성·수정, 일정 투표, 출석 체크,
 * 서류함, 총회 자료는 전부 `requireBoardMember`(이사·감사·관리자)를 그대로
 * 유지한다. 안건 토론 쓰기만 조합원에게 열려 있고, 그건 이 게이트가 아니라
 * `requireBoardDiscussionWriter`가 판정한다.
 */
export async function requireBoardRecordReader(): Promise<BoardReadAuthSuccess | NextResponse> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  if (session.profileError || !session.profile) {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }

  if (!canReadBoardRecords(session.profile)) {
    return NextResponse.json({ error: '이사회 기록 열람 권한이 없습니다.' }, { status: 403 })
  }

  return {
    user: { id: session.user.id },
    isAdmin: isApprovedActiveAdmin(session.profile),
    isAuditor: session.profile.is_auditor === true,
    isBoardMember: canAccessBoardRoom(session.profile),
  }
}

/**
 * 안건 토론 **쓰기** 게이트. 승인·활성 조합원이면 통과한다 —
 * `requireBoardRecordReader`와 판정은 같고 이름과 용도만 다르다.
 *
 * 왜 읽기 게이트를 그대로 쓰지 않는가: `assert-runtime-risks.mjs`가
 * "`requireBoardRecordReader()`는 GET 전용"을 정적으로 못박고 있고, 그 규칙은
 * 계속 필요하다 — 없으면 일정 투표·출석·서류함 같은 이사회 전용 쓰기가
 * 실수로 조합원 전체에게 열린다. 예외를 이름으로 만들어 두면 가드는 이
 * 게이트가 **어느 파일에 쓰였는지**까지 확인할 수 있다.
 *
 * 토론에만 쓴다. 안건 작성·수정·삭제, 회의록, 일정 투표, 출석, 서류함은
 * 전부 `requireBoardMember`(이사·감사·관리자)를 그대로 유지한다.
 */
export async function requireBoardDiscussionWriter(): Promise<BoardReadAuthSuccess | NextResponse> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  if (session.profileError || !session.profile) {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }

  if (!canReadBoardRecords(session.profile)) {
    return NextResponse.json({ error: '승인된 조합원만 참여할 수 있습니다.' }, { status: 403 })
  }

  return {
    user: { id: session.user.id },
    isAdmin: isApprovedActiveAdmin(session.profile),
    isAuditor: session.profile.is_auditor === true,
    isBoardMember: canAccessBoardRoom(session.profile),
  }
}

/** 관리자 전용 동작(회의 생성·확정·출석 체크 등) 가드 */
export function requireBoardAdmin(auth: BoardAuthSuccess): NextResponse | null {
  if (!auth.isAdmin) {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
  }
  return null
}

/**
 * `listProfiles`는 상태 필터만 지원하고 `is_director`/`is_active`는 모른다
 * (쿼리 모듈은 권한을 모른다 — CLAUDE.md/브리프 경계). 회원이 23명뿐이라
 * "승인된 전체"를 한 번에 받아 메모리에서 걸러도 N+1이 아니다. 이 숫자를
 * 넘길 걱정이 생기면(회원 수천 명대) 그때 `listProfiles`에 필터를 추가한다.
 */
const APPROVED_ROSTER_PAGE_LIMIT = 10000

type RosterRow = { id: string; display_name: string; director_title: string | null }

/**
 * 명단을 이름 오름차순으로 고정한다(리뷰 라운드 1 Minor 3). 전환 전
 * Supabase 쿼리에는 `ORDER BY`가 없어 정렬 순서가 보장된 적이 없었지만,
 * 지금은 `listProfiles`가 `created_at DESC`를 강제해서 아무 정렬도 안 하면
 * 이사회 명단이 "가입 최신순"으로 보이게 된다 — 정족수 확인용으로 사람이
 * 읽는 명단이라 이름순이 자연스럽다. 명시적으로 정렬한다는 사실 자체가
 * 중요해서 별도 함수로 뺐다(호출부에서 `.map(...)` 뒤에 슬쩍 끼워 넣으면
 * 다음에 지워지기 쉽다).
 */
function sortByDisplayNameAsc(rows: RosterRow[]): RosterRow[] {
  return [...rows].sort((a, b) => a.display_name.localeCompare(b.display_name, 'ko'))
}

/** 재적 이사 명단(승인·활성 + is_director). 정족수 산정 기준이 된다. */
export async function getDirectorRoster() {
  const { rows } = await listProfiles({
    status: 'approved',
    limit: APPROVED_ROSTER_PAGE_LIMIT,
    offset: 0,
  })
  return sortByDisplayNameAsc(
    rows
      .filter(row => row.is_director && row.is_active)
      .map(row => ({
        id: row.id,
        display_name: row.display_name,
        director_title: row.director_title,
      }))
  )
}

/**
 * 감사 명단(승인·활성 + is_auditor).
 * 이사회 참석·기록 대상이지만 정족수에는 산입되지 않는다.
 */
export async function getAuditorRoster() {
  const { rows } = await listProfiles({
    status: 'approved',
    limit: APPROVED_ROSTER_PAGE_LIMIT,
    offset: 0,
  })
  return sortByDisplayNameAsc(
    rows
      .filter(row => row.is_auditor && row.is_active)
      .map(row => ({
        id: row.id,
        display_name: row.display_name,
        director_title: row.director_title,
      }))
  )
}
