-- Migration script to populate artists table with data from artists.json
-- This script should be run after the 005_add_artist_fields_to_member_profiles.sql migration

BEGIN;

-- Insert artist data from artists.json
INSERT INTO public.artists (legacy_id, slug, name, category, profile_image, one_liner, bio, template_type, portfolio_links, youtube_videos, contact)
VALUES 
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
  (
    'artist-003', 
    'rosalyn-song', 
    '로잘린송(Rosalyn Song)', 
    ARRAY['창작자'], 
    '/images/artists/rosalyn-song.webp', 
    '영성과 테크놀로지, 기억과 정체성의 경계에서 멀티센서리 예술 경험을 창조합니다.', 
    '로잘린송은 영성과 테크놀로지, 기억과 정체성의 경계에서 사운드와 이미지, 서사를 통해 감각의 새로운 연결 방식을 탐구하는 아티스트입니다.

### 예술적 여정 

2009년부터 미국에서 현대사진가로 활동을 시작했으며, 2011년에는 한국에서 첫 개인전을 열었습니다. 2020년부터는 사진, 드로잉, 사운드, 영상, 서사 창작 등 다양한 매체를 실험하며, 단순히 ''보는'' 시각예술을 넘어 멀티센서리 혹은 공감각적인 예술 경험을 지향하는 복합적인 작업 세계를 구축해왔습니다.

### 음악적 전환 

음악적으로는 2021년 첫 싱글 ''Surfer Girl''을 발표하며 음악을 통한 새로운 표현의 가능성을 열었고, 2022년 반려견의 죽음 이후 삶과 정체성에 대한 깊은 성찰을 거쳐, 자신의 예술은 무대 위에서 비로소 완성된다는 사실을 깨닫고 2024년부터 본격적으로 가수로 활동하고 있습니다.

### 현재 작업 

현재는 음악, 웹소설, 퍼포먼스, 영상 작업을 아우르며, 데이터와 꿈, 감정과 코드가 만나는 ''서사적 우주''를 구축 중입니다.

### 주요 장르 
 
- 신스팝 
- 일렉트로닉', 
    '콜라주형', 
    '[
      {"title": "Instagram", "url": "https://www.instagram.com/rosalyn.song"},
      {"title": "Youtube", "url": "https://www.youtube.com/@rosegold_song"},
      {"title": "Soundcloud", "url": "https://soundcloud.com/rosegold-song"}
    ]'::jsonb, 
    '[
      {"title": "Rosalyn Song - 한복 입은 꿈 (Dream in Hanbok)", "url": "https://www.youtube.com/watch?v=Yp1bNh4I9Dw"},
      {"title": "Rosalyn Song - Surfer Girl (Live Version)", "url": "https://www.youtube.com/watch?v=HJZ5EZJ2Z7g"}
    ]'::jsonb, 
    'durisongsong@gmail.com'
  ),
  (
    'artist-004', 
    'themilliways', 
    'themilliways', 
    ARRAY['창작자'], 
    '/images/artists/themilliways.webp', 
    '메타버스와 현실의 경계를 탐구하며 디지털 시대의 새로운 정체성을 창조합니다.', 
    'themilliways(The Milliways)는 시공간의 경계를 넘나드는 실험적인 음악과 설치작업을 통해 디지털 시대의 새로운 정체성과 존재 방식을 탐구하는 아티스트입니다.

### 예술적 철학

The Milliways는 Douglas Adams의 소설 "은하수를 여행하는 히치하이커를 위한 안내서"에 등장하는 우주의 끝에 있는 레스토랑의 이름에서 따온 것으로, 시간과 공간의 경계가 모호한 상태에서 예술 작업을 진행합니다.

### 주요 장르

- Experimental Electronic
- Ambient
- Glitch
- Digital Art
- Interactive Installation

### 작업 영역

음악, 영상, 인터랙티브 설치, 메타버스 콘텐츠 등 다양한 매체를 통해 디지털 네이티브 세대의 감성과 경험을 표현하며, 특히 가상과 현실의 경계에서 발생하는 새로운 형태의 정체성과 관계성에 주목합니다.', 
    '콜라주형', 
    '[
      {"title": "Instagram", "url": "https://www.instagram.com/themilliways.official"},
      {"title": "Bandcamp", "url": "https://themilliways.bandcamp.com/"}
    ]'::jsonb, 
    '[
      {"title": "themilliways - Digital Drift", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
      {"title": "themilliways - Virtual Reality", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    ]'::jsonb, 
    'me@jtjoo.com'
  ),
  (
    'artist-005', 
    'yoo-dong-hyuk', 
    '유동혁', 
    ARRAY['창작자'], 
    '/images/artists/yoo-dong-hyuk.webp', 
    '전통과 현대의 만남을 통해 한국적 정서를 현대음악으로 표현합니다.', 
    '유동혁은 전통 한국 음악의 깊은 정서를 현대적인 사운드로 재해석하는 작업을 해온 창작자입니다.

### 음악적 배경

국악과 서양음악의 경계를 넘나들며, 특히 전통 타악기와 현대 전자음악의 결합을 통해 독특한 사운드스케이프를 창조합니다.

### 주요 장르

- Korean Traditional Fusion
- World Music
- Electronic World
- Experimental

### 작업 철학

과거와 현재, 동양과 서양의 경계를 허물며 새로운 형태의 월드뮤직을 창조하고 있으며, 특히 한국의 전통 리듬과 현대적 사운드의 조화를 추구합니다.', 
    '미니멀형', 
    '[
      {"title": "Instagram", "url": "https://www.instagram.com/yoodonghyuk.music"}
    ]'::jsonb, 
    '[
      {"title": "유동혁 - 장단의 변주", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    ]'::jsonb, 
    'amuro4@naver.com'
  ),
  (
    'artist-006', 
    'choi-guitar', 
    '최기타', 
    ARRAY['창작자'], 
    '/images/artists/choi-guitar.webp', 
    '기타를 통해 일상의 감정과 이야기를 솔직하게 표현하는 싱어송라이터입니다.', 
    '최기타는 어쿠스틱 기타를 중심으로 일상의 소소한 감정들을 솔직하고 담백하게 표현하는 싱어송라이터입니다.

### 음악적 스타일

단순하지만 깊이 있는 선율과 가사로 듣는 이들의 마음에 스며드는 음악을 만들며, 특히 기타의 따뜻한 음색을 바탕으로 한 어쿠스틱 사운드가 특징입니다.

### 주요 장르

- Acoustic Pop
- Singer-songwriter
- Indie Folk
- Korean Indie

### 작업 철학

복잡하지 않은 구성이지만 진솔한 감정 전달을 중요시하며, 일상에서 마주하는 작은 순간들의 소중함을 음악으로 표현합니다.', 
    '미니멀형', 
    '[
      {"title": "Instagram", "url": "https://www.instagram.com/choi.guitar.music"}
    ]'::jsonb, 
    '[
      {"title": "최기타 - 일상의 노래", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    ]'::jsonb, 
    'choisguitar@naver.com'
  ),
  (
    'artist-007', 
    'namsu', 
    '남수', 
    ARRAY['창작자'], 
    '/images/artists/namsu.webp', 
    '미니멀한 사운드로 내면의 깊은 감정을 표현하는 실험적 음악가입니다.', 
    '남수는 미니멀하고 실험적인 사운드를 통해 내면의 깊은 감정과 철학적 사유를 표현하는 음악가입니다.

### 음악적 특징

간결하면서도 깊이 있는 사운드 구성을 통해 듣는 이로 하여금 내면의 성찰을 이끌어내는 음악을 만듭니다.

### 주요 장르

- Minimal Electronic
- Ambient
- Experimental
- Sound Art

### 작업 철학

불필요한 요소들을 제거하고 본질에 집중하는 미니멀리즘을 추구하며, 음악을 통한 명상적 경험을 제공합니다.', 
    '미니멀형', 
    '[]'::jsonb, 
    '[]'::jsonb, 
    null
  ),
  (
    'artist-008', 
    'hwang-gyeong-ha', 
    '황경하', 
    ARRAY['창작자', '기획자'], 
    '/images/artists/hwang-gyeong-ha.webp', 
    '기술과 예술의 경계에서 새로운 창작 방법론을 탐구하는 크리에이티브 개발자입니다.', 
    '황경하는 기술과 예술의 경계에서 활동하는 크리에이티브 개발자이자 기획자입니다.

### 작업 영역

웹 개발, 인터랙티브 미디어, 디지털 아트 등 다양한 분야에서 기술을 활용한 창작 활동을 하고 있으며, 특히 협동조합의 디지털 인프라 구축과 운영을 담당하고 있습니다.

### 주요 관심사

- Creative Coding
- Interactive Media
- Digital Art
- Web Technologies
- Community Building

### 협동조합에서의 역할

경기아트콜렉티브 협동조합의 기술 총괄로서 웹사이트 개발, 디지털 플랫폼 구축, 온라인 커뮤니티 관리 등을 담당하며, 아티스트들이 디지털 환경에서 더 나은 창작 활동을 할 수 있도록 지원합니다.', 
    '콜라주형', 
    '[
      {"title": "GitHub", "url": "https://github.com/hwanggyeongha"},
      {"title": "Portfolio", "url": "https://hwanggyeongha.dev"}
    ]'::jsonb, 
    '[]'::jsonb, 
    'hwangtab@gmail.com'
  ),
  (
    'artist-009', 
    'acmein', 
    'ACMEin', 
    ARRAY['창작자'], 
    '/images/artists/acmein.webp', 
    '일렉트로닉 사운드를 기반으로 한 실험적이고 에너지 넘치는 음악을 만듭니다.', 
    'ACMEin은 일렉트로닉 음악을 기반으로 한 실험적이고 에너지 넘치는 사운드를 추구하는 프로듀서입니다.

### 음악적 스타일

다양한 전자음악 장르를 넘나들며 독창적인 사운드를 만들어내며, 특히 에너지 넘치는 비트와 실험적인 사운드 디자인이 특징입니다.

### 주요 장르

- Electronic
- Experimental Electronic
- IDM
- Breakbeat
- Ambient Techno

### 작업 특징

전통적인 일렉트로닉 음악의 틀을 벗어나 새로운 형태의 전자음악을 실험하며, 라이브 퍼포먼스에서도 독특한 에너지를 선보입니다.', 
    '콜라주형', 
    '[
      {"title": "Bandcamp", "url": "https://acmein.bandcamp.com/"}
    ]'::jsonb, 
    '[
      {"title": "ACMEin - Digital Pulse", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    ]'::jsonb, 
    'eutaxmusic@gmail.com'
  ),
  (
    'artist-010', 
    'jang-hyun-ho', 
    '장현호', 
    ARRAY['창작자'], 
    '/images/artists/jang-hyun-ho.webp', 
    '소리와 공간의 관계를 탐구하며 청각적 경험의 새로운 가능성을 제시합니다.', 
    '장현호는 소리와 공간의 관계를 깊이 탐구하며, 청각적 경험의 새로운 가능성을 제시하는 사운드 아티스트입니다.

### 작업 철학

공간 특정적 사운드 설치와 퍼포먼스를 통해 청중들에게 몰입적인 청각 경험을 제공하며, 소리가 공간과 어우러져 만들어내는 새로운 감각적 경험에 주목합니다.

### 주요 장르

- Sound Art
- Spatial Audio
- Experimental
- Installation Art
- Ambient

### 작업 방식

다양한 공간에서의 음향 특성을 연구하고, 그 공간만이 가질 수 있는 고유한 소리 환경을 창조하는 작업을 합니다.', 
    '미니멀형', 
    '[]'::jsonb, 
    '[]'::jsonb, 
    null
  ),
  (
    'artist-011', 
    'anazao', 
    'ANAZAO', 
    ARRAY['창작자'], 
    '/images/artists/anazao.webp', 
    '동양철학과 현대음악의 만남을 통해 영적 치유의 사운드를 추구합니다.', 
    'ANAZAO는 동양철학과 현대음악의 만남을 통해 영적 치유와 내면 성찰을 위한 사운드를 추구하는 아티스트입니다.

### 음악적 철학

음악을 단순한 엔터테인먼트가 아닌 영적 수행과 치유의 도구로 접근하며, 명상적이고 성찰적인 사운드를 통해 듣는 이들의 내면 여행을 돕습니다.

### 주요 장르

- Meditative Music
- Healing Sound
- New Age
- Ambient
- World Fusion

### 작업 특징

전통적인 동양악기와 현대적 사운드 프로세싱을 결합하여 독특한 치유 음악을 만들어내며, 명상과 요가 등의 수행 환경에서도 활용되는 음악을 작업합니다.', 
    '미니멀형', 
    '[]'::jsonb, 
    '[]'::jsonb, 
    null
  ),
  (
    'artist-012', 
    'heewoo', 
    '희우', 
    ARRAY['창작자'], 
    '/images/artists/heewoo.webp', 
    '감성적인 멜로디와 따뜻한 가사로 일상의 소중함을 노래하는 싱어송라이터입니다.', 
    '희우는 감성적인 멜로디와 따뜻한 가사로 일상의 소중함과 인간관계의 소중함을 노래하는 싱어송라이터입니다.

### 음악적 스타일

잔잔하고 따뜻한 사운드를 바탕으로 일상에서 느끼는 소소한 감정들을 섬세하게 표현하며, 듣는 이들에게 위로와 공감을 전달합니다.

### 주요 장르

- Indie Pop
- Singer-songwriter
- Acoustic
- K-Indie

### 작업 철학

화려하지 않더라도 진심이 담긴 음악, 일상의 작은 순간들 속에서 발견하는 아름다움을 음악으로 표현하는 것을 중요하게 생각합니다.', 
    '미니멀형', 
    '[]'::jsonb, 
    '[]'::jsonb, 
    null
  )
ON CONFLICT (legacy_id) DO UPDATE SET
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

-- Verify the data was inserted correctly
SELECT 
  legacy_id, 
  slug, 
  name, 
  array_length(category, 1) as category_count,
  template_type,
  contact
FROM public.artists 
ORDER BY legacy_id;

COMMIT;