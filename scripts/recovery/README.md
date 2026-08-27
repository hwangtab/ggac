복구 가이드 (무백업, 2025-09-10 이전)

> ## ⛔ 이 절차는 Supabase 시절 것이다 — 그대로 실행하지 마라 (2026-08-27 갱신)
>
> 2026-08-26 Turso 컷오버로 **운영 데이터의 권위는 Turso(SQLite)** 로 옮겨갔고,
> 앱은 Supabase를 어디에서도 읽지 않는다. 이 디렉터리의 SQL과 Node 스크립트는
> 전부 **Supabase(PostgreSQL)** 를 대상으로 한다.
>
> - `*.sql`은 psql/Supabase SQL Editor 전용이고 Postgres 문법(`DO $$`,
>   `auth.users`, RLS)을 쓴다 — Turso에는 옮겨 붙지 않는다.
> - `backfill_posts_from_wayback.js`는 **무해화돼 실행하면 즉시 중단된다.**
> - 아래 명령을 그대로 실행하면 **버려진 Supabase 사본만 바뀌고 운영 화면은
>   그대로다.** 조용한 성공이 제일 나쁘다.
>
> 지금 데이터를 실제로 고쳐야 한다면 대상은 Turso다:
> `turso db shell ggac-prod`, 쿼리 계층 `src/db/queries/`, 스키마
> `src/db/schema/`, 운영 절차 `scripts/turso/README.md`.
>
> 아래 내용은 **당시에 무엇을 했는지의 기록**으로만 남긴다.

개요

- 백업이 없는 상태에서 user_activities 로그와 외부 캐시를 활용해 데이터(회원/게시글/댓글/좋아요)를 최대한 복원했습니다.

1. 1차 복구(로그 기반: 스키마 골간 + 메타데이터) — ⛔ 당시 절차

- 당시 실행: psql로 `scripts/recovery/recover_pre_20250910.sql` 적용
- 효과:
  - member_profiles: auth.users와 활동 로그 기준으로 최소 프로필 복구 + 활동자 승인 처리(휴리스틱)
  - posts: 제목/카테고리/작성자/작성시간 복구, 본문은 자리표시자
  - comments: 댓글 식별자/작성자/작성시간 복구, 본문은 자리표시자
  - post_likes: (user,post) 최종 상태 재생성, like_count 재계산
  - view_count: 로그인 사용자 page_viewed 로그 기준 집계(있을 경우)

2. 2차 복구(외부 스냅샷: 본문/댓글 내용 보강) — ⛔ 당시 절차

- 당시 실행: `node scripts/recovery/backfill_posts_from_wayback.js [--dry]`
- 동작: Wayback 스냅샷에서 /board/[id] 페이지의 embedded JSON(initial-post-data)을 파싱해
  posts.content / comments.content 를 보강 업데이트
- **지금은 실행해도 즉시 중단된다.** 본문의 권위는 Turso `posts`·`comments`이므로
  같은 일이 다시 필요하면 Wayback 파싱 로직은 재사용하되 DB 접근부를
  `@libsql/client`로 바꿔 새로 써야 한다(`src/db/queries/posts.ts`·`comments.ts` 참고).

3. 관리자 권한 부여 — ⚠️ 아래 옛 안내는 **틀렸다**

옛 안내는 Postgres에 `select public.make_first_admin(...)` /
`update member_profiles set is_admin=true where email in (...)`를 실행하라고
했다. **그 RPC와 그 UPDATE는 Supabase에만 있고, 실행해도 관리자 권한은 생기지
않는다** — 조용히 아무 일도 일어나지 않는다.

지금 관리자 권한의 권위는 Turso `member_profiles.is_admin`이다
(`src/db/schema/identity.ts`). **`is_admin`을 바꾸는 API 라우트는 없다** —
`/api/admin/members/flags`는 이사·감사 플래그(`is_director`/`is_auditor`)만
다룬다. 따라서 부여는 DB 직접 수정뿐이다:

```bash
turso db shell ggac-prod "select id, email, is_admin from member_profiles where email = '<이메일>'"
turso db shell ggac-prod "update member_profiles set is_admin = 1 where email = '<이메일>'"
```

운영 DB에 직접 쓰는 명령이다. 대상을 먼저 `select`로 확인하고, `is_admin`은
SQLite에서 0/1 정수다(`true`가 아니다).

주의사항

- 이 디렉터리는 더 이상 재실행 대상이 아니다. 재실행 안전성(idempotent)은 당시 Supabase 기준이었다.
- Wayback/검색엔진 캐시는 일부 문서만 존재할 수 있음(100% 복원은 보장 불가).
