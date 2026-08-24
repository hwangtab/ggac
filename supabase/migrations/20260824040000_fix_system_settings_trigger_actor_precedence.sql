-- system_settings 트리거가 애플리케이션이 명시한 updated_by를 덮어쓰던 문제 교정
--
-- 배경: 단계 2b-5에서 createSupabaseServer()가 서비스롤 키를 쓰도록 바뀌면서
-- Postgres 안 auth.uid()가 항상 NULL이 됐다. src/lib/server/systemSettingsWrite.ts는
-- 이를 우회해 애플리케이션이 확인한 관리자 id를 update() 페이로드의 updated_by에
-- 직접 실어 보내도록 고쳤는데, system_settings에 걸린 BEFORE UPDATE 트리거
-- (update_system_settings_updated_at)가 무조건 `NEW.updated_by = auth.uid()`로
-- 덮어써서 애플리케이션이 넘긴 값이 NULL로 지워지고 있었다(운영 재현: 실제 관리자
-- UUID를 명시해 UPDATE해도 응답의 updated_by가 NULL). AFTER UPDATE 히스토리 트리거
-- (log_system_settings_change)도 changed_by에 auth.uid()를 넣어 같은 문제가
-- system_settings_history까지 번져 있었다.
--
-- 이 마이그레이션은 두 트리거 함수를 CREATE OR REPLACE로 다시 정의해:
--   1) update_system_settings_updated_at: NEW.updated_by를
--      `COALESCE(NEW.updated_by, auth.uid())`로 바꾼다 — 애플리케이션이 이미
--      명시한 값이 있으면 그대로 존중하고, 없을 때만(레거시 경로·직접 SQL 등)
--      예전처럼 auth.uid()로 떨어진다.
--   2) log_system_settings_change: changed_by를 auth.uid() 대신
--      NEW.updated_by에서 가져온다. BEFORE UPDATE 트리거가 먼저 실행돼
--      NEW.updated_by를 확정한 뒤에 AFTER UPDATE 트리거가 실행되므로, 이 시점의
--      NEW.updated_by는 이미 (1)에서 COALESCE로 확정된 최종 행위자 id다.
--
-- updated_at = NOW(), UPDATE일 때만 히스토리를 남기는 조건, 두 함수의
-- SET search_path 하드닝은 운영에 실재하는 정의(리뷰에서 실측 확인)를 그대로
-- 보존한다. 함수 시그니처(인자·반환 타입)와 트리거 자체는 바뀌지 않으므로
-- CREATE TRIGGER를 다시 실행할 필요는 없다 — CREATE OR REPLACE FUNCTION만으로
-- 기존 트리거가 새 본문을 즉시 사용한다.
--
-- idempotent: CREATE OR REPLACE FUNCTION은 몇 번을 다시 실행해도 안전하다.

CREATE OR REPLACE FUNCTION public.update_system_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  NEW.updated_by = COALESCE(NEW.updated_by, auth.uid());
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_system_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- UPDATE 시에만 히스토리 기록
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO system_settings_history (
      setting_id, category, setting_key,
      old_value, new_value, changed_by
    ) VALUES (
      NEW.id, NEW.category, NEW.setting_key,
      OLD.setting_value, NEW.setting_value, NEW.updated_by
    );
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.update_system_settings_updated_at IS
  '시스템 설정 updated_at/updated_by 자동 기록. updated_by는 애플리케이션이 이미 명시한 값을 우선하고, 없을 때만 auth.uid()로 떨어진다(서비스롤 클라이언트 전환 이후 auth.uid()는 항상 NULL).';
COMMENT ON FUNCTION public.log_system_settings_change IS
  '시스템 설정 변경 히스토리 기록. changed_by는 auth.uid()가 아니라 트리거 실행 시점에 이미 확정된 NEW.updated_by를 그대로 쓴다.';
