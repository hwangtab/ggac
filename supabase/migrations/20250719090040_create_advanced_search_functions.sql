-- 고급 검색을 위한 stored procedure 및 함수들 생성

-- 동적 SQL 실행 함수
CREATE OR REPLACE FUNCTION execute_advanced_search(
  query_sql TEXT,
  query_params JSONB DEFAULT '[]'
) RETURNS TABLE(result JSONB) AS $$
DECLARE
  final_sql TEXT;
  param_value TEXT;
  param_index INTEGER;
BEGIN
  -- 기본 SQL 복사
  final_sql := query_sql;
  
  -- 파라미터 바인딩 (간단한 구현)
  -- 실제 프로덕션에서는 더 안전한 방법 사용 권장
  IF jsonb_array_length(query_params) > 0 THEN
    FOR param_index IN 0..jsonb_array_length(query_params) - 1 LOOP
      param_value := quote_literal(query_params->param_index);
      final_sql := replace(final_sql, '$' || (param_index + 1)::TEXT, param_value);
    END LOOP;
  END IF;
  
  -- 동적 SQL 실행
  RETURN QUERY EXECUTE 'SELECT to_jsonb(t) FROM (' || final_sql || ') t';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 게시글 고급 검색 전용 함수 (보다 안전한 버전)
CREATE OR REPLACE FUNCTION search_posts_advanced(
  p_filters JSONB DEFAULT '{}',
  p_search_query TEXT DEFAULT '',
  p_search_fields TEXT[] DEFAULT ARRAY['title', 'content'],
  p_sort_field TEXT DEFAULT 'created_at',
  p_sort_direction TEXT DEFAULT 'desc',
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE(
  id UUID,
  title TEXT,
  content TEXT,
  category TEXT,
  author_id UUID,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  is_pinned BOOLEAN,
  is_deleted BOOLEAN,
  author_name TEXT,
  author_email TEXT,
  comment_count BIGINT
) AS $$
DECLARE
  offset_val INTEGER;
  where_conditions TEXT := '1=1';
  order_clause TEXT;
  search_condition TEXT := '';
BEGIN
  -- 페이지네이션 계산
  offset_val := (p_page - 1) * p_limit;
  
  -- 검색 조건 구성
  IF p_search_query != '' THEN
    search_condition := ' AND (';
    IF 'title' = ANY(p_search_fields) THEN
      search_condition := search_condition || 'p.title ILIKE ' || quote_literal('%' || p_search_query || '%') || ' OR ';
    END IF;
    IF 'content' = ANY(p_search_fields) THEN
      search_condition := search_condition || 'p.content ILIKE ' || quote_literal('%' || p_search_query || '%') || ' OR ';
    END IF;
    -- 마지막 OR 제거
    search_condition := rtrim(search_condition, ' OR ');
    search_condition := search_condition || ')';
  END IF;
  
  -- 필터 조건 구성 (기본적인 필터만 지원)
  IF p_filters ? 'category' THEN
    where_conditions := where_conditions || ' AND p.category = ' || quote_literal(p_filters->>'category');
  END IF;
  
  IF p_filters ? 'is_pinned' THEN
    where_conditions := where_conditions || ' AND p.is_pinned = ' || (p_filters->>'is_pinned')::BOOLEAN;
  END IF;
  
  IF p_filters ? 'is_deleted' THEN
    where_conditions := where_conditions || ' AND p.is_deleted = ' || (p_filters->>'is_deleted')::BOOLEAN;
  END IF;
  
  -- 정렬 조건 구성
  CASE 
    WHEN p_sort_field = 'title' THEN order_clause := 'p.title';
    WHEN p_sort_field = 'category' THEN order_clause := 'p.category';
    WHEN p_sort_field = 'created_at' THEN order_clause := 'p.created_at';
    WHEN p_sort_field = 'updated_at' THEN order_clause := 'p.updated_at';
    WHEN p_sort_field = 'comment_count' THEN order_clause := 'comment_count';
    ELSE order_clause := 'p.created_at';
  END CASE;
  
  IF p_sort_direction = 'asc' THEN
    order_clause := order_clause || ' ASC';
  ELSE
    order_clause := order_clause || ' DESC';
  END IF;
  
  -- 최종 쿼리 실행
  RETURN QUERY EXECUTE '
    SELECT 
      p.id,
      p.title,
      p.content,
      p.category,
      p.author_id,
      p.created_at,
      p.updated_at,
      p.is_pinned,
      COALESCE(p.is_deleted, false) as is_deleted,
      mp.display_name as author_name,
      mp.email as author_email,
      COALESCE(c.comment_count, 0) as comment_count
    FROM posts p
    LEFT JOIN member_profiles mp ON p.author_id = mp.id
    LEFT JOIN (
      SELECT post_id, COUNT(*) as comment_count 
      FROM comments 
      WHERE deleted_at IS NULL 
      GROUP BY post_id
    ) c ON p.id = c.post_id
    WHERE ' || where_conditions || search_condition || '
    ORDER BY ' || order_clause || '
    LIMIT ' || p_limit || ' OFFSET ' || offset_val;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 게시글 고급 검색 카운트 함수
CREATE OR REPLACE FUNCTION count_posts_advanced(
  p_filters JSONB DEFAULT '{}',
  p_search_query TEXT DEFAULT '',
  p_search_fields TEXT[] DEFAULT ARRAY['title', 'content']
) RETURNS BIGINT AS $$
DECLARE
  where_conditions TEXT := '1=1';
  search_condition TEXT := '';
  result_count BIGINT;
BEGIN
  -- 검색 조건 구성
  IF p_search_query != '' THEN
    search_condition := ' AND (';
    IF 'title' = ANY(p_search_fields) THEN
      search_condition := search_condition || 'p.title ILIKE ' || quote_literal('%' || p_search_query || '%') || ' OR ';
    END IF;
    IF 'content' = ANY(p_search_fields) THEN
      search_condition := search_condition || 'p.content ILIKE ' || quote_literal('%' || p_search_query || '%') || ' OR ';
    END IF;
    -- 마지막 OR 제거
    search_condition := rtrim(search_condition, ' OR ');
    search_condition := search_condition || ')';
  END IF;
  
  -- 필터 조건 구성
  IF p_filters ? 'category' THEN
    where_conditions := where_conditions || ' AND p.category = ' || quote_literal(p_filters->>'category');
  END IF;
  
  IF p_filters ? 'is_pinned' THEN
    where_conditions := where_conditions || ' AND p.is_pinned = ' || (p_filters->>'is_pinned')::BOOLEAN;
  END IF;
  
  IF p_filters ? 'is_deleted' THEN
    where_conditions := where_conditions || ' AND p.is_deleted = ' || (p_filters->>'is_deleted')::BOOLEAN;
  END IF;
  
  -- 카운트 쿼리 실행
  EXECUTE '
    SELECT COUNT(*)
    FROM posts p
    WHERE ' || where_conditions || search_condition
  INTO result_count;
  
  RETURN result_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수들에 대한 권한 설정
GRANT EXECUTE ON FUNCTION execute_advanced_search TO authenticated;
GRANT EXECUTE ON FUNCTION search_posts_advanced TO authenticated;
GRANT EXECUTE ON FUNCTION count_posts_advanced TO authenticated;

-- 함수들에 대한 코멘트
COMMENT ON FUNCTION execute_advanced_search IS '동적 SQL 실행을 위한 범용 함수';
COMMENT ON FUNCTION search_posts_advanced IS '게시글 고급 검색 전용 함수 (안전한 버전)';
COMMENT ON FUNCTION count_posts_advanced IS '게시글 고급 검색 결과 카운트 함수';