-- 방어심층(defense-in-depth): board_* 8테이블에 역할별 RLS 정책 추가
--
-- 배경
--   3단계에서 anon·authenticated의 테이블 GRANT를 회수해 클라이언트 직접
--   접근을 1차 차단했다(운영 반영 완료). 현재 RLS는 ON이나 정책이 0이라
--   기본 거부 상태이며, 모든 접근은 service_role 서버 경유로만 이뤄진다.
--
-- 이 마이그레이션의 목적(2차 방어)
--   GRANT 회수는 그대로 유지한 채, 역할(is_director / is_auditor / is_admin)
--   기반 행 필터 정책을 추가한다. 미래에 누군가 실수로 authenticated에게
--   GRANT를 부여하더라도, 역할이 없는 authenticated 사용자는 단 한 행도
--   보거나 쓸 수 없다.
--
-- 불변 보장
--   * service_role은 BYPASSRLS라 아래 정책과 무관하게 전 접근 가능 →
--     서버(service_role 클라이언트) 경유 동작은 전혀 바뀌지 않는다.
--   * 이 파일은 3단계의 GRANT REVOKE를 되돌리지 않는다(GRANT 문 없음).
--   * 정책 대상은 TO authenticated 뿐이다(anon 정책 없음).
--   * RLS는 이미 ENABLE 되어 있어 재실행하지 않는다.
--
-- 권한 모델(src/lib/server/authz.ts, boardRoomAuth.ts 기준)
--   canAccessBoardRoom = approved AND active AND (is_director OR is_admin OR is_auditor)
--     → board_* 이사회 자료의 열람 자격. requireBoardMember가 사용.
--   isApprovedActiveAdmin = approved AND active AND is_admin
--     → 관리자 전용 동작(회의 생성·확정·출석 등). requireBoardAdmin가 사용.
--   member_profiles.id = auth.uid() (authz의 .eq('id', user.id))
--
-- 정책 설계 근거
--   board_* 7테이블: RLS 정책은 "이사회 접근 경계"라는 굵은 경계만 강제한다.
--     열람과 변이 모두 board 멤버(위 canAccessBoardRoom 조건)로 게이트한다.
--     app 계층은 requireBoardMember(멤버)로 agendas/minutes/documents/
--     date_votes 변이를 허용하고 requireBoardAdmin(관리자)로 meetings/
--     attendees 등 일부를 좁힌다 — 이 세밀한 admin-vs-member 구분은
--     애플리케이션이 단일 진실원으로 계속 담당한다. RLS는 그보다 넓은 board
--     멤버 경계만 방어선으로 둔다(현재는 service_role 경유라 어차피 정책이
--     작동하지 않으며, GRANT가 복구되는 가상 상황에서 역할 없는 사용자만
--     차단하면 되기 때문).
--   event_applications: 신청자 개인정보라 더 엄격하게 is_admin만 허용한다.
--     공개 신청 폼(POST /api/event-applications)은 비로그인 사용자가
--     service_role 경유로 INSERT하므로 이 정책의 영향을 받지 않는다.

-- 공통 조건식 (참고)
--   board 멤버:  EXISTS mp WHERE mp.id = auth.uid()
--                AND mp.registration_status = 'approved' AND mp.is_active = true
--                AND (mp.is_director OR mp.is_admin OR mp.is_auditor)
--   관리자:      위와 동일하되 (mp.is_admin = true)

-- =========================================================================
-- board_agendas
-- =========================================================================
DROP POLICY IF EXISTS board_agendas_board_member_all ON public.board_agendas;
CREATE POLICY board_agendas_board_member_all ON public.board_agendas
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  );

-- =========================================================================
-- board_documents
-- =========================================================================
DROP POLICY IF EXISTS board_documents_board_member_all ON public.board_documents;
CREATE POLICY board_documents_board_member_all ON public.board_documents
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  );

-- =========================================================================
-- board_meeting_attendees
-- =========================================================================
DROP POLICY IF EXISTS board_meeting_attendees_board_member_all ON public.board_meeting_attendees;
CREATE POLICY board_meeting_attendees_board_member_all ON public.board_meeting_attendees
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  );

-- =========================================================================
-- board_meeting_date_options
-- =========================================================================
DROP POLICY IF EXISTS board_meeting_date_options_board_member_all ON public.board_meeting_date_options;
CREATE POLICY board_meeting_date_options_board_member_all ON public.board_meeting_date_options
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  );

-- =========================================================================
-- board_meeting_date_votes
-- =========================================================================
DROP POLICY IF EXISTS board_meeting_date_votes_board_member_all ON public.board_meeting_date_votes;
CREATE POLICY board_meeting_date_votes_board_member_all ON public.board_meeting_date_votes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  );

-- =========================================================================
-- board_meetings
-- =========================================================================
DROP POLICY IF EXISTS board_meetings_board_member_all ON public.board_meetings;
CREATE POLICY board_meetings_board_member_all ON public.board_meetings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  );

-- =========================================================================
-- board_minutes
-- =========================================================================
DROP POLICY IF EXISTS board_minutes_board_member_all ON public.board_minutes;
CREATE POLICY board_minutes_board_member_all ON public.board_minutes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND (mp.is_director = true OR mp.is_admin = true OR mp.is_auditor = true)
    )
  );

-- =========================================================================
-- event_applications (개인정보 — 관리자 전용, 더 엄격)
--   공개 신청 INSERT는 비로그인 사용자가 service_role 경유로 처리 → 영향 없음.
-- =========================================================================
DROP POLICY IF EXISTS event_applications_admin_all ON public.event_applications;
CREATE POLICY event_applications_admin_all ON public.event_applications
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND mp.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles mp
      WHERE mp.id = auth.uid()
        AND mp.registration_status = 'approved'
        AND mp.is_active = true
        AND mp.is_admin = true
    )
  );
