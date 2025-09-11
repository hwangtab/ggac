-- 고급 검색 기능을 위한 SQL 실행 함수
-- 동적 쿼리 실행을 안전하게 처리하기 위한 함수

-- 고급 검색 실행 함수
CREATE OR REPLACE FUNCTION execute_advanced_search(
  query_sql TEXT,
  query_params JSONB DEFAULT '[]'::JSONB
) RETURNS JSONB AS $$
DECLARE
  result JSONB;
  param_count INTEGER;
  prepared_query TEXT;
  param_values TEXT[];
  i INTEGER;
BEGIN
  -- 파라미터 개수 확인
  param_count := jsonb_array_length(query_params);
  
  -- 파라미터 배열 생성
  param_values := ARRAY[]::TEXT[];
  
  FOR i IN 0..param_count-1 LOOP
    param_values := array_append(param_values, (query_params->i)::TEXT);
  END LOOP;
  
  -- 쿼리 실행 및 결과 반환
  -- VARIADIC 대신 동적 쿼리 빌딩 사용
  prepared_query := query_sql;
  FOR i IN 1..array_length(param_values, 1) LOOP
    prepared_query := replace(prepared_query, '$' || i, quote_literal(param_values[i]));
  END LOOP;
  
  EXECUTE prepared_query INTO result;
  
  RETURN result;
  
EXCEPTION
  WHEN OTHERS THEN
    -- 오류 발생 시 로그 기록
    INSERT INTO error_logs (error_message, error_context, created_at)
    VALUES (SQLERRM, jsonb_build_object('query', query_sql, 'params', query_params), NOW())
    ON CONFLICT DO NOTHING;
    
    -- 오류 재발생
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 에러 로그 테이블 생성 (없는 경우)
CREATE TABLE IF NOT EXISTS error_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  error_message TEXT NOT NULL,
  error_context JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON error_logs(created_at);

-- 오래된 에러 로그 정리 함수
CREATE OR REPLACE FUNCTION cleanup_error_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM error_logs 
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 고급 검색 결과를 JSON으로 반환하는 개선된 함수
CREATE OR REPLACE FUNCTION execute_advanced_search_json(
  query_sql TEXT,
  query_params TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS JSONB AS $$
DECLARE
  result JSONB;
  record_data RECORD;
  results JSONB := '[]'::JSONB;
  cursor_name TEXT := 'search_cursor';
  full_query TEXT;
  param_placeholders TEXT;
  i INTEGER;
BEGIN
  -- 파라미터 개수에 따른 플레이스홀더 생성
  param_placeholders := '';
  FOR i IN 1..array_length(query_params, 1) LOOP
    IF i > 1 THEN
      param_placeholders := param_placeholders || ', ';
    END IF;
    param_placeholders := param_placeholders || '$' || i;
  END LOOP;
  
  -- 쿼리에 파라미터 바인딩
  full_query := query_sql;
  FOR i IN 1..array_length(query_params, 1) LOOP
    full_query := replace(full_query, '$' || i, quote_literal(query_params[i]));
  END LOOP;
  
  -- 동적 커서 실행
  EXECUTE 'DECLARE ' || cursor_name || ' CURSOR FOR ' || full_query;
  
  -- 결과 수집
  LOOP
    EXECUTE 'FETCH NEXT FROM ' || cursor_name INTO record_data;
    EXIT WHEN NOT FOUND;
    
    results := results || to_jsonb(record_data);
  END LOOP;
  
  -- 커서 닫기
  EXECUTE 'CLOSE ' || cursor_name;
  
  RETURN results;
  
EXCEPTION
  WHEN OTHERS THEN
    -- 커서가 열려있다면 닫기
    BEGIN
      EXECUTE 'CLOSE ' || cursor_name;
    EXCEPTION
      WHEN OTHERS THEN
        NULL; -- 커서가 이미 닫혀있거나 존재하지 않음
    END;
    
    -- 오류 로그 기록
    INSERT INTO error_logs (error_message, error_context, created_at)
    VALUES (SQLERRM, jsonb_build_object(
      'query', query_sql, 
      'params', array_to_json(query_params),
      'full_query', full_query
    ), NOW())
    ON CONFLICT DO NOTHING;
    
    -- 빈 배열 반환 (오류 시에도 JSON 형태 유지)
    RETURN '[]'::JSONB;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 안전한 동적 쿼리 실행 함수 (개선된 버전)
CREATE OR REPLACE FUNCTION safe_execute_query(
  base_query TEXT,
  where_conditions TEXT DEFAULT '',
  order_by TEXT DEFAULT '',
  limit_offset TEXT DEFAULT '',
  bind_params TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS TABLE(result_json JSONB) AS $$
DECLARE
  full_query TEXT;
  safe_where TEXT := '';
  safe_order TEXT := '';
  safe_limit TEXT := '';
  param_index INTEGER := 1;
  final_params TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- WHERE 절 안전성 검증 및 구성
  IF where_conditions IS NOT NULL AND trim(where_conditions) != '' THEN
    -- 기본적인 SQL 인젝션 패턴 차단
    IF where_conditions ~* '(drop|delete|insert|update|create|alter|exec|execute)[\s\(]' THEN
      RAISE EXCEPTION 'Potentially dangerous SQL detected in WHERE clause';
    END IF;
    safe_where := 'WHERE ' || where_conditions;
  END IF;
  
  -- ORDER BY 절 안전성 검증
  IF order_by IS NOT NULL AND trim(order_by) != '' THEN
    IF order_by ~* '(drop|delete|insert|update|create|alter|exec|execute)[\s\(]' THEN
      RAISE EXCEPTION 'Potentially dangerous SQL detected in ORDER BY clause';
    END IF;
    safe_order := order_by;
  END IF;
  
  -- LIMIT/OFFSET 절 안전성 검증
  IF limit_offset IS NOT NULL AND trim(limit_offset) != '' THEN
    IF limit_offset ~* '[^0-9\s\.,limit\s\offset]' THEN
      RAISE EXCEPTION 'Invalid LIMIT/OFFSET clause';
    END IF;
    safe_limit := limit_offset;
  END IF;
  
  -- 최종 쿼리 구성
  full_query := base_query || ' ' || safe_where || ' ' || safe_order || ' ' || safe_limit;
  
  -- 파라미터 바인딩을 통한 안전한 쿼리 실행
  FOR i IN 1..array_length(bind_params, 1) LOOP
    full_query := replace(full_query, '$' || i, quote_literal(bind_params[i]));
  END LOOP;
  
  -- 쿼리 실행 및 JSON 결과 반환
  RETURN QUERY
  EXECUTE 'SELECT to_jsonb(row) FROM (' || full_query || ') row';
  
EXCEPTION
  WHEN OTHERS THEN
    -- 오류 로그
    INSERT INTO error_logs (error_message, error_context, created_at)
    VALUES (SQLERRM, jsonb_build_object(
      'base_query', base_query,
      'where_conditions', where_conditions,
      'order_by', order_by,
      'limit_offset', limit_offset,
      'bind_params', array_to_json(bind_params),
      'full_query', full_query
    ), NOW());
    
    -- 빈 결과 반환
    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS 정책 설정
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;

-- 관리자만 에러 로그 조회 가능
CREATE POLICY "Admins can view error logs" ON error_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() AND is_admin = true
    )
  );

-- 시스템에서 에러 로그 생성 가능
CREATE POLICY "System can insert error logs" ON error_logs
  FOR INSERT WITH CHECK (true);

-- 함수 권한 설정
GRANT EXECUTE ON FUNCTION execute_advanced_search TO authenticated;
GRANT EXECUTE ON FUNCTION execute_advanced_search_json TO authenticated;
GRANT EXECUTE ON FUNCTION safe_execute_query TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_error_logs TO authenticated;

-- 테이블 권한 설정
GRANT SELECT ON error_logs TO authenticated;
GRANT INSERT ON error_logs TO authenticated;

-- 코멘트 추가
COMMENT ON FUNCTION execute_advanced_search IS '고급 검색 쿼리를 안전하게 실행하는 함수';
COMMENT ON FUNCTION execute_advanced_search_json IS '고급 검색 결과를 JSON 형태로 반환하는 함수';
COMMENT ON FUNCTION safe_execute_query IS '동적 쿼리를 안전하게 실행하는 개선된 함수';
COMMENT ON TABLE error_logs IS '시스템 오류 로그 테이블';