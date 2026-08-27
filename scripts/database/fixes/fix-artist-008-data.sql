-- ⛔ 실행 금지 표시 — Supabase(PostgreSQL) 전용, 2026-08-26 Turso 컷오버로 사문화됐다.
--
-- 이 파일을 Supabase SQL Editor나 psql에 붙여넣지 마라. 운영 데이터의 권위는
-- 이제 Turso(SQLite)이고 앱은 Supabase를 어디에서도 읽지 않는다 — 실행하면
-- **버려진 사본만 바뀌고 화면은 그대로다.** 조용한 성공이 제일 나쁘다.
-- RLS·auth.uid()·DO $$ 같은 Postgres 전용 문법이라 Turso에 그대로 옮길 수도 없다.
-- 스키마 정본은 src/db/schema/ 이고, 변경은 drizzle-kit 마이그레이션으로 한다
-- (npm run db:generate → src/db/migrations/, 적용 절차는 scripts/turso/README.md).
--
-- ===========================================
-- 황경하(artist-008) 데이터 정합성 복원
-- artists.json의 실제 데이터로 데이터베이스 업데이트
-- ===========================================

-- 기존 잘못된 데이터 백업 (롤백용)
CREATE TABLE IF NOT EXISTS artists_backup_20241218 AS 
SELECT * FROM artists WHERE legacy_id = 'artist-008';

-- 황경하님의 정확한 데이터로 업데이트
UPDATE artists 
SET 
  name = '황경하',
  one_liner = '현장과 호흡하는 예술, 민중과 함께하는 예술을 통해 힘없는 이들과 연대하는 다방면의 활동가입니다.',
  bio = '힘없는 이들이 필요로 하는 순간에 역할을 할 수 있도록 작가, 음악가, 사진가, 기획자, 제작자 등 여러 분야에서 활동 중입니다. 현장에서 글, 음악, 사진 등의 예술이 힘을 갖는 순간에 특별히 주목하며 움직이고 있습니다.

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
  profile_photo_url = '/images/artists/hwang.webp',
  portfolio_links = '[
    {"title": "포트폴리오", "url": "https://hwangtab.github.io/home"},
    {"title": "Instagram", "url": "https://www.instagram.com/podopodopo/"},
    {"title": "Threads", "url": "https://www.threads.com/@podopodopo"},
    {"title": "Facebook", "url": "https://www.facebook.com/hwangtab"},
    {"title": "Youtube", "url": "https://www.youtube.com/@artliberationfront"}
  ]'::jsonb,
  youtube_videos = '[
    {"title": "경하와 세민 - 혼약의 기도 MV", "url": "https://www.youtube.com/watch?v=EsFqpkUfxxE"},
    {"title": "황경하 - 눈녹듯 (Official Lyric Video)", "url": "https://www.youtube.com/watch?v=WmI2EPjLr0c"},
    {"title": "노컨트롤 - 히로시마 (@북조선 펑크 록커 리성웅의 \"활약\")", "url": "https://www.youtube.com/watch?v=c4ZyFDny2l8"}
  ]'::jsonb,
  contact = 'hwangtab@gmail.com',
  updated_at = NOW()
WHERE legacy_id = 'artist-008';

-- 업데이트 결과 확인
SELECT 
  legacy_id,
  slug,
  name,
  one_liner,
  LEFT(bio, 100) || '...' as bio_preview,
  jsonb_array_length(portfolio_links) as portfolio_count,
  jsonb_array_length(youtube_videos) as youtube_count,
  contact,
  updated_at
FROM artists 
WHERE legacy_id = 'artist-008';

-- 성공 메시지
SELECT '✅ 황경하님의 아티스트 데이터가 성공적으로 복원되었습니다!' as result;
