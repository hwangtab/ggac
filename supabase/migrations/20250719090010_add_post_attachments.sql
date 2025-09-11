-- 게시글 첨부파일 테이블 생성
CREATE TABLE IF NOT EXISTS post_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  alt_text TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT valid_file_size CHECK (file_size > 0 AND file_size <= 50 * 1024 * 1024), -- 최대 50MB
  CONSTRAINT valid_file_type CHECK (file_type IN ('image', 'document', 'video', 'audio')),
  CONSTRAINT valid_mime_type CHECK (
    (file_type = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml')) OR
    (file_type = 'document' AND mime_type IN ('application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')) OR
    (file_type = 'video' AND mime_type IN ('video/mp4', 'video/webm', 'video/ogg')) OR
    (file_type = 'audio' AND mime_type IN ('audio/mpeg', 'audio/wav', 'audio/ogg'))
  )
);

-- 인덱스 생성
CREATE INDEX idx_post_attachments_post_id ON post_attachments(post_id);
CREATE INDEX idx_post_attachments_file_type ON post_attachments(file_type);
CREATE INDEX idx_post_attachments_sort_order ON post_attachments(post_id, sort_order);

-- RLS 정책 설정
ALTER TABLE post_attachments ENABLE ROW LEVEL SECURITY;

-- 게시글 첨부파일 조회 정책 (로그인한 사용자만)
CREATE POLICY "첨부파일 조회" ON post_attachments
  FOR SELECT 
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p 
      JOIN member_profiles mp ON p.author_id = mp.id 
      WHERE p.id = post_attachments.post_id 
      AND mp.registration_status = 'approved'
    )
  );

-- 첨부파일 작성 정책 (승인된 회원만)
CREATE POLICY "첨부파일 작성" ON post_attachments
  FOR INSERT 
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts p 
      JOIN member_profiles mp ON p.author_id = mp.id 
      WHERE p.id = post_attachments.post_id 
      AND p.author_id = auth.uid()
      AND mp.registration_status = 'approved'
    )
  );

-- 첨부파일 수정 정책 (작성자만)
CREATE POLICY "첨부파일 수정" ON post_attachments
  FOR UPDATE 
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p 
      WHERE p.id = post_attachments.post_id 
      AND p.author_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts p 
      WHERE p.id = post_attachments.post_id 
      AND p.author_id = auth.uid()
    )
  );

-- 첨부파일 삭제 정책 (작성자 또는 관리자)
CREATE POLICY "첨부파일 삭제" ON post_attachments
  FOR DELETE 
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM posts p 
      WHERE p.id = post_attachments.post_id 
      AND p.author_id = auth.uid()
    ) OR
    EXISTS (
      SELECT 1 FROM member_profiles mp 
      WHERE mp.id = auth.uid() 
      AND mp.is_admin = true
    )
  );

-- 첨부파일 자동 정렬 함수
CREATE OR REPLACE FUNCTION update_attachment_sort_order()
RETURNS TRIGGER AS $$
BEGIN
  -- 새로 추가된 첨부파일의 정렬 순서를 자동으로 설정
  IF NEW.sort_order IS NULL OR NEW.sort_order = 0 THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 
    INTO NEW.sort_order 
    FROM post_attachments 
    WHERE post_id = NEW.post_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 첨부파일 정렬 트리거
CREATE TRIGGER trigger_update_attachment_sort_order
  BEFORE INSERT ON post_attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_attachment_sort_order();

-- 첨부파일 통계 함수
CREATE OR REPLACE FUNCTION get_post_attachment_stats(p_post_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_attachments', COUNT(*),
    'total_size', COALESCE(SUM(file_size), 0),
    'image_count', COUNT(*) FILTER (WHERE file_type = 'image'),
    'document_count', COUNT(*) FILTER (WHERE file_type = 'document'),
    'video_count', COUNT(*) FILTER (WHERE file_type = 'video'),
    'audio_count', COUNT(*) FILTER (WHERE file_type = 'audio')
  ) INTO result
  FROM post_attachments
  WHERE post_id = p_post_id;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 첨부파일 용량 체크 함수
CREATE OR REPLACE FUNCTION check_post_attachment_limits(p_post_id UUID, p_file_size BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  total_size BIGINT;
  attachment_count INTEGER;
BEGIN
  -- 현재 게시글의 총 첨부파일 크기와 개수 확인
  SELECT 
    COALESCE(SUM(file_size), 0),
    COUNT(*)
  INTO total_size, attachment_count
  FROM post_attachments
  WHERE post_id = p_post_id;
  
  -- 총 용량 제한 (100MB)
  IF (total_size + p_file_size) > (100 * 1024 * 1024) THEN
    RETURN FALSE;
  END IF;
  
  -- 첨부파일 개수 제한 (10개)
  IF attachment_count >= 10 THEN
    RETURN FALSE;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- updated_at 자동 업데이트 트리거
CREATE TRIGGER trigger_post_attachments_updated_at
  BEFORE UPDATE ON post_attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 테이블에 코멘트 추가
COMMENT ON TABLE post_attachments IS '게시글 첨부파일 정보를 저장하는 테이블';
COMMENT ON COLUMN post_attachments.id IS '첨부파일 고유 식별자';
COMMENT ON COLUMN post_attachments.post_id IS '게시글 ID (posts 테이블 참조)';
COMMENT ON COLUMN post_attachments.file_name IS '원본 파일명';
COMMENT ON COLUMN post_attachments.file_url IS '파일 저장 URL';
COMMENT ON COLUMN post_attachments.file_type IS '파일 종류 (image, document, video, audio)';
COMMENT ON COLUMN post_attachments.file_size IS '파일 크기 (바이트)';
COMMENT ON COLUMN post_attachments.mime_type IS 'MIME 타입';
COMMENT ON COLUMN post_attachments.alt_text IS '이미지 대체 텍스트 (접근성)';
COMMENT ON COLUMN post_attachments.is_primary IS '대표 이미지 여부';
COMMENT ON COLUMN post_attachments.sort_order IS '정렬 순서';