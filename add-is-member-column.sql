-- member_profiles 테이블에 is_member 컬럼 추가
-- ===================================================================

-- is_member 컬럼 추가 (기본값 false)
ALTER TABLE public.member_profiles 
ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;

-- 기존 데이터가 있다면 is_member를 true로 설정 (조합원 정보가 있으면 조합원으로 간주)
UPDATE public.member_profiles 
SET is_member = true 
WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;