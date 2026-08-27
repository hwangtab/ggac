-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- 프로필 사진 Storage bucket 수동 생성 스크립트
-- Supabase Dashboard → SQL Editor에서 실행

-- 1. profiles bucket 생성
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profiles', 
  'profiles', 
  true,  -- 공개 버킷 (프로필 사진은 공개)
  2097152, -- 2MB 제한
  ARRAY[
    'image/jpeg', 
    'image/png', 
    'image/webp',
    'image/gif'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- 2. Storage RLS 정책들 재생성 (필요한 경우)

-- 프로필 사진 공개 읽기 정책
DROP POLICY IF EXISTS "프로필 사진 공개 읽기" ON storage.objects;
CREATE POLICY "프로필 사진 공개 읽기" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'profiles');

-- 프로필 사진 업로드 정책 (본인만 업로드 가능)
DROP POLICY IF EXISTS "프로필 사진 업로드" ON storage.objects;
CREATE POLICY "프로필 사진 업로드" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profiles' AND
    -- 파일 경로가 사용자 ID로 시작하는지 확인 (profiles/user-id/...)
    (storage.foldername(name))[1] = auth.uid()::text AND
    -- 승인된 활성 멤버만 업로드 가능
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND registration_status = 'approved' 
      AND is_active = true
    )
  );

-- 프로필 사진 업데이트 정책 (본인만 수정 가능)
DROP POLICY IF EXISTS "프로필 사진 업데이트" ON storage.objects;
CREATE POLICY "프로필 사진 업데이트" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profiles' AND
    -- 파일 경로가 사용자 ID로 시작하는지 확인
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- 프로필 사진 삭제 정책 (본인 또는 관리자만 삭제 가능)
DROP POLICY IF EXISTS "프로필 사진 삭제" ON storage.objects;
CREATE POLICY "프로필 사진 삭제" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profiles' AND (
      -- 본인의 파일인지 확인
      (storage.foldername(name))[1] = auth.uid()::text OR
      -- 관리자인지 확인
      EXISTS (
        SELECT 1 FROM member_profiles 
        WHERE id = auth.uid() 
        AND is_admin = true
      )
    )
  );

-- 3. 결과 확인
SELECT 
  'bucket created' as status,
  id, 
  name, 
  public, 
  file_size_limit,
  allowed_mime_types
FROM storage.buckets 
WHERE id = 'profiles';