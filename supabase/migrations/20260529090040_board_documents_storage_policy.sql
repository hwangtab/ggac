BEGIN;

-- attachments 버킷의 board/ 경로는 이사/관리자만 읽기 가능 (서류 직접 URL 접근 차단)
DROP POLICY IF EXISTS "board docs read for directors" ON storage.objects;
CREATE POLICY "board docs read for directors"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = 'board'
  AND EXISTS (
    SELECT 1 FROM public.member_profiles mp
    WHERE mp.id = auth.uid()
      AND mp.is_active = TRUE
      AND mp.registration_status = 'approved'
      AND (mp.is_director = TRUE OR mp.is_admin = TRUE)
  )
);

COMMIT;
