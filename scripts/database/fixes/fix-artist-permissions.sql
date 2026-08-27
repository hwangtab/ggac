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
-- 황경하님 아티스트 권한 설정 완료
-- member_profiles 테이블에서 필수 필드 업데이트
-- ===========================================

-- 현재 황경하님의 member_profiles 상태 확인
SELECT 
  id,
  display_name,
  email,
  artist_id,
  is_artist,
  artist_role,
  registration_status,
  is_active,
  is_admin
FROM member_profiles 
WHERE artist_id = 'artist-008' OR email LIKE '%hwangtab%' OR display_name LIKE '%황경하%'
ORDER BY created_at DESC;

-- 황경하님의 아티스트 권한 완전 설정
-- (실제 사용자 ID를 확인한 후 WHERE 조건을 적절히 수정해야 함)
UPDATE member_profiles 
SET 
  is_artist = true,
  artist_role = 'owner',
  registration_status = 'approved',
  is_active = true,
  updated_at = NOW()
WHERE artist_id = 'artist-008';

-- 만약 위 쿼리로 업데이트되지 않는다면, 이메일 기준으로 업데이트
-- UPDATE member_profiles 
-- SET 
--   artist_id = 'artist-008',
--   is_artist = true,
--   artist_role = 'owner',
--   registration_status = 'approved',
--   is_active = true,
--   updated_at = NOW()
-- WHERE email = 'hwangtab@gmail.com';

-- 업데이트 후 상태 재확인
SELECT 
  id,
  display_name,
  email,
  artist_id,
  is_artist,
  artist_role,
  registration_status,
  is_active,
  CASE 
    WHEN is_artist = true AND artist_id = 'artist-008' AND registration_status = 'approved' AND is_active = true
    THEN '✅ 권한 설정 완료'
    ELSE '❌ 권한 설정 필요'
  END as permission_status
FROM member_profiles 
WHERE artist_id = 'artist-008' OR email LIKE '%hwangtab%' OR display_name LIKE '%황경하%'
ORDER BY created_at DESC;

-- 아티스트 권한 체크 시뮬레이션 (PermissionCheck 로직)
SELECT 
  mp.id,
  mp.display_name,
  mp.registration_status = 'approved' as is_approved,
  mp.is_active as is_active,
  mp.is_artist as is_artist,
  mp.artist_id IS NOT NULL as has_artist_id,
  (mp.registration_status = 'approved' AND mp.is_active = true AND mp.is_artist = true AND mp.artist_id IS NOT NULL) as has_artist_access,
  CASE 
    WHEN (mp.registration_status = 'approved' AND mp.is_active = true AND mp.is_artist = true AND mp.artist_id IS NOT NULL)
    THEN '🎉 마이페이지 아티스트 페이지 접근 가능!'
    ELSE '⚠️ 아티스트 권한 부족'
  END as access_result
FROM member_profiles mp
WHERE mp.artist_id = 'artist-008' OR mp.email LIKE '%hwangtab%' OR mp.display_name LIKE '%황경하%';

-- 성공 메시지
SELECT '✅ 황경하님의 아티스트 권한 설정이 완료되었습니다!' as result;