-- 감사(監事) 권한: 이사회에 감사 업무 목적으로 접근하나 정족수에는 산입되지 않는 역할
-- 기존에는 director_title='감사'로 표시만 했으나, is_director에 묶여 정족수에 잘못 포함되던 문제를
-- 해소하기 위해 별도 플래그(is_auditor)로 분리한다.
BEGIN;

ALTER TABLE public.member_profiles
  ADD COLUMN IF NOT EXISTS is_auditor BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_member_profiles_is_auditor
  ON public.member_profiles (is_auditor) WHERE is_auditor = TRUE;

COMMENT ON COLUMN public.member_profiles.is_auditor IS
  '감사 여부(관리자가 부여). 이사회 접근은 가능하나 정족수에는 산입되지 않음';

-- 기존 데이터 정정: 감사인 주진태(themilliways)를 이사 명단에서 분리해 감사로 이관.
-- (해당 회원이 없는 환경에서는 0행 영향 — 안전)
UPDATE public.member_profiles
SET is_auditor = TRUE,
    is_director = FALSE,
    director_title = NULL
WHERE display_name = 'themilliways';

COMMIT;
