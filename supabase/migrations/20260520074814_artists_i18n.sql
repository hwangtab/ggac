-- Phase 5: artists 테이블에 영문 콘텐츠 컬럼 추가
-- 관리자가 영문 텍스트를 입력하면 /en/ 경로에서 해당 값이 사용된다.
-- 값이 없으면 한국어 원본으로 폴백.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS name_en          text,
  ADD COLUMN IF NOT EXISTS one_liner_en     text,
  ADD COLUMN IF NOT EXISTS bio_en           text,
  ADD COLUMN IF NOT EXISTS template_type_en text;

COMMENT ON COLUMN public.artists.name_en          IS 'English display name (optional; falls back to name)';
COMMENT ON COLUMN public.artists.one_liner_en     IS 'English one-liner (optional; falls back to one_liner)';
COMMENT ON COLUMN public.artists.bio_en           IS 'English bio in Markdown (optional; falls back to bio)';
COMMENT ON COLUMN public.artists.template_type_en IS 'English template type label (optional; falls back to template_type)';
