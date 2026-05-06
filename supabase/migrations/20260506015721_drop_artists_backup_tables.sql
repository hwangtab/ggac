-- 1년 전 일회성 백업 테이블 영구 삭제
-- artists_backup_20241218 (1행), artists_backup_full_20241218 (12행)
-- 외부 참조(view, function, trigger) 없음을 확인 후 삭제.
-- 백업에만 존재하던 3행(legacy_id artist-002/003/006)은 의도적으로 영구 폐기한다.

DROP TABLE IF EXISTS public.artists_backup_20241218;
DROP TABLE IF EXISTS public.artists_backup_full_20241218;
