# 회원가입 시스템 수정 계획서

## 📋 현재 상황 분석

### 문제점 요약
1. **회원가입 시 상세 정보가 데이터베이스에 저장되지 않음**
2. **회원가입 플로우의 불일치** - 코드와 실제 구현 간 차이
3. **누락된 페이지** - `/register/member-info` 페이지 부재로 인한 404 오류
4. **RLS 정책과 트리거 함수 간 권한 충돌**
5. **복잡한 인증 플로우로 인한 사용자 경험 저하**

### 주요 발견사항

#### 1. 회원가입 플로우 불일치
- **설계**: 2단계 회원가입 (signup → member-info → pending)
- **실제**: 1단계 통합 회원가입 (signup → pending)
- **문제**: auth callback에서 존재하지 않는 `/register/member-info` 페이지로 리다이렉트

#### 2. 데이터 저장 문제
- 회원가입 시 모든 정보를 `user_metadata`에 저장
- 트리거 함수가 `user_metadata`에서 정보를 추출하여 `member_profiles` 테이블에 저장
- **문제**: 트리거 실행 시 RLS 정책 충돌 또는 데이터 타입 불일치

#### 3. 트리거 함수 문제
- `handle_new_user()`: 회원가입 시 실행
- `handle_email_confirmed()`: 이메일 확인 시 실행
- **문제**: 두 트리거가 동시에 실행되어 중복 삽입 시도 가능성

## 🎯 해결 목표

1. **간단하고 명확한 회원가입 플로우 구축**
2. **회원가입 시 모든 정보가 확실히 저장되도록 보장**
3. **관리자 승인 후 게시판 접근 가능한 구조 완성**
4. **사용자 경험 개선 및 오류 최소화**

## 🔧 상세 수정 계획

### Phase 1: 회원가입 플로우 통일 및 단순화

#### 1.1 auth callback 수정
**파일**: `src/app/auth/callback/route.ts`

**현재 문제**:
```typescript
// 존재하지 않는 페이지로 리다이렉트
return NextResponse.redirect(`${requestUrl.origin}/register/member-info`)
```

**수정 방안**:
```typescript
if (!profile) {
  // 트리거가 실패한 경우 대비 - 프로필 생성 시도
  const { error: createError } = await supabase
    .from('member_profiles')
    .insert({
      id: user.id,
      email: user.email,
      display_name: user.user_metadata?.display_name || user.email,
      real_name: user.user_metadata?.real_name,
      phone_number: user.user_metadata?.phone_number,
      birth_date: user.user_metadata?.birth_date,
      monthly_fee: user.user_metadata?.monthly_fee,
      bank_name: user.user_metadata?.bank_name,
      account_number: user.user_metadata?.account_number,
      account_holder: user.user_metadata?.account_holder,
      registration_status: 'pending',
      is_active: false
    });

  if (createError) {
    console.error('Profile creation failed:', createError);
  }
  
  // 승인 대기 페이지로 바로 이동
  return NextResponse.redirect(`${requestUrl.origin}/register/pending`)
}
```

#### 1.2 트리거 함수 최적화
**파일**: `supabase/migrations/20250108_fix_signup_flow.sql` (새로 생성)

**현재 문제**:
- 두 개의 트리거가 동시에 작동
- RLS 정책 충돌 가능성
- 데이터 타입 불일치

**수정 방안**:
```sql
-- 기존 트리거 제거
DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
DROP FUNCTION IF EXISTS public.handle_email_confirmed();

-- 단일 트리거 함수로 통합 및 개선
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger 
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.member_profiles (
    id, 
    email, 
    display_name, 
    real_name, 
    phone_number, 
    birth_date,
    monthly_fee, 
    bank_name, 
    account_number, 
    account_holder,
    registration_status, 
    is_active
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.raw_user_meta_data->>'real_name',
    NEW.raw_user_meta_data->>'phone_number',
    CASE 
      WHEN NEW.raw_user_meta_data->>'birth_date' IS NOT NULL 
      THEN (NEW.raw_user_meta_data->>'birth_date')::date
      ELSE NULL
    END,
    CASE 
      WHEN NEW.raw_user_meta_data->>'monthly_fee' IS NOT NULL 
      THEN (NEW.raw_user_meta_data->>'monthly_fee')::integer
      ELSE NULL
    END,
    NEW.raw_user_meta_data->>'bank_name',
    NEW.raw_user_meta_data->>'account_number',
    NEW.raw_user_meta_data->>'account_holder',
    'pending'::public.member_status,
    FALSE
  )
  ON CONFLICT (id) DO NOTHING; -- 중복 삽입 방지
  
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- 오류 발생 시 로그 기록 (실제 환경에서는 로깅 시스템 사용)
    RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
    RETURN NEW; -- 인증 자체는 성공하도록 함
END;
$$ LANGUAGE plpgsql;

-- 트리거 재생성 (이메일 확인 시에만 실행)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_new_user();
```

### Phase 2: RLS 정책 개선

#### 2.1 member_profiles RLS 정책 수정
```sql
-- 기존 정책 제거
DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles;
DROP POLICY IF EXISTS "Service role can access all profiles" ON public.member_profiles;

-- 개선된 INSERT 정책
CREATE POLICY "Allow profile creation" ON public.member_profiles
  FOR INSERT 
  WITH CHECK (
    -- 자신의 프로필이거나 서비스 역할인 경우
    auth.uid() = id OR 
    auth.role() = 'service_role' OR
    -- 트리거 함수에서 실행되는 경우 (SECURITY DEFINER)
    current_setting('role') = 'postgres'
  );

-- 서비스 역할 전체 접근 정책 (관리 작업용)
CREATE POLICY "Service role full access" ON public.member_profiles
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
```

### Phase 3: 에러 처리 및 사용자 경험 개선

#### 3.1 회원가입 페이지 개선
**파일**: `src/app/signup/page.tsx`

**개선사항**:
1. 더 자세한 에러 메시지
2. 필드별 유효성 검사 강화
3. 회원가입 성공 후 명확한 안내

```typescript
// 개선된 에러 처리
if (error) {
  if (error.message.includes('already registered')) {
    setMessage('이미 등록된 이메일입니다. 로그인을 시도하거나 관리자에게 문의해주세요.');
  } else if (error.message.includes('invalid email')) {
    setMessage('올바른 이메일 주소를 입력해주세요.');
  } else if (error.message.includes('weak password')) {
    setMessage('비밀번호는 최소 6자 이상이어야 합니다.');
  } else {
    setMessage(`회원가입 오류: ${error.message}`);
  }
} else if (data.user) {
  setMessage(
    `🎉 회원가입 신청이 완료되었습니다!\n\n` +
    `1. ${formData.email}로 전송된 인증 이메일을 확인해주세요.\n` +
    `2. 이메일 인증 완료 후 관리자 승인을 거쳐 최종 완료됩니다.\n` +
    `3. 승인이 완료되면 조합원 게시판을 이용하실 수 있습니다.`
  );
  
  // 5초 후 로그인 페이지로 이동
  setTimeout(() => {
    router.push('/login');
  }, 5000);
}
```

#### 3.2 승인 대기 페이지 개선
**파일**: `src/app/register/pending/page.tsx`

**개선사항**:
1. 현재 상태 명확히 표시
2. 관리자 연락처 제공
3. 주기적 상태 확인 기능

### Phase 4: 관리자 승인 워크플로우 개선

#### 4.1 관리자 페이지 생성 (선택사항)
**파일**: `src/app/admin/page.tsx` (새로 생성)

간단한 관리자 페이지를 만들어 승인 프로세스를 웹에서 처리할 수 있도록 함.

#### 4.2 Supabase Dashboard 활용
현재처럼 Supabase Dashboard에서 승인 처리 시:
1. `member_profiles` 테이블에서 대상 사용자 찾기
2. `registration_status`를 `'approved'`로 변경
3. `is_active`를 `true`로 변경
4. `approved_at`에 현재 시간 설정
5. `approved_by`에 관리자 ID 설정 (선택사항)

## 📝 구현 순서

### 1단계: 트리거 함수 및 RLS 정책 수정
- [ ] 새로운 마이그레이션 파일 생성
- [ ] 트리거 함수 통합 및 개선
- [ ] RLS 정책 수정
- [ ] 데이터베이스 마이그레이션 실행

### 2단계: 인증 플로우 수정
- [ ] auth callback 라우트 수정
- [ ] 미들웨어 경로 설정 정리
- [ ] 회원가입 페이지 에러 처리 개선

### 3단계: 사용자 경험 개선
- [ ] 승인 대기 페이지 개선
- [ ] 로그인 페이지 프로필 생성 로직 정리
- [ ] 에러 메시지 및 안내 문구 개선

### 4단계: 테스트 및 검증
- [ ] 전체 회원가입 플로우 테스트
- [ ] 데이터 저장 확인
- [ ] 승인 후 게시판 접근 테스트
- [ ] 에러 케이스 테스트

## ⚡ 즉시 적용 가능한 임시 해결책

회원가입이 급하게 필요한 경우를 위한 임시 해결책:

### 1. auth callback 즉시 수정
`src/app/auth/callback/route.ts`에서 25-28번째 줄을:
```typescript
if (!profile) {
  // 임시: 바로 승인 대기 페이지로 이동
  return NextResponse.redirect(`${requestUrl.origin}/register/pending`)
}
```

### 2. 수동 프로필 생성
Supabase Dashboard에서 직접 `member_profiles` 테이블에 레코드 삽입:
```sql
INSERT INTO public.member_profiles (
  id, email, display_name, real_name, phone_number, birth_date,
  monthly_fee, bank_name, account_number, account_holder,
  registration_status, is_active
) VALUES (
  '[사용자 UUID]', 
  '[이메일]', 
  '[표시명]', 
  '[실명]', 
  '[전화번호]', 
  '[생년월일]',
  [조합비], 
  '[은행명]', 
  '[계좌번호]', 
  '[예금주]',
  'pending', 
  false
);
```

## 🚨 주의사항

1. **백업**: 데이터베이스 변경 전 반드시 백업 수행
2. **점진적 적용**: 한 번에 모든 변경사항을 적용하지 말고 단계별로 진행
3. **테스트**: 각 단계마다 충분한 테스트 수행
4. **롤백 계획**: 문제 발생 시 원복 가능한 계획 수립

## 📞 지원 및 문의

이 계획서대로 구현하시면서 문제가 발생하면:
1. 각 단계별로 상세한 에러 로그 확인
2. Supabase Dashboard에서 실시간 로그 모니터링
3. 브라우저 개발자 도구에서 네트워크 및 콘솔 오류 확인

---

**작성일**: 2025-01-08  
**작성자**: Claude Code  
**버전**: 1.0