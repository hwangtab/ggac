-- ===========================================
-- 전체 아티스트 데이터 JSON vs DB 검증
-- artists.json과 데이터베이스 간 데이터 일치성 확인
-- ===========================================

-- 1. 전체 아티스트 목록 비교
SELECT '=== 1. 전체 아티스트 목록 비교 ===' as verification_step;

-- 데이터베이스의 아티스트 목록
SELECT 
  legacy_id,
  slug,
  name,
  LEFT(one_liner, 50) || '...' as one_liner_preview,
  template_type,
  updated_at
FROM artists 
ORDER BY legacy_id;

-- 2. 각 아티스트별 핵심 데이터 검증
SELECT '=== 2. 각 아티스트별 핵심 데이터 검증 ===' as verification_step;

-- 이름 및 기본 정보 확인
SELECT 
  legacy_id,
  name,
  CASE 
    WHEN legacy_id = 'artist-001' AND name = '사바하' THEN '✅'
    WHEN legacy_id = 'artist-002' AND name = 'Simon DM' THEN '✅'
    WHEN legacy_id = 'artist-003' AND name = '로잘린송(Rosalyn Song)' THEN '✅'
    WHEN legacy_id = 'artist-004' AND name = '류한길' THEN '✅'
    WHEN legacy_id = 'artist-005' AND name = 'ACMEin' THEN '❌ 순서 오류'
    WHEN legacy_id = 'artist-006' AND name = '산타나' THEN '✅'
    WHEN legacy_id = 'artist-007' AND name = '크리스 김' THEN '✅'
    WHEN legacy_id = 'artist-008' AND name = '황경하' THEN '✅'
    WHEN legacy_id = 'artist-009' AND name = 'ACMEin' THEN '✅'
    WHEN legacy_id = 'artist-010' AND name = '장현호' THEN '✅'
    WHEN legacy_id = 'artist-011' AND name = 'ANAZAO(아나자오)' THEN '✅'
    WHEN legacy_id = 'artist-012' AND name = '희우' THEN '✅'
    ELSE '❌ 불일치'
  END as name_check
FROM artists 
ORDER BY legacy_id;

-- 3. 포트폴리오 링크 데이터 확인
SELECT '=== 3. 포트폴리오 링크 데이터 확인 ===' as verification_step;

SELECT 
  legacy_id,
  name,
  jsonb_array_length(portfolio_links) as portfolio_count,
  CASE 
    WHEN portfolio_links IS NULL OR jsonb_array_length(portfolio_links) = 0 THEN '❌ 링크 없음'
    WHEN jsonb_array_length(portfolio_links) > 0 THEN '✅ 링크 있음'
  END as portfolio_status,
  -- 첫 번째 링크 샘플 표시
  CASE 
    WHEN jsonb_array_length(portfolio_links) > 0 
    THEN (portfolio_links->0->>'title') || ': ' || LEFT(portfolio_links->0->>'url', 30) || '...'
    ELSE 'N/A'
  END as first_link_sample
FROM artists 
ORDER BY legacy_id;

-- 4. 유튜브 비디오 데이터 확인
SELECT '=== 4. 유튜브 비디오 데이터 확인 ===' as verification_step;

SELECT 
  legacy_id,
  name,
  jsonb_array_length(youtube_videos) as youtube_count,
  CASE 
    WHEN youtube_videos IS NULL OR jsonb_array_length(youtube_videos) = 0 THEN '❌ 비디오 없음'
    WHEN jsonb_array_length(youtube_videos) > 0 THEN '✅ 비디오 있음'
  END as youtube_status,
  -- 첫 번째 비디오 샘플 표시
  CASE 
    WHEN jsonb_array_length(youtube_videos) > 0 
    THEN LEFT(youtube_videos->0->>'title', 40) || '...'
    ELSE 'N/A'
  END as first_video_sample
FROM artists 
ORDER BY legacy_id;

-- 5. 템플릿 타입 검증
SELECT '=== 5. 템플릿 타입 검증 ===' as verification_step;

SELECT 
  template_type,
  COUNT(*) as count,
  CASE 
    WHEN template_type IN ('미니멀형', '콜라주형') THEN '✅ 올바른 타입'
    ELSE '❌ 잘못된 타입'
  END as type_check
FROM artists 
GROUP BY template_type
ORDER BY template_type;

-- 6. 연락처 정보 확인
SELECT '=== 6. 연락처 정보 확인 ===' as verification_step;

SELECT 
  legacy_id,
  name,
  CASE 
    WHEN contact IS NOT NULL AND contact LIKE '%@%' THEN '✅ 이메일 있음'
    WHEN contact IS NOT NULL THEN '⚠️ 연락처 있음'
    ELSE '❌ 연락처 없음'
  END as contact_status,
  LEFT(COALESCE(contact, 'N/A'), 30) as contact_preview
FROM artists 
ORDER BY legacy_id;

-- 7. 데이터 무결성 종합 점검
SELECT '=== 7. 데이터 무결성 종합 점검 ===' as verification_step;

WITH artist_health_check AS (
  SELECT 
    legacy_id,
    name,
    -- 필수 필드 체크
    CASE WHEN name IS NOT NULL AND LENGTH(name) > 0 THEN 1 ELSE 0 END as has_name,
    CASE WHEN one_liner IS NOT NULL AND LENGTH(one_liner) > 0 THEN 1 ELSE 0 END as has_oneliner,
    CASE WHEN bio IS NOT NULL AND LENGTH(bio) > 10 THEN 1 ELSE 0 END as has_bio,
    CASE WHEN template_type IN ('미니멀형', '콜라주형') THEN 1 ELSE 0 END as valid_template,
    CASE WHEN profile_image IS NOT NULL AND LENGTH(profile_image) > 0 THEN 1 ELSE 0 END as has_image,
    -- 선택 필드 체크
    CASE WHEN portfolio_links IS NOT NULL AND jsonb_array_length(portfolio_links) > 0 THEN 1 ELSE 0 END as has_portfolio,
    CASE WHEN youtube_videos IS NOT NULL AND jsonb_array_length(youtube_videos) > 0 THEN 1 ELSE 0 END as has_youtube
  FROM artists
)
SELECT 
  legacy_id,
  name,
  (has_name + has_oneliner + has_bio + valid_template + has_image) as required_score,
  (has_portfolio + has_youtube) as optional_score,
  CASE 
    WHEN (has_name + has_oneliner + has_bio + valid_template + has_image) = 5 THEN '✅ 필수 데이터 완전'
    WHEN (has_name + has_oneliner + has_bio + valid_template + has_image) >= 3 THEN '⚠️ 필수 데이터 부족'
    ELSE '❌ 심각한 데이터 부족'
  END as health_status
FROM artist_health_check
ORDER BY required_score DESC, optional_score DESC;

-- 8. 특별히 문제가 있는 아티스트 식별
SELECT '=== 8. 문제가 있는 아티스트 식별 ===' as verification_step;

-- 황경하님 데이터 특별 검증
SELECT 
  legacy_id,
  name,
  one_liner,
  CASE 
    WHEN one_liner LIKE '%현장과 호흡하는 예술%' THEN '✅ 올바른 데이터'
    WHEN one_liner LIKE '%기술과 예술의 경계%' THEN '❌ 잘못된 데이터 (개발자 프로필)'
    ELSE '⚠️ 확인 필요'
  END as hwang_data_check
FROM artists 
WHERE legacy_id = 'artist-008';

-- 전체 요약
SELECT '=== 검증 완료 요약 ===' as verification_step;

SELECT 
  COUNT(*) as total_artists,
  COUNT(CASE WHEN name IS NOT NULL THEN 1 END) as artists_with_name,
  COUNT(CASE WHEN portfolio_links IS NOT NULL AND jsonb_array_length(portfolio_links) > 0 THEN 1 END) as artists_with_portfolio,
  COUNT(CASE WHEN youtube_videos IS NOT NULL AND jsonb_array_length(youtube_videos) > 0 THEN 1 END) as artists_with_youtube,
  ROUND(
    COUNT(CASE WHEN name IS NOT NULL THEN 1 END) * 100.0 / COUNT(*), 
    2
  ) as data_completion_rate
FROM artists;