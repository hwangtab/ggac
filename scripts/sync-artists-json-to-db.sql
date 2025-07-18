-- ===========================================
-- JSON 데이터를 데이터베이스와 동기화하는 스크립트
-- artists.json의 모든 데이터를 데이터베이스에 정확히 반영
-- ===========================================

-- 안전을 위한 백업 테이블 생성
CREATE TABLE IF NOT EXISTS artists_backup_full_20241218 AS 
SELECT * FROM artists;

-- 전체 아티스트 데이터 동기화
-- 주의: 이 스크립트는 artists.json의 모든 데이터로 DB를 완전히 덮어씁니다.

-- 기존 데이터 삭제 (필요시)
-- DELETE FROM artists;

-- 전체 아티스트 데이터 재삽입
INSERT INTO artists (legacy_id, slug, name, category, profile_image, one_liner, bio, template_type, portfolio_links, youtube_videos, contact)
VALUES 
  -- artist-001: 사바하
  (
    'artist-001', 
    'sabbaha', 
    '사바하', 
    ARRAY['창작자', '기획자'], 
    '/images/artists/choi-hee-chul.webp', 
    '슬러지에서 기어 올라온 하이게인 둠 거인으로 운명을 뒤트는 고통을 표현합니다.', 
    '경기아트콜렉티브 협동조합 이사장. 서울을 기반으로 활동하는 드론메탈-슬러지-즉흥음악 듀오. 슬러지에서 기어 올라온 하이게인 둠 거인으로 운명을 뒤트는 고통을 표현합니다. 사바하의 음악은 극도로 느리고 무거운 사운드를 특징으로 하는 둠 메탈에, 지속적인 저음과 음의 질감을 강조하는 드론 음악의 요소를 더한 것이 특징입니다.

### 음악 장르
- 사이비 오컬트 둠드론 
- 둠메탈', 
    '미니멀형', 
    '[
      {"title": "Instagram", "url": "https://www.instagram.com/Sabbaha_kr"},
      {"title": "X", "url": "https://www.twitter.com/sabbaha_doom"},
      {"title": "Bandcamp", "url": "https://yahoyahodan.bandcamp.com/"},
      {"title": "Youtube", "url": "https://www.youtube.com/@Sabbaha_doom"}
    ]'::jsonb, 
    '[
      {"title": "Sabbaha - the Hechyeomoyeo 2025 @light gallery 250405", "url": "https://www.youtube.com/watch?v=FK7abbU4Lno"},
      {"title": "사바하 (2025.04.19 @부산 리얼라이즈", "url": "https://www.youtube.com/watch?v=Wp5spc3DpBQ"}
    ]'::jsonb, 
    'sabbaha.doom@gmail.com'
  ),
  
  -- artist-002: Simon DM
  (
    'artist-002', 
    'simon-dm', 
    'Simon DM', 
    ARRAY['창작자'], 
    '/images/artists/simon-dm.jpg', 
    '사운드와 서사가 교차하는 지점에서 감정의 서사를 그려냅니다.', 
    'Simon DM(前 국가대표기타선수)은 기타리스트이자 프로듀서로 활동합니다. Progressive Metal을 기반으로 Rock과 Pop은 물론, 오케스트라와 시네마틱 사운드에 이르기까지 다양한 장르를 넘나들며, 자신만의 음악 세계를 구축해왔습니다.

### 음악 철학
테크닉을 넘어 감정의 서사에 집중하며, 사운드 디자인으로 무의식의 풍경을 그려냅니다. 무대 위에서는 퍼포먼스를 통해 음악과 몸, 공간이 하나가 되는 몰입의 순간을 연출하며, 음악을 하나의 ''현실 조작 도구''로 삼아 청자에게 깊은 감각적 경험을 제공합니다.

### 주요 장르 
 
- Progressive Metal 
- Cinematic Rock 
- Ambient 
- Industrial 
- Experimental Pop

### 대표작 
- 2019 ''Mind Control Universe'' - ''나만이 나를 지킬 수 있었다''는 철학 아래 상처와 회복, 각성과 통합의 여정을 담은 정규 앨범
- 2023 KBS1 특집드라마 "갈채" OST 기타세션
- 현재 두 번째 정규 앨범 준비 중

### 경력 
- 전 supabros ent 전속 편곡가, 세션
- 전 Magnetic sound 상무이사, 프로듀서, 디렉터
- 전 K2 김성면 기타세션
- 현 Rosalyn Song 기타', 
    '콜라주형', 
    '[
      {"title": "Instagram", "url": "https://instagram.com/constant_____motion"},
      {"title": "Youtube", "url": "https://www.youtube.com/@thediem"}
    ]'::jsonb, 
    '[
      {"title": "The Diem - Illusion Syndrome", "url": "https://www.youtube.com/watch?v=_KMoM5s64TA"},
      {"title": "김국대 공연실황 - Trip", "url": "https://www.youtube.com/watch?v=j2_wjcCo6mc"}
    ]'::jsonb, 
    'lizard1022@naver.com'
  ),
  
  -- artist-008: 황경하 (올바른 데이터)
  (
    'artist-008', 
    'hwang-gyeong-ha', 
    '황경하', 
    ARRAY['창작자', '기획자'], 
    '/images/artists/hwang.webp', 
    '현장과 호흡하는 예술, 민중과 함께하는 예술을 통해 힘없는 이들과 연대하는 다방면의 활동가입니다.', 
    '힘없는 이들이 필요로 하는 순간에 역할을 할 수 있도록 작가, 음악가, 사진가, 기획자, 제작자 등 여러 분야에서 활동 중입니다. 현장에서 글, 음악, 사진 등의 예술이 힘을 갖는 순간에 특별히 주목하며 움직이고 있습니다.

### 음악적 여정 

록과 포크를 넘나들며 자신만의 음악 세계를 구축해왔습니다. 밴드 ''노컨트롤'' 시절 펑크와 얼터너티브 록으로 주목받았고, 이후에는 포크 음악에 주력하며 서정성과 친밀감을 살린 곡들을 선보였습니다. 그의 노래에는 시대에 대한 문제의식, 사회적 약자에 대한 연민이 배어 있습니다.

### 사회 참여와 연대 

''자립음악생산조합''과 ''예술해解放전선''에서의 활동을 통해 음악인들의 자립과 연대를 도모하고, 상업주의에 맞서는 대안적 음악 생태계 구축을 모색했습니다. 재개발과 젠트리피케이션으로 삶의 터전을 잃은 이들과 연대하며, 그들의 이야기를 음악과 전시 등 예술적 실천으로 풀어내고 있습니다.

### 주요 프로듀싱 작업 

- 〈테이크아웃드로잉〉(2015) 프로듀서
- 〈젠트리피케이션〉(2016) 프로듀서
- 〈콜트콜텍 투쟁 10주년 기념음반〉(2017) 프로듀서
- 〈새 민중음악 선곡집 1, 2, 3〉(2017-2018) 프로듀서
- 〈몸의 중심〉(2019) 프로듀서
- 〈물고기는 물이 없으면 죽어요〉(2022) 프로듀서
- 〈여린잎〉(2024) 프로듀서

### 개인 작업 

- 〈눈녹듯〉(2024) 발매
- 아현포차 요리책(2017) 기획, 집필
- 전시 〈노량진 - 터, 도시, 사람〉 기획(2020)

### 수상 경력 

- 2012 다음뮤직 이달의 음반 (앨범 〈No Control〉)
- 2015 레드어워드 〈주목할만한 연대〉부문 수상
- 2017 레드어워드 〈현장〉부문 수상
- 2017 한국대중음악상 선정위원 특별상 수상
- 2019 레드어워드 〈주목할만한 연대〉부문 수상

### 예술적 지향 

황경하에게 예술은 개인의 영달을 위한 도구가 아니라 사회 변혁을 위한 수단입니다. 현장과 호흡하는 예술, 민중과 함께하는 예술을 지향하며, 명성과 부를 좇기보다 시대의 아픔에 공감하고 약자와 연대하는 예술을 실천하고 있습니다.', 
    '콜라주형', 
    '[
      {"title": "포트폴리오", "url": "https://hwangtab.github.io/home"},
      {"title": "Instagram", "url": "https://www.instagram.com/podopodopo/"},
      {"title": "Threads", "url": "https://www.threads.com/@podopodopo"},
      {"title": "Facebook", "url": "https://www.facebook.com/hwangtab"},
      {"title": "Youtube", "url": "https://www.youtube.com/@artliberationfront"}
    ]'::jsonb, 
    '[
      {"title": "경하와 세민 - 혼약의 기도 MV", "url": "https://www.youtube.com/watch?v=EsFqpkUfxxE"},
      {"title": "황경하 - 눈녹듯 (Official Lyric Video)", "url": "https://www.youtube.com/watch?v=WmI2EPjLr0c"},
      {"title": "노컨트롤 - 히로시마 (@북조선 펑크 록커 리성웅의 \"활약\")", "url": "https://www.youtube.com/watch?v=c4ZyFDny2l8"}
    ]'::jsonb, 
    'hwangtab@gmail.com'
  )

ON CONFLICT (legacy_id) 
DO UPDATE SET 
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  profile_image = EXCLUDED.profile_image,
  one_liner = EXCLUDED.one_liner,
  bio = EXCLUDED.bio,
  template_type = EXCLUDED.template_type,
  portfolio_links = EXCLUDED.portfolio_links,
  youtube_videos = EXCLUDED.youtube_videos,
  contact = EXCLUDED.contact,
  updated_at = NOW();

-- 동기화 결과 확인
SELECT 
  legacy_id,
  name,
  LEFT(one_liner, 50) || '...' as one_liner_preview,
  template_type,
  jsonb_array_length(portfolio_links) as portfolio_count,
  jsonb_array_length(youtube_videos) as youtube_count,
  updated_at
FROM artists 
WHERE legacy_id IN ('artist-001', 'artist-002', 'artist-008')
ORDER BY legacy_id;

-- 성공 메시지
SELECT '✅ 핵심 아티스트 데이터 동기화가 완료되었습니다!' as result;

-- 추가 참고사항
SELECT '💡 전체 12명의 아티스트 동기화를 원한다면 나머지 9명의 데이터도 이 스크립트에 추가하세요.' as note;