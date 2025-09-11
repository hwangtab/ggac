-- 멤버 활동 추적 시스템 생성
-- 사용자 활동 로깅, 실시간 세션 관리, 활동 통계 제공

-- 활동 타입 열거형 정의
CREATE TYPE activity_action_type AS ENUM (
  'login',
  'logout',
  'post_created',
  'post_updated',
  'post_deleted',
  'comment_created',
  'comment_deleted',
  'like_added',
  'like_removed',
  'profile_updated',
  'password_changed',
  'email_changed',
  'artist_profile_updated',
  'member_approved',
  'member_rejected',
  'admin_action',
  'file_uploaded',
  'file_deleted',
  'notification_read',
  'search_performed',
  'page_viewed'
);

-- 대상 타입 열거형 정의
CREATE TYPE activity_target_type AS ENUM (
  'post',
  'comment',
  'user',
  'profile',
  'artist_profile',
  'file',
  'notification',
  'system'
);

-- 사용자 활동 로그 테이블
CREATE TABLE IF NOT EXISTS user_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type activity_action_type NOT NULL,
  target_type activity_target_type,
  target_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  session_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 인덱스를 위한 제약조건
  CONSTRAINT valid_target_combination CHECK (
    (target_type IS NULL AND target_id IS NULL) OR 
    (target_type IS NOT NULL)
  )
);

-- 실시간 사용자 세션 추적 테이블
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_token VARCHAR(255) UNIQUE NOT NULL,
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  ip_address INET,
  user_agent TEXT,
  login_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  logout_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}',
  
  -- 세션 유효성 제약조건
  CONSTRAINT valid_session_state CHECK (
    (is_active = TRUE AND logout_at IS NULL) OR 
    (is_active = FALSE AND logout_at IS NOT NULL)
  )
);

-- 활동 통계 집계 테이블 (일별)
CREATE TABLE IF NOT EXISTS daily_activity_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_date DATE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type activity_action_type NOT NULL,
  count INTEGER DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 유니크 제약조건
  UNIQUE(activity_date, user_id, action_type)
);

-- 실시간 활성 사용자 뷰
CREATE OR REPLACE VIEW active_users_view AS
SELECT 
  us.user_id,
  mp.display_name,
  mp.email,
  us.last_activity,
  us.ip_address,
  COUNT(ua.id) as activity_count_today,
  us.session_token,
  EXTRACT(EPOCH FROM (NOW() - us.last_activity)) / 60 as minutes_since_activity
FROM user_sessions us
JOIN member_profiles mp ON us.user_id = mp.id
LEFT JOIN user_activities ua ON ua.user_id = us.user_id 
  AND ua.created_at >= CURRENT_DATE
WHERE us.is_active = TRUE 
  AND us.last_activity > NOW() - INTERVAL '30 minutes'
GROUP BY us.user_id, mp.display_name, mp.email, us.last_activity, 
         us.ip_address, us.session_token
ORDER BY us.last_activity DESC;

-- 활동 통계 집계 뷰 (주간)
-- CTE를 사용하여 윈도우 함수와 집계 함수를 분리
CREATE OR REPLACE VIEW weekly_activity_stats AS
WITH activity_intervals AS (
  SELECT 
    DATE_TRUNC('week', created_at) as week_start,
    action_type,
    user_id,
    created_at,
    EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (
      PARTITION BY user_id ORDER BY created_at
    ))) as time_diff_seconds
  FROM user_activities
  WHERE created_at >= NOW() - INTERVAL '8 weeks'
)
SELECT 
  week_start,
  action_type,
  COUNT(*) as total_count,
  COUNT(DISTINCT user_id) as unique_users,
  AVG(time_diff_seconds) as avg_time_between_actions
FROM activity_intervals
GROUP BY week_start, action_type
ORDER BY week_start DESC, total_count DESC;

-- 인덱스 생성 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_user_activities_user_id ON user_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_created_at ON user_activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activities_action_type ON user_activities(action_type);
CREATE INDEX IF NOT EXISTS idx_user_activities_target ON user_activities(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_session ON user_activities(session_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_composite ON user_activities(user_id, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_active ON user_sessions(is_active, last_activity DESC) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_sessions_last_activity ON user_sessions(last_activity DESC);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_activity_stats(activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_stats_user ON daily_activity_stats(user_id, activity_date DESC);

-- RLS 정책 설정
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_activity_stats ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 활동만 조회 가능
CREATE POLICY "Users can view own activities" ON user_activities
  FOR SELECT USING (auth.uid() = user_id);

-- 관리자는 모든 활동 조회 가능
CREATE POLICY "Admins can view all activities" ON user_activities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND is_admin = TRUE 
      AND registration_status = 'approved'
    )
  );

-- 세션 정책 (사용자는 자신의 세션만, 관리자는 모든 세션)
CREATE POLICY "Users can view own sessions" ON user_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all sessions" ON user_sessions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND is_admin = TRUE 
      AND registration_status = 'approved'
    )
  );

-- 통계 정책 (사용자는 자신의 통계만, 관리자는 모든 통계)
CREATE POLICY "Users can view own stats" ON daily_activity_stats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all stats" ON daily_activity_stats
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM member_profiles 
      WHERE id = auth.uid() 
      AND is_admin = TRUE 
      AND registration_status = 'approved'
    )
  );

-- 활동 로깅 함수
CREATE OR REPLACE FUNCTION log_user_activity(
  p_user_id UUID,
  p_action_type activity_action_type,
  p_target_type activity_target_type DEFAULT NULL,
  p_target_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}',
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_session_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  activity_id UUID;
BEGIN
  -- 활동 로그 삽입
  INSERT INTO user_activities (
    user_id, action_type, target_type, target_id, 
    metadata, ip_address, user_agent, session_id
  ) VALUES (
    p_user_id, p_action_type, p_target_type, p_target_id,
    p_metadata, p_ip_address, p_user_agent, p_session_id
  ) RETURNING id INTO activity_id;

  -- 일별 통계 업데이트 (UPSERT)
  INSERT INTO daily_activity_stats (activity_date, user_id, action_type, count)
  VALUES (CURRENT_DATE, p_user_id, p_action_type, 1)
  ON CONFLICT (activity_date, user_id, action_type)
  DO UPDATE SET 
    count = daily_activity_stats.count + 1,
    last_updated = NOW();

  RETURN activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 세션 관리 함수
CREATE OR REPLACE FUNCTION manage_user_session(
  p_user_id UUID,
  p_session_token VARCHAR(255),
  p_action VARCHAR(10), -- 'start', 'update', 'end'
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  session_id UUID;
BEGIN
  IF p_action = 'start' THEN
    -- 기존 활성 세션 종료
    UPDATE user_sessions 
    SET is_active = FALSE, logout_at = NOW()
    WHERE user_id = p_user_id AND is_active = TRUE;
    
    -- 새 세션 시작
    INSERT INTO user_sessions (
      user_id, session_token, ip_address, user_agent, metadata
    ) VALUES (
      p_user_id, p_session_token, p_ip_address, p_user_agent, p_metadata
    ) RETURNING id INTO session_id;
    
    -- 로그인 활동 기록
    PERFORM log_user_activity(
      p_user_id, 'login'::activity_action_type, 'system'::activity_target_type, 
      NULL, p_metadata, p_ip_address, p_user_agent, session_id
    );

  ELSIF p_action = 'update' THEN
    -- 세션 활동 시간 업데이트
    UPDATE user_sessions 
    SET last_activity = NOW(), metadata = p_metadata
    WHERE session_token = p_session_token AND is_active = TRUE
    RETURNING id INTO session_id;

  ELSIF p_action = 'end' THEN
    -- 세션 종료
    UPDATE user_sessions 
    SET is_active = FALSE, logout_at = NOW()
    WHERE session_token = p_session_token AND is_active = TRUE
    RETURNING id INTO session_id;
    
    -- 로그아웃 활동 기록
    PERFORM log_user_activity(
      p_user_id, 'logout'::activity_action_type, 'system'::activity_target_type,
      NULL, p_metadata, p_ip_address, p_user_agent, session_id
    );
  END IF;

  RETURN session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 활동 통계 조회 함수
CREATE OR REPLACE FUNCTION get_user_activity_stats(
  p_user_id UUID DEFAULT NULL,
  p_start_date DATE DEFAULT CURRENT_DATE - INTERVAL '30 days',
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  action_type activity_action_type,
  total_count BIGINT,
  unique_days BIGINT,
  avg_per_day NUMERIC,
  first_activity TIMESTAMP WITH TIME ZONE,
  last_activity TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ua.action_type,
    COUNT(*) as total_count,
    COUNT(DISTINCT DATE(ua.created_at)) as unique_days,
    ROUND(COUNT(*)::NUMERIC / GREATEST(COUNT(DISTINCT DATE(ua.created_at)), 1), 2) as avg_per_day,
    MIN(ua.created_at) as first_activity,
    MAX(ua.created_at) as last_activity
  FROM user_activities ua
  WHERE (p_user_id IS NULL OR ua.user_id = p_user_id)
    AND DATE(ua.created_at) BETWEEN p_start_date AND p_end_date
  GROUP BY ua.action_type
  ORDER BY total_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 실시간 활동 피드 조회 함수
CREATE OR REPLACE FUNCTION get_real_time_activity_feed(
  p_limit INTEGER DEFAULT 50,
  p_action_types activity_action_type[] DEFAULT NULL
)
RETURNS TABLE(
  id UUID,
  user_id UUID,
  user_name TEXT,
  action_type activity_action_type,
  target_type activity_target_type,
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE,
  time_ago_text TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ua.id,
    ua.user_id,
    mp.display_name as user_name,
    ua.action_type,
    ua.target_type,
    ua.target_id,
    ua.metadata,
    ua.created_at,
    CASE 
      WHEN ua.created_at > NOW() - INTERVAL '1 minute' THEN '방금 전'
      WHEN ua.created_at > NOW() - INTERVAL '1 hour' THEN EXTRACT(EPOCH FROM (NOW() - ua.created_at))::INTEGER / 60 || '분 전'
      WHEN ua.created_at > NOW() - INTERVAL '1 day' THEN EXTRACT(EPOCH FROM (NOW() - ua.created_at))::INTEGER / 3600 || '시간 전'
      ELSE EXTRACT(EPOCH FROM (NOW() - ua.created_at))::INTEGER / 86400 || '일 전'
    END as time_ago_text
  FROM user_activities ua
  JOIN member_profiles mp ON ua.user_id = mp.id
  WHERE (p_action_types IS NULL OR ua.action_type = ANY(p_action_types))
    AND ua.created_at > NOW() - INTERVAL '24 hours'
  ORDER BY ua.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 정리 작업: 오래된 데이터 삭제 함수
CREATE OR REPLACE FUNCTION cleanup_old_activity_data()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- 3개월 이상 된 활동 로그 삭제
  DELETE FROM user_activities 
  WHERE created_at < NOW() - INTERVAL '3 months';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- 1주일 이상 비활성 세션 삭제
  DELETE FROM user_sessions 
  WHERE last_activity < NOW() - INTERVAL '1 week' AND is_active = FALSE;
  
  -- 6개월 이상 된 일별 통계 삭제
  DELETE FROM daily_activity_stats 
  WHERE activity_date < CURRENT_DATE - INTERVAL '6 months';
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 댓글
COMMENT ON TABLE user_activities IS '사용자 활동 로그 테이블';
COMMENT ON TABLE user_sessions IS '실시간 사용자 세션 추적 테이블';
COMMENT ON TABLE daily_activity_stats IS '일별 활동 통계 집계 테이블';
COMMENT ON FUNCTION log_user_activity IS '사용자 활동 로깅 함수';
COMMENT ON FUNCTION manage_user_session IS '사용자 세션 관리 함수';
COMMENT ON FUNCTION get_user_activity_stats IS '사용자 활동 통계 조회 함수';
COMMENT ON FUNCTION get_real_time_activity_feed IS '실시간 활동 피드 조회 함수';
COMMENT ON FUNCTION cleanup_old_activity_data IS '오래된 활동 데이터 정리 함수';