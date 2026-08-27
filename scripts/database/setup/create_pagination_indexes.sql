-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- 페이지네이션 성능 최적화를 위한 인덱스 생성
-- 실행 방법: Supabase Dashboard > SQL Editor에서 실행

-- 1. 카테고리별 + 생성일 기준 정렬 최적화
-- (카테고리 필터링 + 최신순 정렬에 최적화)
CREATE INDEX IF NOT EXISTS idx_posts_category_created_at 
ON posts(category, created_at DESC) 
WHERE is_deleted = false;

-- 2. 전체 게시글 최신순 조회 최적화
-- (기본 게시판 목록 조회에 최적화)
CREATE INDEX IF NOT EXISTS idx_posts_created_at_active 
ON posts(created_at DESC) 
WHERE is_deleted = false;

-- 3. 공지사항 우선 정렬 최적화
-- (공지 + 일반글 분리 조회에 최적화)
CREATE INDEX IF NOT EXISTS idx_posts_category_priority 
ON posts(
  (CASE WHEN category = '공지' THEN 0 ELSE 1 END),
  created_at DESC
) 
WHERE is_deleted = false;

-- 4. 작성자 기준 게시글 조회 최적화 (향후 마이페이지용)
CREATE INDEX IF NOT EXISTS idx_posts_author_created_at 
ON posts(author_id, created_at DESC) 
WHERE is_deleted = false;

-- 인덱스 생성 확인
SELECT schemaname, tablename, indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'posts' 
AND indexname LIKE 'idx_posts_%'
ORDER BY indexname;