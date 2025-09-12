복구 가이드 (무백업, 2025-09-10 이전)

개요
- 백업이 없는 상태에서 user_activities 로그와 외부 캐시를 활용해 데이터(회원/게시글/댓글/좋아요)를 최대한 복원합니다.

1) 1차 복구(로그 기반: 스키마 골간 + 메타데이터)
- 실행: psql로 아래 SQL 적용
  - scripts/recovery/recover_pre_20250910.sql
- 효과:
  - member_profiles: auth.users와 활동 로그 기준으로 최소 프로필 복구 + 활동자 승인 처리(휴리스틱)
  - posts: 제목/카테고리/작성자/작성시간 복구, 본문은 자리표시자
  - comments: 댓글 식별자/작성자/작성시간 복구, 본문은 자리표시자
  - post_likes: (user,post) 최종 상태 재생성, like_count 재계산
  - view_count: 로그인 사용자 page_viewed 로그 기준 집계(있을 경우)

2) 2차 복구(외부 스냅샷: 본문/댓글 내용 보강)
- 실행: Node.js 스크립트 (Wayback Machine)
  - node scripts/recovery/backfill_posts_from_wayback.js --dry  # 시뮬레이션
  - node scripts/recovery/backfill_posts_from_wayback.js       # 실제 업데이트
- 요구사항: .env.local에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 설정
- 동작: Wayback 스냅샷에서 /board/[id] 페이지의 embedded JSON(initial-post-data)을 파싱해
        posts.content / comments.content 를 보강 업데이트

3) 관리자 복구
- 첫 관리자 지정: (이메일 확인 후 1회 실행)
  select public.make_first_admin('<admin_email>');
- 추가 관리자는 수동 업데이트 필요: update member_profiles set is_admin=true where email in (...);

주의사항
- 스크립트는 idempotent(재실행 안전)를 목표로 작성되었지만, 적용 전/후에 psql로 현황 확인 권장
- Wayback/검색엔진 캐시는 일부 문서만 존재할 수 있음(100% 복원은 보장 불가)

