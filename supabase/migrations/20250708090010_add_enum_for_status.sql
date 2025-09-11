-- ===================================================================
-- registration_status 컬럼을 ENUM 타입으로 변경
-- Supabase 대시보드에서 드롭다운 메뉴로 표시되도록 합니다.
-- ===================================================================

-- 0. registration_status 컬럼을 사용하는 RLS 정책들을 일시적으로 DROP 합니다.
DROP POLICY IF EXISTS "Approved members can view posts" ON public.posts;
DROP POLICY IF EXISTS "Approved members can create posts" ON public.posts;
DROP POLICY IF EXISTS "Allow members to create comments" ON public.comments;

DO $$
BEGIN
  -- Create enum type if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'member_status' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.member_status AS ENUM (
      'pending',
      'approved',
      'rejected'
    );
  END IF;

  -- Migrate column to enum type only if not already enum
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE n.nspname='public' AND c.relname='member_profiles' AND a.attname='registration_status'
      AND t.typname <> 'member_status'
  ) THEN
    ALTER TABLE public.member_profiles
      ALTER COLUMN registration_status DROP DEFAULT,
      ALTER COLUMN registration_status TYPE public.member_status USING registration_status::public.member_status,
      ALTER COLUMN registration_status SET DEFAULT 'pending';
  END IF;
END$$;

-- 2. member_profiles 테이블의 registration_status 컬럼을 수정합니다.
ALTER TABLE public.member_profiles
  -- 먼저 기존의 기본값을 제거합니다.
  ALTER COLUMN registration_status DROP DEFAULT,

  -- 컬럼의 타입을 TEXT에서 새로운 ENUM 타입인 member_status로 변경합니다.
  -- USING 절은 기존의 텍스트 데이터를 새로운 ENUM 값으로 변환(캐스팅)하는 역할을 합니다.
  ALTER COLUMN registration_status TYPE public.member_status USING registration_status::public.member_status,

  -- ENUM 타입을 사용하는 새로운 기본값을 설정합니다.
  ALTER COLUMN registration_status SET DEFAULT 'pending';

-- 3. DROP 했던 RLS 정책들을 다시 CREATE 합니다.

-- For posts: Allow approved members to view posts
CREATE POLICY "Approved members can view posts" ON public.posts 
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'::public.member_status
      AND member_profiles.is_active = true
    ) AND is_deleted = false
  );

-- For posts: Allow approved members to create posts
CREATE POLICY "Approved members can create posts" ON public.posts 
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'::public.member_status
      AND member_profiles.is_active = true
    )
  );

-- For comments: Allow approved members to create comments
CREATE POLICY "Allow members to create comments" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.member_profiles 
      WHERE member_profiles.id = auth.uid() 
      AND member_profiles.registration_status = 'approved'::public.member_status
      AND member_profiles.is_active = true
    )
  );

-- 참고: 컬럼 타입을 변경하면 기존의 CHECK 제약 조건은 자동으로 제거됩니다.
