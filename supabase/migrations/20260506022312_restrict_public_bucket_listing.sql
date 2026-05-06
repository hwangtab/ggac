-- Supabase Security Advisor: public_bucket_allows_listing 2건
--
-- artists, profiles 버킷의 storage.objects SELECT 정책이 너무 넓어
-- 클라이언트가 storage list API로 모든 파일 목록을 조회할 수 있음.
-- 두 버킷 모두 storage.buckets.public=true이므로 개별 파일은
-- /storage/v1/object/public/<bucket>/<path> 형태의 직접 URL로 계속 접근 가능.
-- 코드에서 .list() 호출은 없으며 .remove()는 service_role admin client 사용.
-- 따라서 broad SELECT 정책을 제거해도 정상 동작에 영향 없음.

DROP POLICY IF EXISTS "artist_photos_public_read" ON storage.objects;
DROP POLICY IF EXISTS "프로필 사진 공개 읽기" ON storage.objects;
