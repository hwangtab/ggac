-- board_* 8테이블은 전부 service_role 서버 라우트(src/app/api/board-room/**,
-- src/app/api/**/event-applications/**)로만 접근한다. 클라이언트(anon/authenticated)
-- 직접 조회는 없다.
--
-- 현재 상태: RLS는 ON이나 정책 0(기본 거부)이면서 anon·authenticated에 CRUD
-- GRANT가 열려 있어 RLS가 유일 방어선이다(허용 정책을 하나라도 잘못 추가하거나
-- RLS가 꺼지면 즉시 anon CRUD 노출). event_applications는 신청자 개인정보를 담아
-- 특히 민감하다.
--
-- 조치: anon·authenticated의 직접 접근 권한을 회수(REVOKE ALL)해 서버 service_role
-- 경유 아키텍처와 일치시킨다. service_role은 회수 대상이 아니므로 서버 호출은 불변.
-- RLS는 ON 유지(방어심층). 정책 추가가 아니라 GRANT 회수만 수행한다.

REVOKE ALL ON public.board_agendas FROM anon, authenticated;
REVOKE ALL ON public.board_documents FROM anon, authenticated;
REVOKE ALL ON public.board_meeting_attendees FROM anon, authenticated;
REVOKE ALL ON public.board_meeting_date_options FROM anon, authenticated;
REVOKE ALL ON public.board_meeting_date_votes FROM anon, authenticated;
REVOKE ALL ON public.board_meetings FROM anon, authenticated;
REVOKE ALL ON public.board_minutes FROM anon, authenticated;
REVOKE ALL ON public.event_applications FROM anon, authenticated;
