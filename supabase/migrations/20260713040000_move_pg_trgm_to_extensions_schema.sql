-- pg_trgm을 public → extensions 스키마로 이동
--
-- 20260710230000에서 검색 인덱스를 만들며 `CREATE EXTENSION pg_trgm`을 기본
-- 스키마(public)에 설치해 Supabase security advisor의 extension_in_public WARN을
-- 새로 만들었다(2026-07-13 실측에서 확인). Supabase 권장대로 extensions 스키마로
-- 옮긴다.
--
-- 안전성: 기존 GIN 인덱스(idx_posts_title_trgm, idx_posts_content_trgm)는
-- gin_trgm_ops 연산자 클래스를 OID로 참조하므로 스키마 이동 후에도 그대로
-- 유효하다(재생성 불필요). 새 인덱스/쿼리에서 이름으로 참조할 때는 Supabase의
-- 기본 search_path에 extensions가 포함되어 있어 문제없다.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION pg_trgm SET SCHEMA extensions;
  END IF;
END $$;
