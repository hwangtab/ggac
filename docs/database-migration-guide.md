# 데이터베이스 마이그레이션 가이드

## 개요
마이페이지 시스템 구축을 위한 데이터베이스 마이그레이션 과정을 안내합니다.

## 마이그레이션 단계

### 1단계: 테이블 구조 마이그레이션

Supabase 대시보드의 SQL Editor에서 다음 파일을 실행:

1. **`supabase/migrations/005_add_artist_fields_to_member_profiles.sql`**
   - member_profiles 테이블에 아티스트 관련 컬럼 추가
   - artists 테이블 생성
   - RLS 정책 설정
   - 인덱스 및 트리거 생성

### 2단계: 아티스트 데이터 마이그레이션

1. **`scripts/migrate-artists-data.sql`** 실행
   - 기존 artists.json 데이터를 artists 테이블로 이관
   - 12명의 아티스트 데이터 삽입

## 실행 방법

### Supabase 대시보드에서 실행

1. Supabase 프로젝트 대시보드 접속
2. 좌측 메뉴에서 "SQL Editor" 선택
3. "New Query" 클릭
4. 마이그레이션 파일 내용 복사/붙여넣기
5. "Run" 버튼 클릭

### 실행 순서
1. `005_add_artist_fields_to_member_profiles.sql` 먼저 실행
2. `migrate-artists-data.sql` 나중에 실행

## 검증 방법

마이그레이션 완료 후 다음 쿼리로 검증:

```sql
-- 1. member_profiles 테이블 구조 확인
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'member_profiles' 
AND column_name IN ('artist_id', 'is_artist', 'artist_role');

-- 2. artists 테이블 데이터 확인
SELECT legacy_id, slug, name, template_type, contact
FROM public.artists 
ORDER BY legacy_id;

-- 3. RLS 정책 확인
SELECT tablename, policyname, permissive, cmd
FROM pg_policies 
WHERE tablename = 'artists';

-- 4. 함수 확인
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'get_artist_by_member_id';
```

## 아티스트 ID 매핑 테이블

관리자가 조합원 승인 시 참조할 아티스트 ID 목록:

| Legacy ID | Artist Name | Slug | Contact |
|-----------|------------|------|---------|
| artist-001 | 사바하 | sabbaha | sabbaha.doom@gmail.com |
| artist-002 | Simon DM | simon-dm | lizard1022@naver.com |
| artist-003 | 로잘린송 | rosalyn-song | durisongsong@gmail.com |
| artist-004 | themilliways | themilliways | me@jtjoo.com |
| artist-005 | 유동혁 | yoo-dong-hyuk | amuro4@naver.com |
| artist-006 | 최기타 | choi-guitar | choisguitar@naver.com |
| artist-007 | 남수 | namsu | - |
| artist-008 | 황경하 | hwang-gyeong-ha | hwangtab@gmail.com |
| artist-009 | ACMEin | acmein | eutaxmusic@gmail.com |
| artist-010 | 장현호 | jang-hyun-ho | - |
| artist-011 | ANAZAO | anazao | - |
| artist-012 | 희우 | heewoo | - |

## 조합원 승인 시 아티스트 할당 방법

1. Supabase 대시보드 → Table Editor → member_profiles
2. 승인할 조합원 찾기
3. 다음 필드 업데이트:
   - `registration_status`: 'approved'
   - `is_artist`: true (아티스트인 경우)
   - `artist_id`: 해당하는 legacy_id (예: 'artist-001')
   - `artist_role`: 'owner'

## 롤백 방법 (필요시)

```sql
-- artists 테이블 삭제
DROP TABLE IF EXISTS public.artists CASCADE;

-- member_profiles에서 아티스트 관련 컬럼 제거
ALTER TABLE public.member_profiles 
DROP COLUMN IF EXISTS artist_id,
DROP COLUMN IF EXISTS is_artist,
DROP COLUMN IF EXISTS artist_role;

-- 함수 삭제
DROP FUNCTION IF EXISTS public.get_artist_by_member_id;
DROP FUNCTION IF EXISTS public.update_updated_at_column;

-- 뷰 삭제
DROP VIEW IF EXISTS public.artist_members;
```

## 주의사항

1. **백업**: 마이그레이션 전 데이터베이스 백업 권장
2. **테스트**: 프로덕션 환경 적용 전 개발 환경에서 테스트
3. **권한**: 마이그레이션 실행 시 적절한 권한 필요
4. **트랜잭션**: 각 마이그레이션은 트랜잭션으로 묶여 있어 실패 시 롤백됨

## 문제 해결

### 일반적인 오류

1. **Permission Denied**: 
   - Supabase 프로젝트 소유자 권한으로 실행
   
2. **Table Already Exists**:
   - 기존 테이블이 있는 경우 롤백 후 재실행
   
3. **Constraint Violation**:
   - 데이터 중복 확인 후 중복 제거

### 도움이 필요한 경우

- Supabase 대시보드의 Logs 섹션에서 에러 로그 확인
- 마이그레이션 실행 전후 데이터베이스 상태 비교
- 필요시 개발팀에 문의