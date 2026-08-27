-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- 빠른 마이그레이션 검증 스크립트
-- Supabase SQL Editor에서 실행하여 핵심 사항만 빠르게 확인

-- 1. 기본 구조 확인
SELECT 
    '테이블 존재 여부' as 체크항목,
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'artists') 
         THEN '✅ artists 테이블 존재' 
         ELSE '❌ artists 테이블 없음' END as 결과
UNION ALL
SELECT 
    'member_profiles 확장',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns 
                     WHERE table_name = 'member_profiles' AND column_name = 'artist_id') 
         THEN '✅ artist_id 컬럼 존재' 
         ELSE '❌ artist_id 컬럼 없음' END;

-- 2. 데이터 확인
SELECT 
    'artists 데이터' as 체크항목,
    CONCAT(COUNT(*), '개 레코드 (예상: 12개)') as 결과,
    CASE WHEN COUNT(*) = 12 THEN '✅' ELSE '❌' END as 상태
FROM artists;

-- 3. 샘플 아티스트 데이터 확인
SELECT 
    legacy_id,
    slug,
    name,
    template_type
FROM artists 
LIMIT 5;

-- 4. RLS 정책 확인
SELECT 
    COUNT(*) as 정책수,
    CASE WHEN COUNT(*) > 0 THEN '✅ RLS 정책 적용됨' ELSE '❌ RLS 정책 없음' END as 상태
FROM pg_policies 
WHERE tablename = 'artists';

-- 최종 결과
SELECT 
    CASE 
        WHEN (SELECT COUNT(*) FROM artists) = 12 
             AND EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_name = 'member_profiles' AND column_name = 'artist_id')
        THEN '🎉 마이그레이션 성공!'
        ELSE '⚠️ 마이그레이션 확인 필요'
    END as 최종결과;