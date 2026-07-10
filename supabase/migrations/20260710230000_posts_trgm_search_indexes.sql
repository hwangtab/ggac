-- 백로그 (2026-07-10 전수감사 API Medium 16): 게시글 검색 인덱스
--
-- posts/public·admin/posts 검색이 title/content에 ilike '%…%'를 사용하는데
-- 지원 인덱스가 없어 본문 전체 seq scan이었다. 현재 규모(수십 행)에서는
-- 무해하지만 데이터 성장 시 검색 지연이 급증하므로 pg_trgm GIN 인덱스를
-- 선제 적용한다. (표현식 인덱스는 라우트의 `content ilike` 쿼리와 매칭되지
-- 않으므로 컬럼 인덱스를 사용 — 현 규모에서 인덱스 크기 부담 없음.)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_posts_title_trgm
  ON public.posts USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_posts_content_trgm
  ON public.posts USING gin (content gin_trgm_ops);
