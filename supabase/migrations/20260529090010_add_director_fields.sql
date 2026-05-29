-- 이사회 권한: 관리자가 회원에게 부여하는 이사 플래그
BEGIN;

ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS is_director BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS director_title TEXT;  -- '이사장' | '이사' | '감사' 등 표시용, NULL 허용

CREATE INDEX IF NOT EXISTS idx_member_profiles_is_director
  ON public.member_profiles (is_director) WHERE is_director = TRUE;

COMMENT ON COLUMN public.member_profiles.is_director IS '이사회 구성원 여부(관리자가 부여)';
COMMENT ON COLUMN public.member_profiles.director_title IS '이사 직책 표시용 자유 텍스트';

COMMIT;
