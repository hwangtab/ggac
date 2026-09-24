/**
 * 조합원 목록 한 줄이 브라우저로 나갈 때의 모양.
 *
 * 이 파일이 따로 있는 이유는 하나다 — **목록에 계좌가 다시 실리는 회귀를
 * 테스트가 실제 응답 모양으로 못박기 위해서다.** 라우트(`src/app/api/admin/
 * members/route.ts`)는 `@/` 별칭을 쓰므로 `node --test`가 import할 수 없고,
 * 소스 문자열을 훑는 검사는 도달 가능성을 보지 않는다(CLAUDE.md의 정적 가드
 * 경고). 그래서 응답 한 줄을 만드는 일만 여기로 떼어 내고, 테스트는 실제
 * SQLite에서 읽은 행을 이 함수에 통과시켜 결과를 본다.
 *
 * ## 계좌는 목록에 싣지 않는다
 *
 * 예전에는 `bank_name`·`account_number`·`account_holder`가 목록 모든 줄에
 * 들어 있었다. 관리자가 조합원 관리를 한 번 열면 **전 조합원의 계좌번호가
 * 한 응답에 실려** 브라우저에 깔렸고, 아무 흔적도 남지 않았다. 목록이 계좌로
 * 하는 일은 없다 — 화면은 정렬도 검색도 계좌로 하지 않고, 사람이 계좌를
 * 보는 것은 한 사람에게 돈을 보내려 할 때뿐이다.
 *
 * 그래서 목록은 **등록됐는가의 참·거짓**만 준다(`bank_account_registered`).
 * 값은 조합원 한 명을 지목해 따로 달라고 했을 때만 나가고, 그 자리는
 * `GET /api/admin/members/[id]/account` 하나다 — 정산 패널이 개설자 계좌를
 * 내보내는 것과 같은 모양이다(내보내기 전 await 기록 + 실패 시 보안 이벤트).
 *
 * 등록 판정은 정산 쪽과 **같은 함수**를 쓴다. 같은 세 컬럼을 두고 "등록됐다"의
 * 뜻이 화면마다 달라지면, 한쪽에서 "있다"고 한 계좌가 다른 쪽에서는 비어 보인다.
 */

import type { ProfileRow } from '../../db/queries/profiles.ts'
import { isPayoutAccountRegistered } from '../funding/payoutAccount.ts'

/**
 * 목록 응답 한 줄. 프런트 `Member` 타입(`src/app/[locale]/admin/members/
 * page.tsx`)이 이 모양을 그대로 읽는다.
 */
export interface MemberListRow {
  id: string
  display_name: string
  email: string
  phone_number: string | null
  real_name: string | null
  created_at: string
  updated_at: string
  registration_status: ProfileRow['registration_status']
  is_active: boolean
  is_admin: boolean
  is_director: boolean
  director_title: string | null
  is_auditor: boolean
  is_artist: boolean
  artist_id: string | null
  monthly_fee: number | null
  /**
   * 은행·계좌번호가 **둘 다** 등록돼 있는가. 값이 아니라 참·거짓이다 —
   * 화면은 이 값으로 "계좌 보기" 버튼을 열지 말지만 정한다.
   */
  bank_account_registered: boolean
  last_login_at: string | null
  is_suspended: boolean
  suspension_reason: string | null
  suspension_until: string | null
  profile_completeness_score: number
  verification_status: ProfileRow['verification_status']
  membership_type: ProfileRow['membership_type']
  engagement_score: number
  approved_by: string | null
  rejected_by: string | null
  /**
   * 탈퇴 신청 여부 판단용 — `registration_status`는 신청 중에도 `'approved'`로
   * 남으므로(0011 참조) 화면이 이 필드로 신청 상태를 구분한다.
   */
  withdrawal_requested_at: string | null
}

/**
 * `ProfileRow`(34개 컬럼 전부)에서 목록이 쓰는 것만 골라 낸다.
 *
 * **고르는 방식이 중요하다.** 전체를 펼쳐 놓고 몇 개를 지우는(`delete`, 구조
 * 분해 rest) 방식이면 컬럼이 새로 생길 때마다 목록에 조용히 실린다 —
 * 계좌가 실려 있던 것도 그런 경위였다. 여기서는 실을 것을 하나씩 적는다.
 */
export function toMemberListRow(row: ProfileRow): MemberListRow {
  return {
    id: row.id,
    display_name: row.display_name,
    email: row.email,
    phone_number: row.phone_number,
    real_name: row.real_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    registration_status: row.registration_status,
    is_active: row.is_active,
    is_admin: row.is_admin,
    is_director: row.is_director,
    director_title: row.director_title,
    is_auditor: row.is_auditor,
    is_artist: row.is_artist,
    artist_id: row.artist_id,
    monthly_fee: row.monthly_fee,
    bank_account_registered: isPayoutAccountRegistered({
      bank_name: row.bank_name,
      account_number: row.account_number,
      account_holder: row.account_holder,
    }),
    last_login_at: row.last_login_at,
    is_suspended: row.is_suspended,
    suspension_reason: row.suspension_reason,
    suspension_until: row.suspension_until,
    profile_completeness_score: row.profile_completeness_score,
    verification_status: row.verification_status,
    membership_type: row.membership_type,
    engagement_score: row.engagement_score,
    approved_by: row.approved_by,
    rejected_by: row.rejected_by,
    withdrawal_requested_at: row.withdrawal_requested_at,
  }
}
