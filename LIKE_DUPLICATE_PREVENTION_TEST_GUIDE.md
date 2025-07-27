# 좋아요 중복 방지 테스트 가이드

## 📋 개요

좋아요 버튼 2번 클릭 문제를 해결하기 위해 다층 중복 방지 시스템을 구현했습니다. 이 가이드는 수정사항을 검증하는 방법을 제공합니다.

## 🔧 구현된 중복 방지 메커니즘

### 1. 클라이언트 사이드 (PostLikeButton.tsx)
- **500ms 디바운싱**: 연속 클릭 방지
- **처리 중 상태 관리**: `isProcessing` 플래그
- **애니메이션 시간 연장**: 300ms → 500ms
- **마지막 클릭 시간 추적**: `lastClickTime` 기반 중복 차단

### 2. 서버 사이드 (API Route)
- **3초 중복 방지 창**: 동일 사용자/게시글 조합
- **원자적 캐시 처리**: 요청 진행 중 플래그
- **메모리 기반 캐싱**: 빠른 중복 감지

### 3. 데이터베이스 레벨 (toggle_post_like 함수)
- **REPEATABLE READ 격리**: 트랜잭션 안전성
- **행 레벨 락**: FOR UPDATE로 동시성 제어
- **UNIQUE 제약 조건**: 중복 삽입 방지
- **예외 처리**: unique_violation 자동 복구

### 4. React StrictMode 대응
- **AbortController**: 요청 취소 메커니즘
- **컴포넌트 마운트 상태**: 언마운트 시 요청 차단

## 🗄️ 데이터베이스 마이그레이션

### 1단계: Supabase SQL Editor 접속
1. [Supabase Dashboard](https://supabase.com/dashboard) 접속
2. 프로젝트 선택
3. 좌측 메뉴에서 "SQL Editor" 클릭

### 2단계: 마이그레이션 SQL 실행
```sql
-- 아래 SQL을 복사하여 SQL Editor에서 실행

-- 좋아요 토글 함수 안전성 강화
CREATE OR REPLACE FUNCTION toggle_post_like(
  p_post_id UUID,
  p_user_id UUID
) 
RETURNS TABLE(
  liked BOOLEAN,
  like_count INTEGER
) AS $$
DECLARE
  existing_like_id UUID;
  current_like_count INTEGER;
  is_post_deleted BOOLEAN := false;
BEGIN
  -- 트랜잭션 격리 수준 설정
  SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
  
  -- 게시글 존재 여부 및 삭제 상태 확인 (행 단위 락)
  SELECT is_deleted INTO is_post_deleted
  FROM posts 
  WHERE id = p_post_id
  FOR UPDATE;
  
  -- 게시글이 없거나 삭제된 경우 예외 처리
  IF NOT FOUND THEN
    RAISE EXCEPTION 'POST_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  
  IF is_post_deleted THEN
    RAISE EXCEPTION 'POST_DELETED' USING ERRCODE = 'P0002';
  END IF;
  
  -- 기존 좋아요 확인 (행 단위 락)
  SELECT id INTO existing_like_id
  FROM post_likes
  WHERE post_id = p_post_id AND user_id = p_user_id
  FOR UPDATE;

  IF existing_like_id IS NOT NULL THEN
    -- 좋아요 취소
    DELETE FROM post_likes WHERE id = existing_like_id;
    
    SELECT like_count INTO current_like_count
    FROM posts WHERE id = p_post_id;
    
    RAISE LOG 'toggle_post_like: 좋아요 취소 - 사용자: %, 게시글: %, 현재 카운트: %', p_user_id, p_post_id, current_like_count;
    
    RETURN QUERY SELECT false, current_like_count;
  ELSE
    -- 좋아요 추가 (UNIQUE 제약으로 중복 방지)
    BEGIN
      INSERT INTO post_likes (post_id, user_id)
      VALUES (p_post_id, p_user_id);
      
      SELECT like_count INTO current_like_count
      FROM posts WHERE id = p_post_id;
      
      RAISE LOG 'toggle_post_like: 좋아요 추가 - 사용자: %, 게시글: %, 현재 카운트: %', p_user_id, p_post_id, current_like_count;
      
      RETURN QUERY SELECT true, current_like_count;
      
    EXCEPTION
      WHEN unique_violation THEN
        -- 중복 삽입 감지 시 삭제로 전환
        RAISE LOG 'toggle_post_like: 중복 삽입 감지, 삭제로 전환 - 사용자: %, 게시글: %', p_user_id, p_post_id;
        
        SELECT id INTO existing_like_id
        FROM post_likes
        WHERE post_id = p_post_id AND user_id = p_user_id
        FOR UPDATE;
        
        IF existing_like_id IS NOT NULL THEN
          DELETE FROM post_likes WHERE id = existing_like_id;
          
          SELECT like_count INTO current_like_count
          FROM posts WHERE id = p_post_id;
          
          RETURN QUERY SELECT false, current_like_count;
        ELSE
          RAISE EXCEPTION 'UNEXPECTED_STATE' USING ERRCODE = 'P0003';
        END IF;
    END;
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 함수 실행 권한 설정
REVOKE ALL ON FUNCTION toggle_post_like FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_post_like TO authenticated;

-- 성능 최적화 인덱스
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_post_likes_user_post_unique 
ON post_likes (user_id, post_id);
```

### 3단계: 실행 확인
```sql
-- 함수가 정상적으로 생성되었는지 확인
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_name = 'toggle_post_like';
```

## 🧪 자동 테스트 실행

### 1. HTTP 기반 통합 테스트
```bash
# 개발 서버 실행 (별도 터미널)
npm run dev

# 테스트 실행
node test-like-duplicate-prevention-http.js
```

### 2. 기존 테스트 스크립트
```bash
# 코드 품질 및 엔드포인트 확인
node test-like-functionality.js

# 웹사이트 전반적인 상태 확인
node test-website.js
```

## 🖱️ 수동 테스트 가이드

### 1단계: 개발 환경 준비
```bash
# 개발 서버 시작
npm run dev

# 브라우저에서 http://localhost:3000 접속
```

### 2단계: 로그인 및 게시판 접속
1. `/login` 페이지에서 로그인
2. `/board` 페이지 접속
3. 게시글 하나 선택하여 상세 페이지 이동

### 3단계: 개발자 도구 설정
1. **F12** 또는 **Cmd+Option+I** (Mac)로 개발자 도구 열기
2. **Console** 탭 활성화
3. **Network** 탭도 열어두기 (선택사항)

### 4단계: 중복 방지 테스트

#### 테스트 1: 빠른 연속 클릭
1. 좋아요 버튼을 **매우 빠르게 5번** 연속 클릭
2. **Console 탭**에서 로그 확인:
   ```
   [PostLikeButton] 요청 차단: 디바운스 (XXXms < 500ms)
   [PostLikeButton] 요청 차단: 처리 중
   ```
3. **결과**: 좋아요 수가 1씩만 변경되어야 함

#### 테스트 2: 애니메이션 중 클릭
1. 좋아요 버튼 클릭 후 **즉시 다시 클릭**
2. 버튼이 **비활성화** 상태인지 확인
3. 애니메이션이 완료된 후에만 다시 클릭 가능해야 함

#### 테스트 3: 네트워크 지연 시뮬레이션
1. **Network 탭** → **Throttling** → **Slow 3G** 선택
2. 좋아요 버튼 클릭 후 **응답 대기 중 추가 클릭**
3. Console에서 중복 요청 차단 로그 확인
4. Throttling을 **No throttling**으로 복원

#### 테스트 4: 페이지 새로고침 후 일관성
1. **F5** 또는 **Cmd+R**로 페이지 새로고침
2. 좋아요 수가 **일관되게 유지**되는지 확인
3. 다시 좋아요 버튼 테스트

### 5단계: Network 탭 분석 (고급)

#### 확인할 항목:
1. **요청 URL**: `/api/posts/[id]/likes`만 호출되는지
2. **요청 수**: 빠른 연속 클릭 시 요청이 1개만 전송되는지
3. **응답 시간**: 평균 응답 시간 측정
4. **상태 코드**: 200 OK 또는 적절한 에러 코드

#### 정상적인 네트워크 로그:
```
POST /api/posts/abc123/likes    200    450ms
(추가 요청 없음 - 중복 방지됨)
```

## 🐛 문제 해결 가이드

### 문제 1: 여전히 좋아요가 2씩 증가함
**가능한 원인:**
- 데이터베이스 마이그레이션 미적용
- 브라우저 캐시 문제
- React StrictMode 환경

**해결 방법:**
1. Supabase에서 SQL 마이그레이션 재실행
2. 브라우저 하드 새로고침 (Ctrl+Shift+R)
3. 개발 서버 재시작

### 문제 2: 좋아요 버튼이 응답하지 않음
**가능한 원인:**
- 로그인 상태 문제
- API 엔드포인트 오류
- 네트워크 연결 문제

**해결 방법:**
1. 로그아웃 후 다시 로그인
2. Console에서 에러 메시지 확인
3. Network 탭에서 실패한 요청 분석

### 문제 3: Console에 에러 로그가 나타남
**확인할 내용:**
- TypeScript 컴파일 오류
- API 엔드포인트 404 오류
- 권한 관련 403 오류

**해결 방법:**
1. `npm run lint` 실행하여 코드 오류 확인
2. 서버 로그 확인
3. 인증 상태 재확인

## 📊 성공 기준

### ✅ 테스트 통과 조건
1. **빠른 연속 클릭 시 좋아요 수가 1씩만 변경**
2. **Console에 중복 방지 로그 출력**
3. **Network 탭에서 중복 요청 차단 확인**
4. **페이지 새로고침 후 데이터 일관성 유지**
5. **애니메이션 중 버튼 비활성화**

### 📈 성능 기준
- **응답 시간**: 평균 500ms 이하
- **중복 방지율**: 95% 이상
- **에러율**: 5% 이하

## 🎯 추가 개선 사항

현재 구현된 중복 방지 시스템으로 대부분의 문제가 해결되지만, 필요 시 다음 개선을 고려할 수 있습니다:

1. **요청 큐잉**: 서버 응답 대기 중인 요청을 큐에 저장
2. **낙관적 업데이트**: UI 즉시 반영 후 서버 동기화
3. **WebSocket 실시간 동기화**: 여러 브라우저 간 실시간 좋아요 수 동기화
4. **Redis 캐싱**: 서버 사이드 캐싱을 Redis로 확장

## 📞 지원

문제가 지속되거나 추가 질문이 있는 경우:
1. Console 로그 스크린샷
2. Network 탭 스크린샷  
3. 재현 단계 상세 기록

이 정보와 함께 문의해 주시면 더 정확한 지원이 가능합니다.