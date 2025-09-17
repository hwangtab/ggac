-- Remove legacy profile_image column now that profile_photo_url is the single source of truth

-- Drop dependent views before altering the table
DROP VIEW IF EXISTS artist_photos_with_storage;
DROP VIEW IF EXISTS artists_with_photo;

ALTER TABLE artists
  DROP COLUMN IF EXISTS profile_image;

-- Recreate artists_with_photo view without relying on the removed column
CREATE OR REPLACE VIEW artists_with_photo AS
SELECT 
  a.*,
  CASE 
    WHEN a.profile_photo_url IS NOT NULL AND a.profile_photo_url != '' 
    THEN TRUE 
    ELSE FALSE 
  END as has_profile_photo,
  COALESCE(a.profile_photo_metadata->>'content_type', 'unknown') as photo_content_type,
  COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) as photo_file_size,
  COALESCE((a.profile_photo_metadata->>'width')::INTEGER, 0) as photo_width,
  COALESCE((a.profile_photo_metadata->>'height')::INTEGER, 0) as photo_height,
  CASE 
    WHEN COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) < 1024 
      THEN COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) || ' B'
    WHEN COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0) < 1024*1024 
      THEN ROUND(COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0)/1024.0, 1) || ' KB'
    ELSE ROUND(COALESCE((a.profile_photo_metadata->>'file_size')::BIGINT, 0)/(1024.0*1024), 1) || ' MB'
  END as photo_size_formatted
FROM artists a;

GRANT SELECT ON artists_with_photo TO authenticated;
ALTER VIEW artists_with_photo SET (security_barrier = true);
COMMENT ON VIEW artists_with_photo IS '프로필 사진 정보가 포함된 아티스트 뷰';

-- Recreate artist_photos_with_storage view, which depends on artists_with_photo
CREATE OR REPLACE VIEW artist_photos_with_storage AS
SELECT 
  a.id,
  a.legacy_id,
  a.name as artist_name,
  a.profile_photo_url,
  a.profile_photo_metadata,
  a.has_profile_photo,
  obj.name as storage_name,
  obj.created_at as uploaded_at,
  obj.updated_at as last_modified,
  (obj.metadata->>'size')::BIGINT as file_size,
  obj.metadata->>'mimetype' as mime_type,
  CASE 
    WHEN a.profile_photo_url IS NOT NULL 
    THEN get_artist_photo_public_url(obj.name)
    ELSE NULL
  END as public_url
FROM artists_with_photo a
LEFT JOIN storage.objects obj ON (
  obj.bucket_id = 'artists' AND
  a.profile_photo_url LIKE '%' || obj.name || '%'
);

GRANT SELECT ON artist_photos_with_storage TO authenticated;
COMMENT ON VIEW artist_photos_with_storage IS '아티스트 프로필 사진과 Storage 정보를 결합한 뷰';
