# 로그인 문제 수정 배포 가이드

**날짜:** 2025-01-14 **이슈:** 활동 로깅 API 500 에러로 인한 로그인 문제

## 🔍 문제 요약

- **증상:** 로그인 시 `/api/activities/log` 500 에러 발생
- **원인:** `user_activities` 테이블에 SELECT 정책만 있고 INSERT 정책 없음
- **영향:** 로그인 지연, 3초 타임아웃 트리거, 사용자 경험 저하

## ✅ 적용된 수정 사항

### 1. RLS 정책 추가 (데이터베이스)

- 파일:
  [supabase/migrations/20250114000000_fix_activity_logging_rls.sql](../supabase/migrations/20250114000000_fix_activity_logging_rls.sql)
- 내용: `user_activities` 테이블에 INSERT 정책 추가

### 2. 활동 로깅 최적화 (애플리케이션)

- 파일: [src/app/login/page.tsx:229-246](../src/app/login/page.tsx#L229-L246)
- 변경:
  - `await fetch()` (블로킹) → `fetch().catch()` (fire-and-forget)
  - 2초 타임아웃 추가

## 📋 배포 단계

### Step 1: 데이터베이스 Migration 실행

Supabase 대시보드에서 SQL을 실행합니다:

1. **Supabase Dashboard 접속**

   ```
   https://supabase.com/dashboard/project/btugywkltavbogdnhwpu/sql/new
   ```

2. **다음 SQL 실행:**

   ```sql
   -- Add INSERT policy for authenticated users to log their own activities
   CREATE POLICY IF NOT EXISTS "Allow authenticated users to log activities" ON user_activities
     FOR INSERT
     TO authenticated
     WITH CHECK (auth.uid() = user_id);
   ```

3. **실행 확인:**
   - SQL 편집기에서 "Run" 클릭
   - 성공 메시지 확인: "Success. No rows returned"

### Step 2: 코드 배포

이미 적용된 코드 변경사항을 배포합니다:

```bash
# 빌드 & 타입체크
npm run type-check
npm run build

# Vercel 배포
npm run deploy
```

### Step 3: 테스트

배포 후 테스트:

1. **로그인 테스트**
   - https://ggac.kr/login 접속
   - 이메일/비밀번호로 로그인
   - 콘솔 에러 확인

2. **확인 사항**
   - ✅ 500 에러 없음
   - ✅ "Fallback timeout" 경고 없음
   - ✅ 로그인 성공

## 🔧 수동 실행 (선택)

Node.js 스크립트로도 실행 가능:

```bash
node scripts/database/apply-activity-fix.js
```

**참고:** 이 스크립트는 안내 메시지만 출력하고 실제 실행은 Supabase
Dashboard에서 해야 합니다.

## 📊 검증 방법

### 1. RLS 정책 확인

Supabase SQL Editor에서 실행:

```sql
SELECT
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_activities'
ORDER BY policyname;
```

**기대 결과:**

- "Allow authenticated users to log activities" (INSERT)
- "Users can view own activities" (SELECT)
- "Admins can view all activities" (ALL)

### 2. 활동 로깅 테스트

브라우저 개발자 도구에서:

```javascript
// 로그인 후 실행
fetch('/api/activities/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    action_type: 'test',
    target_type: 'system',
    metadata: { test: true },
  }),
})
  .then(r => r.json())
  .then(console.log)
  .catch(console.error)
```

**기대 결과:**

- 200 OK 응답
- `{ success: true, ... }` 형태의 JSON

## 🚨 롤백 방법

문제 발생 시:

```sql
-- INSERT 정책 제거
DROP POLICY IF EXISTS "Allow authenticated users to log activities" ON user_activities;
```

그 후 이전 코드 버전으로 되돌리기:

```bash
git log --oneline # 이전 커밋 찾기
git revert <commit-hash>
npm run deploy
```

## 📝 참고 문서

- [Activity Tracking System Migration](../supabase/migrations/20250719090020_create_activity_tracking_system.sql)
- [Code Review: Editor System](./code-review-editor-system.md)
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)

## 💡 향후 개선 사항

현재 수정으로 문제는 해결되었지만, 추가 최적화 가능:

1. **Middleware 최적화** (LOW priority)
   - DB 호출 병렬화
   - 캐싱 전략 개선

2. **Health Check API** (LOW priority)
   - `/api/health/activity-logging` 엔드포인트 추가
   - 활동 로깅 시스템 상태 모니터링

3. **Error Monitoring** (LOW priority)
   - Sentry 또는 다른 모니터링 도구 추가
   - 500 에러 알림 설정

---

**작성자:** Claude Code **마지막 업데이트:** 2025-01-14
