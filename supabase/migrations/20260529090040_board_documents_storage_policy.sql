-- 이사 서류 전용 비공개 버킷. service-role API로만 업로드/삭제, 다운로드는 signed URL.
-- public=false 이므로 직접 URL 접근이 차단된다(공개 attachments 버킷의 한계를 보완).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('board-documents', 'board-documents', false, 52428800)  -- 50MB
ON CONFLICT (id) DO UPDATE SET public = false;
