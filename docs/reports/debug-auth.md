# Supabase OAuth 디버깅 가이드

## 현재 문제
1. profiles 테이블에 데이터가 없음
2. 인증 이메일이 오지 않음

## 확인해야 할 사항들

### 1. Supabase Authentication 설정 확인
- **Supabase Dashboard > Authentication > Settings**에서:
  - Email confirmation 설정이 켜져 있는지 확인
  - OAuth providers (Google) 설정 상태 확인
  - Site URL과 Redirect URLs가 올바른지 확인

### 2. Google OAuth 설정 확인
- **Google Cloud Console**에서:
  - OAuth 2.0 Client ID가 생성되어 있는지
  - Authorized redirect URIs에 올바른 URL이 설정되어 있는지:
    - `https://btugywkltavbogdnhwpu.supabase.co/auth/v1/callback`
    - `http://localhost:3000/auth/callback` (개발용)

### 3. Supabase Database 설정 확인
- **Table Editor**에서 `profiles` 테이블이 존재하는지 확인
- RLS (Row Level Security) 설정 확인
- 권한 설정 확인

### 4. 환경 변수 확인
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### 5. 네트워크/브라우저 확인
- 브라우저 개발자 도구에서 에러 메시지 확인
- 네트워크 탭에서 OAuth 요청이 성공하는지 확인

## 단계별 디버깅 방법

### 1단계: Supabase 설정 확인
1. Supabase Dashboard → Authentication → Settings
2. "Enable email confirmations" 설정 확인
3. "Site URL" 확인: `http://localhost:3000` (개발) 또는 `https://ggac.kr` (프로덕션)
4. "Redirect URLs" 확인:
   - `http://localhost:3000/auth/callback`
   - `https://ggac.kr/auth/callback`

### 2단계: Google OAuth 설정 확인
1. Google Cloud Console → APIs & Services → Credentials
2. OAuth 2.0 Client IDs에서 해당 클라이언트 선택
3. "Authorized redirect URIs" 확인:
   - `https://btugywkltavbogdnhwpu.supabase.co/auth/v1/callback`

### 3단계: Database 스키마 확인
profiles 테이블이 다음과 같이 설정되어 있는지 확인:

```sql
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  is_member BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- 정책 생성
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Allow inserts for authenticated users" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
```

### 4단계: 로그 확인
1. 브라우저 개발자 도구의 Console 탭에서 에러 메시지 확인
2. 브라우저 개발자 도구의 Network 탭에서 OAuth 요청 상태 확인
3. Supabase Dashboard의 Logs에서 에러 확인

## 일반적인 해결 방법

### 문제: OAuth 로그인 후 프로필 생성 안됨
**해결책:**
1. RLS 정책이 올바르게 설정되어 있는지 확인
2. `auth.uid()`가 올바르게 작동하는지 확인
3. 서버 사이드 클라이언트 권한 확인

### 문제: 이메일 인증 메일 안옴
**해결책:**
1. SMTP 설정 확인 (Supabase Dashboard > Settings > Auth)
2. 스팸 폴더 확인
3. 이메일 제공업체의 보안 설정 확인

### 문제: OAuth redirect 실패
**해결책:**
1. Google Cloud Console의 redirect URI 설정 재확인
2. Supabase의 Site URL과 Redirect URLs 재확인
3. 도메인 설정 확인