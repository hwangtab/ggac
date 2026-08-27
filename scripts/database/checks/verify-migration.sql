-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- ===========================================
-- 데이터베이스 마이그레이션 검증 스크립트
-- 실행일: 2024-12-XX
-- ===========================================
-- 이 스크립트를 Supabase SQL Editor에서 실행하여 마이그레이션 완료를 확인하세요.

-- 1. 테이블 구조 검증
SELECT '=== 1. 테이블 구조 검증 ===' as verification_step;

-- member_profiles 테이블 확장 필드 확인
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'member_profiles' 
    AND column_name IN ('artist_id', 'is_artist', 'artist_role')
ORDER BY column_name;

-- artists 테이블 구조 확인
SELECT 
    column_name, 
    data_type, 
    is_nullable, 
    column_default
FROM information_schema.columns 
WHERE table_name = 'artists'
ORDER BY ordinal_position;

-- 2. 데이터 무결성 검증
SELECT '=== 2. 데이터 무결성 검증 ===' as verification_step;

-- artists 테이블 레코드 수 확인 (12개 아티스트)
SELECT 
    'artists 테이블 총 레코드 수' as check_item,
    COUNT(*) as count,
    CASE 
        WHEN COUNT(*) = 12 THEN '✅ 정상'
        ELSE '❌ 오류: 12개가 아님'
    END as status
FROM artists;

-- 필수 필드 null 체크
SELECT 
    'artists 필수 필드 null 체크' as check_item,
    COUNT(*) as null_count,
    CASE 
        WHEN COUNT(*) = 0 THEN '✅ 정상'
        ELSE '❌ 오류: null 값 존재'
    END as status
FROM artists 
WHERE legacy_id IS NULL 
    OR slug IS NULL 
    OR name IS NULL 
    OR one_liner IS NULL 
    OR bio IS NULL;

-- 3. RLS 정책 확인
SELECT '=== 3. RLS 정책 확인 ===' as verification_step;

-- artists 테이블 RLS 정책 목록
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies 
WHERE tablename = 'artists'
ORDER BY policyname;

-- member_profiles 테이블 RLS 정책 확인
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies 
WHERE tablename = 'member_profiles'
ORDER BY policyname;

-- 4. 인덱스 및 제약조건 확인
SELECT '=== 4. 인덱스 및 제약조건 확인 ===' as verification_step;

-- artists 테이블 인덱스 확인
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'artists'
ORDER BY indexname;

-- 고유 제약조건 확인
SELECT 
    constraint_name,
    column_name
FROM information_schema.constraint_column_usage
WHERE table_name = 'artists'
    AND constraint_name LIKE '%unique%'
ORDER BY constraint_name;

-- 5. 함수 및 뷰 확인
SELECT '=== 5. 함수 및 뷰 확인 ===' as verification_step;

-- artist_member_relations 뷰 확인
SELECT 
    table_name,
    view_definition
FROM information_schema.views 
WHERE table_name = 'artist_member_relations';

-- get_user_artist_info 함수 확인
SELECT 
    routine_name,
    routine_type,
    data_type
FROM information_schema.routines 
WHERE routine_name = 'get_user_artist_info';

-- 6. 샘플 데이터 검증
SELECT '=== 6. 샘플 데이터 검증 ===' as verification_step;

-- 각 아티스트의 기본 정보 확인
SELECT 
    legacy_id,
    slug,
    name,
    array_length(category, 1) as category_count,
    template_type,
    CASE 
        WHEN profile_photo_url IS NOT NULL THEN '✅'
        ELSE '❌'
    END as has_image,
    CASE 
        WHEN LENGTH(bio) > 50 THEN '✅'
        ELSE '❌'
    END as has_bio
FROM artists 
ORDER BY legacy_id;

-- JSON 필드 데이터 유효성 확인
SELECT 
    legacy_id,
    name,
    jsonb_array_length(portfolio_links) as portfolio_count,
    jsonb_array_length(youtube_videos) as youtube_count
FROM artists 
WHERE portfolio_links IS NOT NULL 
    OR youtube_videos IS NOT NULL
ORDER BY legacy_id;

-- 7. 아티스트-멤버 관계 테스트 (샘플)
SELECT '=== 7. 아티스트-멤버 관계 테스트 ===' as verification_step;

-- 테스트용 멤버 프로필 생성 및 아티스트 연결 확인
-- (실제 사용자가 있는 경우에만 실행됩니다)
SELECT 
    COUNT(*) as member_count,
    COUNT(CASE WHEN is_artist = true THEN 1 END) as artist_member_count,
    COUNT(CASE WHEN artist_id IS NOT NULL THEN 1 END) as linked_member_count
FROM member_profiles;

-- 8. 성능 확인
SELECT '=== 8. 성능 확인 ===' as verification_step;

-- 테이블 크기 확인
SELECT 
    schemaname,
    tablename,
    attname as column_name,
    n_distinct,
    correlation
FROM pg_stats 
WHERE tablename IN ('artists', 'member_profiles')
    AND attname IN ('legacy_id', 'slug', 'artist_id')
ORDER BY tablename, attname;

-- 인덱스 사용률 확인 (간단한 쿼리 실행)
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM artists WHERE slug = 'sabbaha';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM artists WHERE legacy_id = 'artist-001';

-- 9. 최종 검증 요약
SELECT '=== 9. 최종 검증 요약 ===' as verification_step;

-- 전체 마이그레이션 상태 요약
WITH migration_checks AS (
    SELECT 
        'artists_table_exists' as check_name,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'artists') 
             THEN true ELSE false END as passed
    UNION ALL
    SELECT 
        'artists_record_count',
        CASE WHEN (SELECT COUNT(*) FROM artists) = 12 THEN true ELSE false END
    UNION ALL
    SELECT 
        'member_profiles_extended',
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'member_profiles' AND column_name = 'artist_id') 
             THEN true ELSE false END
    UNION ALL
    SELECT 
        'rls_policies_applied',
        CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'artists') 
             THEN true ELSE false END
    UNION ALL
    SELECT 
        'indexes_created',
        CASE WHEN EXISTS (SELECT 1 FROM pg_indexes 
                         WHERE tablename = 'artists' AND indexname LIKE '%slug%') 
             THEN true ELSE false END
)
SELECT 
    check_name,
    passed,
    CASE WHEN passed THEN '✅ 통과' ELSE '❌ 실패' END as status
FROM migration_checks
ORDER BY check_name;

-- 마이그레이션 완료 확인 메시지
SELECT 
    CASE 
        WHEN (SELECT COUNT(*) FROM artists) = 12 
             AND EXISTS (SELECT 1 FROM information_schema.columns 
                        WHERE table_name = 'member_profiles' AND column_name = 'artist_id')
             AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'artists')
        THEN '🎉 마이그레이션이 성공적으로 완료되었습니다!'
        ELSE '⚠️  마이그레이션에 문제가 있습니다. 위의 체크 결과를 확인하세요.'
    END as migration_status;

-- ===========================================
-- 검증 완료
-- 모든 쿼리 결과가 정상이면 마이그레이션이 성공적으로 완료된 것입니다.
-- ===========================================
