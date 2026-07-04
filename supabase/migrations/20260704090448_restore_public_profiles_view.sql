-- public_profiles 뷰 드리프트 교정: 원본 마이그(20250711090010)이 운영에 미적용.
-- (원본은 뷰에 CREATE POLICY를 시도해 Postgres에서 에러 → 전체 미적용.)
-- 뷰 RLS 정책·email은 이식하지 않는다(뷰 정책 불가, 개인정보 최소화).
-- 노출 컬럼은 id·display_name만. 일반 뷰(정의자 소유)라 base RLS를 우회해
-- anon 키 호출도 작성자 이름을 해석할 수 있다. security_invoker=true는 쓰지 말 것.
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT id, display_name
FROM public.member_profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
