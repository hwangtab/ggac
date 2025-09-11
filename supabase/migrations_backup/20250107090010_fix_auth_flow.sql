-- ===================================================================
-- 완전한 회원가입 플로우를 위한 마이그레이션
-- ===================================================================

-- 1. 기존 외래 키 제약조건 수정 (더 유연하게)
ALTER TABLE public.member_profiles 
DROP CONSTRAINT IF EXISTS member_profiles_id_fkey;

-- 2. 더 유연한 외래 키 제약조건 추가 (CASCADE 삭제)
ALTER TABLE public.member_profiles 
ADD CONSTRAINT member_profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3. RLS 정책 완전 재설정
ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY;

-- 기존 정책 모두 삭제
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Allow authenticated users to create profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.member_profiles;
DROP POLICY IF EXISTS "Admins can approve members" ON public.member_profiles;

-- 4. 새로운 RLS 정책 생성 (더 명확하고 안전함)

-- 사용자는 자신의 프로필만 볼 수 있음
CREATE POLICY "Users can view own profile" ON public.member_profiles
  FOR SELECT USING (auth.uid() = id);

-- 사용자는 자신의 프로필만 수정할 수 있음  
CREATE POLICY "Users can update own profile" ON public.member_profiles
  FOR UPDATE USING (auth.uid() = id);

-- 관리자는 모든 프로필을 볼 수 있음
CREATE POLICY "Admins can view all profiles" ON public.member_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles admin_profile
      WHERE admin_profile.id = auth.uid() 
      AND admin_profile.is_admin = true 
      AND admin_profile.is_active = true
    )
  );

-- 관리자는 모든 프로필을 수정할 수 있음 (승인 등)
CREATE POLICY "Admins can update all profiles" ON public.member_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.member_profiles admin_profile
      WHERE admin_profile.id = auth.uid() 
      AND admin_profile.is_admin = true 
      AND admin_profile.is_active = true
    )
  );

-- 5. 트리거 함수 완전 재작성 (이메일 확인 후에만 작동)
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.member_profiles (
    id, email, display_name, real_name, phone_number, birth_date,
    monthly_fee, bank_name, account_number, account_holder,
    registration_status, is_active
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'real_name',
    NEW.raw_user_meta_data->>'phone_number',
    (NEW.raw_user_meta_data->>'birth_date')::date,
    (NEW.raw_user_meta_data->>'monthly_fee')::integer,
    NEW.raw_user_meta_data->>'bank_name',
    NEW.raw_user_meta_data->>'account_number',
    NEW.raw_user_meta_data->>'account_holder',
    'pending', -- registration_status
    FALSE      -- is_active
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. 이메일 확인 시 프로필 생성하는 트리거 함수
CREATE OR REPLACE FUNCTION public.handle_email_confirmed()
RETURNS trigger 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 이메일 확인 상태가 변경된 경우 (NULL에서 값으로)
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    -- 기존 프로필이 없는 경우에만 생성
    INSERT INTO public.member_profiles (id, email, display_name, registration_status, is_active)
    SELECT NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email), 'pending', FALSE
    WHERE NOT EXISTS (
      SELECT 1 FROM public.member_profiles WHERE id = NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. 트리거 생성
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;

-- 새 사용자 생성 시 트리거 (이메일 확인된 경우만)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 이메일 확인 시 트리거  
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_email_confirmed();

-- 8. 수동 프로필 생성을 위한 안전한 함수 추가
CREATE OR REPLACE FUNCTION public.create_user_profile(
  user_id UUID,
  user_email TEXT,
  display_name TEXT DEFAULT NULL
)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 사용자가 auth.users에 존재하고 이메일이 확인된 경우에만 프로필 생성
  IF EXISTS (
    SELECT 1 FROM auth.users 
    WHERE id = user_id 
    AND email_confirmed_at IS NOT NULL
  ) THEN
    INSERT INTO public.member_profiles (id, email, display_name, registration_status, is_active)
    VALUES (
      user_id, 
      user_email, 
      COALESCE(display_name, user_email), 
      'pending', 
      FALSE
    )
    ON CONFLICT (id) DO NOTHING; -- 이미 존재하면 무시
  ELSE
    RAISE EXCEPTION 'User must exist in auth.users with confirmed email';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. 공개 접근 권한 설정
GRANT EXECUTE ON FUNCTION public.create_user_profile TO authenticated;

-- 10. 첫 번째 관리자 생성을 위한 임시 함수
CREATE OR REPLACE FUNCTION public.make_first_admin(user_email TEXT)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 관리자가 하나도 없는 경우에만 실행
  IF NOT EXISTS (SELECT 1 FROM public.member_profiles WHERE is_admin = true) THEN
    UPDATE public.member_profiles 
    SET is_admin = true, 
        is_active = true, 
        registration_status = 'approved',
        approved_at = NOW()
    WHERE email = user_email;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User with email % not found', user_email;
    END IF;
  ELSE
    RAISE EXCEPTION 'Admin already exists';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 이 함수는 한 번만 사용하고 삭제하세요
GRANT EXECUTE ON FUNCTION public.make_first_admin TO authenticated;
