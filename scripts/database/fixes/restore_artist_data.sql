-- Supabase 아티스트 데이터 복구 SQL
-- JSON 백업에서 정상 데이터로 가짜 데이터 교체

-- 로잘린송(Rosalyn Song) 복구
UPDATE artists 
SET 
  bio = '로잘린송은 영성과 테크놀로지, 기억과 정체성의 경계에서 사운드와 이미지, 서사를 통해 감각의 새로운 연결 방식을 탐구하는 아티스트입니다.

### 예술적 여정 

2009년부터 미국에서 현대사진가로 활동을 시작했으며, 2011년에는 한국에서 첫 개인전을 열었습니다. 2020년부터는 사진, 드로잉, 사운드, 영상, 서사 창작 등 다양한 매체를 실험하며, 단순히 ''보는'' 시각예술을 넘어 멀티센서리 혹은 공감각적인 예술 경험을 지향하는 복합적인 작업 세계를 구축해왔습니다.

### 음악적 전환 

음악적으로는 2021년 첫 싱글 ''Surfer Girl''을 발표하며 음악을 통한 새로운 표현의 가능성을 열었고, 2022년 반려견의 죽음 이후 삶과 정체성에 대한 깊은 성찰을 거쳐, 자신의 예술은 무대 위에서 비로소 완성된다는 사실을 깨닫고 2024년부터 본격적으로 가수로 활동하고 있습니다.

### 현재 작업 

현재는 음악, 웹소설, 퍼포먼스, 영상 작업을 아우르며, 데이터와 꿈, 감정과 코드가 만나는 ''서사적 우주''를 구축 중입니다.

### 주요 장르 
 
- 신스팝 
- 일렉트로닉',
  one_liner = '영성과 테크놀로지, 기억과 정체성의 경계에서 멀티센서리 예술 경험을 창조합니다.',
  portfolio_links = '[
    { "title": "Instagram", "url": "https://www.instagram.com/rosalynsong"},
    { "title": "Youtube", "url": "https://www.youtube.com/@rosalynsongofficial" }
  ]'::jsonb,
  youtube_videos = '[
    { "title": "Rosalyn Song - Mysterious Eyes", "url": "https://www.youtube.com/watch?v=DRdnlJlxA6A" },
    { "title": "Rosalyn Song - Pure Official Music Video", "url": "https://www.youtube.com/watch?v=sSBho9DxD_4" },
    { "title": "로잘린송 Rosalyn Song - 화성의 밤 Night on Mars Official Music Video", "url": "https://www.youtube.com/watch?v=k6w2jF1iUZI" }
  ]'::jsonb,
  contact = 'durisongsong@gmail.com',
  category = ARRAY['창작자'],
  template_type = '콜라주형',
  updated_at = NOW()
WHERE legacy_id = 'artist-003';

-- themilliways (더 밀리웨이스) 복구
UPDATE artists 
SET 
  bio = 'themilliways(더 밀리웨이스)는 음악가 주진태가 전개하는 1인 솔로 프로젝트로, 앰비언트와 포스트 록을 기반으로 한 감성적이면서도 실험적인 사운드스케이프를 지향합니다.

### 음악적 시작 

2000년대 초반부터 작곡 활동을 시작했으며, Nirvana와 Sonic Youth 등 거칠고 RAW한 사운드에 영향을 받아 음악을 시작하게 되었습니다. 사회운동 및 저항 문화에 관심을 가지며, 국내 최초의 정보통신 산별 노동조합인 ''한국정보통신노동조합''의 설립에 초대 사무국장으로 함께 하기도 했습니다.

### 밴드 활동과 사회 참여 

2007년 멍구밴드를 결성, 기타리스트로서 새만금 간척사업에 반대하는 살살페스티벌에서 데뷔, 이후 노동 운동, 반전평화, 대자본의 무분별한 젠트리피케이션에 저항하는 농성 현장 (특히 홍대 두리반) 등에서 공연으로 2014년까지 각종 다양한 투쟁의 현장에서 펑크 록을 통해 저항적 메시지를 전달-연대 해왔습니다.

### 미디어와 음악의 만남 

2005년부터 2015년까지 서태지 컴퍼니에서 콘텐츠 프로듀서 및 크리에이티브 디렉터로 활동하며 음악과 미디어의 교차점에서 다양한 실험을 이어왔습니다.

### 새로운 시작 

2017년 폐암 말기 진단 이후 생존과 회복의 시간 속에서 자신만의 음악 세계를 구축해나가기로 결심하여, 자신의 본질을 되돌아보기 위한 여정의 시작으로 2021년 12월 27일 솔로 프로젝트 themilliways로서 첫 EP 〈3rd air〉를 발표하며 정식 데뷔했습니다.

### 현재 

이후 《Void》, 《Disappear》, 《Ian EP》 등을 발표하며 자신만의 음악 세계를 확장해오고 있으며, 동시에 장르적 경계를 넘나드는 실험과 크로스오버에도 꾸준히 도전하고 있습니다.

### 주요 장르 

 
- 앰비언트 록 
- 실험 록 
- 포스트 록 
- 아트록 
- 인스트루멘탈

### 콘텐츠 제작
- 2008 서태지 Seotaiji 8th Atmos Part Moai 티저 음악 작곡
- 2009 서태지 Seotaiji 8th Atmos Part Secret 티저 음악 작곡
- 2009-2013 서태지 8집 영상 컨텐츠 크리에이티브 디렉터
- 2014-2015 서태지 9집 공연 및 컨텐츠 크리에이티브 디렉터

### 음악 활동
- 2007-2015 멍구밴드 기타리스트
- 2013 만파식적 베이시스트
- 2014 파괴왕 베이시스트
- 2019 황보령 밴드 SmackSoft 20주년 기념 공연 베이스 세션

### 솔로 활동
- 2021.12.27 솔로 데뷔 themilliways - 3rd air
- 2024.07.07 Void 싱글 발매
- 2024.10.31 Special EP Ian 발매
- 2024.12.08 Disappear 싱글 발매
- 2024.10.03 Mixtape Mavericks Market @ 롱플레이어 수원 공연 참여
- 2025.01.25 탄핵기원음악회 @ 책방만유인력 공연 참여',
  one_liner = '생존과 회복의 시간 속에서 감성적이면서도 실험적인 사운드스케이프를 구축해나갑니다.',
  portfolio_links = '[
    { "title": "포트폴리오", "url": "https://themilliways.com" },
    { "title": "Youtube", "url": "https://www.youtube.com/channel/UCA-GAtUMVuzeYAh2eY58kZg"}
  ]'::jsonb,
  youtube_videos = '[
    { "title": "themilliways - Void (audio visualization)", "url": "https://www.youtube.com/watch?v=-kKFpasA9ec" },
    { "title": "themilliways - 3rd air expanse Official Music Video", "url": "https://www.youtube.com/watch?v=ygOMXarTP18" }
  ]'::jsonb,
  contact = 'me@jtjoo.com',
  category = ARRAY['창작자'],
  template_type = '콜라주형',
  updated_at = NOW()
WHERE legacy_id = 'artist-004';

-- 유동혁 복구
UPDATE artists 
SET 
  bio = '젊은 날에 펑크록 밴드를 하다 멤버를 잃고 방황하며 통기타를 잡고 살았습니다.

### 음악적 여정 

펑크록의 에너지에서 시작해 인생의 변곡점을 거쳐 펑크포크라는 독특한 장르로 자신만의 색깔을 찾아가고 있습니다. 상실의 아픔과 방황의 시간들이 고스란히 녹아든 음악으로, 거칠면서도 따뜻한 감성을 전달합니다.

### 주요 장르 

펑크포크',
  one_liner = '펑크록에서 펑크포크로, 상실과 방황을 통해 찾아낸 자신만의 음악 세계를 펼쳐갑니다.',
  portfolio_links = '[
    { "title": "Facebook", "url": "https://www.facebook.com/amuro4" },
    { "title": "Instagram", "url": "https://www.instagram.com/donghyukyoo" },
    { "title": "Youtube", "url": "https://www.youtube.com/@yoodonghyuk"}
  ]'::jsonb,
  youtube_videos = '[
    { "title": "유동혁 - 반추 (2023.2.4 @물고기는 물이 없으면 죽어요) (라이브)", "url": "https://youtu.be/becnxwNb55g?si=2oi4zFpfrhUMcSNp&t=5989" },
    { "title": "유동혁 - 반추", "url": "https://www.youtube.com/watch?v=e4x3Oqf-quM" }
  ]'::jsonb,
  contact = 'amuro4@naver.com',
  category = ARRAY['창작자'],
  template_type = '미니멀형',
  updated_at = NOW()
WHERE legacy_id = 'artist-005';

-- 최기타 복구
UPDATE artists 
SET 
  bio = '솔로 아티스트로서 그리고 밴드에서 활동하며 기타의 다양한 가능성을 탐구하는 음악가입니다.

### 솔로 활동 

개인 작업으로 ''Warm Night'', ''Space 11'' 등을 발표하며 인스트루멘탈 음악의 서정적이고 공간감 있는 사운드를 선보이고 있습니다.

### 밴드 활동 

현재 밴드 ''Try Uncle''(준비중)에서 기타리스트로 활동 중이며, 이전에는 밴드 ''obida''에서 ''Montyhall'', ''Samuel'' 등의 곡으로 활동했습니다.

### 주요 장르 

 
- Instrument',
  one_liner = '솔로 아티스트와 밴드 활동을 넘나들며 기타로 다양한 음악적 색채를 그려냅니다.',
  portfolio_links = '[
    { "title": "Instagram", "url": "https://www.instagram.com/choi_guitar/"},
    { "title": "Youtube", "url": "https://www.youtube.com/@GuitarChoi"}
  ]'::jsonb,
  youtube_videos = '[
    { "title": "Billie Eilish - Birds of a Feather (cover)", "url": "https://youtu.be/PfCpm_eReXs?si=ATK26Sa7-5sBuvXk" },
    { "title": "성시경 - 두사람 (cover)", "url": "https://youtu.be/jYM5WpbEVzE?si=hRyCkthirVPNdJ2p" },
    { "title": "이소라 - 바람이 분다 (cover)", "url": "https://youtu.be/eLOcQxV2PpQ?si=6KfVfGTuhKAbKsLC" },
    { "title": "고추잠자리 - 너라는 별 (cover)", "url": "https://youtu.be/HyuUeUxyx9Q?si=ykXxjT6VlcvOh8zs" },
    { "title": "FiftyFifty - Cupid (fingerstyle cover) l 최기타", "url": "https://youtu.be/rgzrECYpbNE?si=7t28TOjGz_o1A-tL" },
    { "title": "부활 - 사랑할수록 (cover) l 최기타", "url": "https://youtu.be/VUvA3Df-O6E?si=zL1_WDC4-HwUOfoH" },
    { "title": "최호섭 - 세월이 가면 (cover) l 최기타", "url": "https://youtu.be/LQfSz5tNdbY?si=ZdeNRCceHHEeukMF" },
    { "title": "박정운 - 오늘같은 밤이면 (cover) l 최기타", "url": "https://youtu.be/vV_1OH-xdak?si=njbl9iaF7O0nqL2v" }
  ]'::jsonb,
  contact = 'choisguitar@naver.com',
  category = ARRAY['창작자'],
  template_type = '콜라주형',
  updated_at = NOW()
WHERE legacy_id = 'artist-006';

-- 남수 복구
UPDATE artists 
SET 
  bio = '다재다능한 여성 솔로 아티스트로, 인디음악, 포크/블루스, 재즈, 뉴에이지 등 다양한 장르를 아우르는 음악을 선보입니다.

### 문화공간 운영 

"딱따구리 책방"이라는 문화공간을 운영하며 음악과 문학의 접점을 만들어가고 있습니다. 이 공간을 통해 예술가들과 관객들이 만나는 특별한 경험을 제공하고 있습니다.

### 예술적 확장 

앞으로 음악뿐만 아니라 미술, 퍼포먼스 등 다양한 예술 형태를 결합한 작업을 통해 자신의 예술적 경계를 확장해 나가고자 합니다.

### 주요 장르 

 
- 인디음악 
- 포크 
- 블루스 
- 재즈 
- 뉴에이지',
  one_liner = '음악과 문학, 그리고 다양한 예술 형태를 결합하여 경계를 확장해 나가는 다재다능한 아티스트입니다.',
  portfolio_links = '[
    { "title": "Instagram", "url": "https://www.instagram.com/namsu_ggu" },
    { "title": "Youtube", "url": "https://www.youtube.com/@namsu_ggu"}
  ]'::jsonb,
  youtube_videos = '[
    { "title": "남수 - 그래도 (2024.4.23 @세종호텔 정리해고 철회를 위한 거리기도회)", "url": "https://www.youtube.com/watch?v=estA7dtKUS4" },
    { "title": "남수 - 꼴찌를 위하여 (2024.6.13 @동서울터미널에서 쫓겨난 상인들과)", "url": "https://www.youtube.com/watch?v=rqZmYu_kvVQ" }
  ]'::jsonb,
  contact = '',
  category = ARRAY['창작자'],
  template_type = '미니멀형',
  updated_at = NOW()
WHERE legacy_id = 'artist-007';

-- Zsthyger 복구
UPDATE artists 
SET 
  bio = '악기와 악사의 가치를 증명하는 방법은 연주뿐이다.

### ACME 스튜디오

- 준비 중

### 주요 장르 

- 전자음악
- 메탈
- 클래식',
  one_liner = '말로 표현할 수 없는 것들을 전하기 위한 여행을 기록합니다.',
  portfolio_links = '[
    { "title": "Instagram", "url": "https://www.instagram.com/zsthyger" }
  ]'::jsonb,
  youtube_videos = '[
    { "title": "El Patron - The Alliance", "url": "https://www.youtube.com/watch?v=lxDUrUut0Os" },
    { "title": "Panzerkorps - The Flag Taken Back", "url": "https://www.youtube.com/watch?v=sQnlWqGrorg" }
  ]'::jsonb,
  contact = 'eutaxmusic@gmail.com',
  category = ARRAY['창작자', '프로듀서', '편곡가', '기타', '연주자'],
  template_type = '콜라주형',
  updated_at = NOW()
WHERE legacy_id = 'artist-009';

-- 장현호 복구
UPDATE artists 
SET 
  bio = '싱어송라이터 장현호는 2011년 결성된 길가는밴드의 중심 인물입니다. 밴드의 거의 모든 곡을 직접 작사, 작곡하며 길가는밴드의 음악적 방향과 메시지를 만들어 왔습니다.
그는 거리형 밴드의 특징을 살려 사회적 투쟁 현장에 꾸준히 참여하며 노래로 연대해왔습니다. 세월호 참사, 제주 해군기지 강정마을 투쟁, KTX 해고 승무원 복직 투쟁 등 수많은 현장에서 노래를 통해 사회 문제를 제기하고 평화 감수성을 일깨우는 역할을 했습니다.
장현호의 곡들은 소외된 이들과 보통 사람들을 연결하고, 아픔의 현장을 위로하려는 진심을 담고 있습니다. ''75m 위'', ''다시 빛날 우리''와 같은 곡들이 그의 이러한 음악 철학을 잘 보여줍니다. 또한, 길가는밴드의 첫 정규 앨범에 수록된 ''Seed Song''은 그가 만든 첫 노래이자 밴드가 노래하는 이유를 담한 곡으로, 그의 음악적 시작과 깊은 뜻을 엿볼 수 있습니다.
그는 보컬과 어쿠스틱 기타를 담당하며, 앨범 작업에서 작사, 작곡 외에도 코러스에 참여하는 등 음악 제작 전반에 걸쳐 핵심적인 역할을 합니다. 길가는밴드 특유의 사운드에는 장현호의 음악적 개성이 짙게 반영되어 있습니다.
장현호는 사회적 메시지를 전달하는 핵심적인 싱어송라이터입니다.

### 음악 장르
- 포크 
- 록',
  one_liner = '장현호의 곡들은 소외된 이들과 보통 사람들을 연결하고, 아픔의 현장을 위로하려는 진심을 담고 있습니다.',
  profile_photo_url = '/images/artists/janghyunho.png',
  portfolio_links = NULL,
  youtube_videos = '[
    {
      "url": "https://youtu.be/PMyLQUw_6Co?si=9LTtT3uH1Xl2UhpK"
    },
    {
      "url": "https://youtu.be/T5ARG_t-f4A?si=HPOhNrkx7H1Lv7wc"
    },
    {
      "url": "https://youtu.be/bmDyt0mr1Kw?si=MjhmC53C3Uxo7VY3"
    }
  ]'::jsonb,
  contact = NULL,
  category = ARRAY['창작자'],
  template_type = '미니멀형',
  updated_at = NOW()
WHERE legacy_id = 'artist-010';

-- ANAZAO(아나자오) 복구
UPDATE artists 
SET 
  bio = '신을 찾는 여정 속 철학적인 가사들을 풀어냅니다.

### 음악 장르
- 힙합',
  one_liner = '신을 찾는 여정 속 철학적인 가사들을 풀어냅니다.',
  profile_photo_url = '/images/artists/anazao.jpg',
  portfolio_links = '[
    {
      "title": "Linktree",
      "url": "https://linktr.ee/anazao.official"
    }
  ]'::jsonb,
  youtube_videos = '[
    {
      "url": "https://www.youtube.com/watch?v=HnaTVD96pGE"
    },
    {
      "url": "https://www.youtube.com/watch?v=6FZyTKFrFGA"
    },
    {
      "url": "https://www.youtube.com/watch?v=siEO6LiID5Q"
    },
    {
      "url": "https://www.youtube.com/watch?v=lPm20bzRjEw"
    }
  ]'::jsonb,
  contact = NULL,
  category = ARRAY['창작자'],
  template_type = '미니멀형',
  updated_at = NOW()
WHERE legacy_id = 'artist-011';

-- 희우 복구
UPDATE artists 
SET 
  bio = '희우는 독보적인 소리꾼이자 싱어송라이터입니다. 그는 전통 판소리 창법을 기반으로 현대적인 음악을 선보이며 자신만의 독창적인 음악 세계를 구축하고 있습니다.
희우의 음악은 그가 직접 겪은 삶의 막막함과 해결되지 않는 문제들을 예술로 승화시키는 특징을 가집니다. 그의 노래는 판소리 창법을 활용한 크로스오버 장르로, 전통적인 멜로디에 현대적인 감각과 실험적인 편곡을 더해 깊이와 새로움을 동시에 전달합니다. 특히 희우의 목소리는 이별의 슬픔과 같은 깊은 감정을 담담하면서도 절제된 방식으로 표현합니다. 트로트의 꺾기 창법을 피해 신파에 빠지지 않으면서도, 듣는 이에게 오장육부가 끊어지는 듯한 애절한 통증을 전달하는 능력이 탁월합니다. 또한 대금과 가야금 같은 전통 악기 사운드를 현대적으로 재해석하여, 시간을 초월한 상실감과 망연자실함을 느끼게 합니다.
희우는 전통 음악의 깊은 영혼과 현대 음악의 혁신적인 요소를 결합하여, 인디 음악계에서 주목받는 독창적인 아티스트로 활동하고 있습니다.

### 음악 장르
- 포크
- 판소리',
  one_liner = '전통 판소리 창법을 기반으로 현대적인 음악을 선보이며 자신만의 독창적인 음악 세계를 구축하고 있습니다.',
  profile_photo_url = '/images/artists/heewoo.jpg',
  portfolio_links = NULL,
  youtube_videos = '[
    {
      "url": "https://youtu.be/j5PuwQVzRe8?si=tPAvRkOwW90lAjOV"
    },
    {
      "url": "https://youtu.be/fTmh92Lmo-w?si=AXdNd9jMo6u0yPgi"
    },
    {
      "url": "https://youtu.be/y2vAwxSaWb0?si=PlILwDg5C12rPoJL"
    }
  ]'::jsonb,
  contact = NULL,
  category = ARRAY['창작자'],
  template_type = '콜라주형',
  updated_at = NOW()
WHERE legacy_id = 'artist-012';

-- 업데이트 완료 확인
SELECT legacy_id, name, one_liner, 
       CASE WHEN LENGTH(bio) > 50 THEN LEFT(bio, 50) || '...' ELSE bio END as bio_preview
FROM artists 
WHERE legacy_id IN ('artist-003', 'artist-004', 'artist-005', 'artist-006', 'artist-007', 'artist-009', 'artist-010', 'artist-011', 'artist-012')
ORDER BY legacy_id;
