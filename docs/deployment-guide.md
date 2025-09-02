# 배포 가이드

경기아트콜렉티브 웹사이트의 배포 프로세스 및 운영 가이드입니다.

## 📋 목차

- [배포 환경 개요](#배포-환경-개요)
- [Vercel 배포](#vercel-배포)
- [환경별 설정](#환경별-설정)
- [도메인 및 SSL](#도메인-및-ssl)
- [데이터베이스 관리](#데이터베이스-관리)
- [모니터링](#모니터링)
- [백업 및 복구](#백업-및-복구)
- [트러블슈팅](#트러블슈팅)

---

## 🌐 배포 환경 개요

### 환경 구성
```
Production   → ggac.kr (메인 도메인)
Staging      → staging.ggac.kr (테스트 환경)
Development  → localhost:3000 (로컬 개발)
```

### 기술 스택
- **호스팅**: Vercel
- **데이터베이스**: Supabase PostgreSQL
- **스토리지**: Supabase Storage
- **CDN**: Vercel Edge Network
- **도메인**: Cloudflare DNS

---

## 🚀 Vercel 배포

### 1. 자동 배포 (권장)

**GitHub 연동 배포:**
```bash
# main 브랜치에 푸시하면 자동 배포
git push origin main

# 배포 상태 확인
vercel --prod
```

**배포 상태 확인:**
- ✅ Production: https://ggac.kr
- 🔄 Staging: https://staging.ggac.kr
- 📱 Mobile: https://m.ggac.kr (리다이렉트)

### 2. 수동 배포

**Vercel CLI 사용:**
```bash
# Vercel CLI 설치
npm install -g vercel

# 로그인
vercel login

# 프로덕션 배포
vercel --prod

# 미리보기 배포
vercel
```

**NPM 스크립트 사용:**
```bash
# 프로덕션 배포
npm run deploy

# 미리보기 배포
npm run deploy:preview

# 배포 알림 전송
npm run deploy:notify
```

### 3. 빌드 과정

**1단계: 의존성 설치**
```bash
npm ci --production=false
```

**2단계: 빌드 실행**
```bash
npm run build
```

**3단계: 정적 최적화**
- 이미지 최적화 (Sharp/Next.js Image)
- CSS 최적화 (Tailwind purge)
- JavaScript 번들 최적화

**4단계: 배포**
- Edge Functions 배포
- 정적 파일 CDN 업로드
- DNS 설정 업데이트

---

## ⚙️ 환경별 설정

### Production 환경변수
```bash
# Vercel Dashboard → Settings → Environment Variables
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_production_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_production_service_role_key

# 도메인 설정
NEXTAUTH_URL=https://ggac.kr
NEXT_PUBLIC_APP_ENV=production

# 모니터링
NEXT_PUBLIC_ANALYTICS_ID=GA_TRACKING_ID
SENTRY_DSN=your_sentry_dsn

# 성능 최적화
NEXT_PUBLIC_CDN_URL=https://cdn.ggac.kr
```

### Staging 환경변수
```bash
NEXT_PUBLIC_SUPABASE_URL=https://staging-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_staging_anon_key
NEXTAUTH_URL=https://staging.ggac.kr
NEXT_PUBLIC_APP_ENV=staging
```

### 환경변수 관리
```bash
# .env.production
NODE_ENV=production
NEXT_PUBLIC_APP_ENV=production

# .env.staging  
NODE_ENV=production
NEXT_PUBLIC_APP_ENV=staging

# .env.local (개발용 - Git 제외)
NODE_ENV=development
NEXT_PUBLIC_APP_ENV=development
```

---

## 🌍 도메인 및 SSL

### 1. 도메인 설정

**Vercel 도메인 설정:**
```bash
# 커스텀 도메인 추가
vercel domains add ggac.kr

# 서브도메인 추가
vercel domains add staging.ggac.kr
vercel domains add api.ggac.kr
```

**DNS 레코드 설정:**
```
Type    Name        Value                    TTL
A       @           76.76.19.123            300
A       www         76.76.19.123            300
CNAME   staging     cname.vercel-dns.com    300
CNAME   api         cname.vercel-dns.com    300
```

### 2. SSL 인증서

**자동 SSL (Let's Encrypt):**
- Vercel이 자동으로 SSL 인증서 발급 및 갱신
- HTTPS 강제 리다이렉트 설정
- HSTS 헤더 자동 적용

**SSL 설정 확인:**
```bash
# SSL 상태 확인
curl -I https://ggac.kr

# SSL 인증서 정보
openssl s_client -connect ggac.kr:443 -servername ggac.kr
```

---

## 🗄️ 데이터베이스 관리

### 1. Supabase 설정

**Production 데이터베이스:**
```sql
-- 백업 설정
CREATE EXTENSION IF NOT EXISTS pg_dump;

-- 성능 모니터링
SELECT * FROM pg_stat_activity;

-- 연결 상태 확인
SELECT count(*) FROM pg_stat_activity;
```

**Migration 관리:**
```bash
# Supabase CLI로 마이그레이션
supabase migration new add_new_table
supabase db push --db-url $DATABASE_URL

# 스키마 백업
pg_dump $DATABASE_URL > backup.sql
```

### 2. 데이터 보안

**Row Level Security (RLS):**
```sql
-- 사용자 데이터 보호
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data" ON users
FOR SELECT USING (auth.uid() = id);
```

**백업 정책:**
- **매일 자동 백업**: Supabase 자동 백업
- **수동 백업**: 주요 업데이트 전
- **백업 보관**: 30일간 보관

---

## 📊 모니터링

### 1. Vercel Analytics

**성능 지표:**
- Core Web Vitals
- 페이지 로딩 시간
- 트래픽 분석
- 오류율

**모니터링 대시보드:**
```javascript
// pages/api/health.js
export default function handler(req, res) {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version
  })
}
```

### 2. Uptime 모니터링

**헬스체크 엔드포인트:**
```bash
# API 상태 확인
curl https://ggac.kr/api/health

# 데이터베이스 연결 확인
curl https://ggac.kr/api/db-health
```

### 3. 에러 트래킹

**Sentry 설정 (선택사항):**
```javascript
// sentry.client.config.js
import { init } from '@sentry/nextjs'

init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV,
  tracesSampleRate: 0.1,
})
```

### 4. 로그 관리

**Vercel Function Logs:**
```bash
# 실시간 로그 확인
vercel logs --follow

# 특정 함수 로그
vercel logs --function api/posts
```

---

## 💾 백업 및 복구

### 1. 데이터베이스 백업

**자동 백업 스크립트:**
```bash
#!/bin/bash
# scripts/backup-db.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_${DATE}.sql"

pg_dump $DATABASE_URL > $BACKUP_FILE
aws s3 cp $BACKUP_FILE s3://ggac-backups/
```

**복구 프로세스:**
```bash
# 백업에서 복구
psql $DATABASE_URL < backup_file.sql

# 특정 테이블만 복구
pg_restore -t users backup_file.sql
```

### 2. 코드 백업

**Git 기반 백업:**
- GitHub 원격 저장소 (Primary)
- GitLab 미러링 (Secondary)
- 로컬 클론 (개발자 워크스테이션)

### 3. 설정 백업

**환경변수 백업:**
```bash
# Vercel 설정 내보내기
vercel env pull .env.backup

# 설정 파일 백업
tar -czf config-backup.tar.gz *.config.js .env.*
```

---

## 🔧 트러블슈팅

### 일반적인 배포 문제

**1. 빌드 실패**
```bash
# 로컬에서 빌드 테스트
npm run build

# 의존성 문제 해결
rm -rf node_modules .next
npm install
npm run build
```

**2. 환경변수 누락**
```bash
# Vercel에서 환경변수 확인
vercel env ls

# 환경변수 동기화
vercel env pull .env.local
```

**3. 데이터베이스 연결 오류**
```bash
# 연결 문자열 확인
echo $DATABASE_URL

# 연결 테스트
psql $DATABASE_URL -c "SELECT version();"
```

**4. 성능 문제**
```bash
# 번들 크기 분석
ANALYZE=true npm run build

# 캐시 설정 확인
vercel inspect <deployment-url>
```

### 롤백 절차

**1. 즉시 롤백:**
```bash
# 이전 배포로 롤백
vercel rollback <previous-deployment-url>

# 또는 안정 버전으로 롤백
git revert HEAD
git push origin main
```

**2. 데이터베이스 롤백:**
```bash
# 마이그레이션 롤백
supabase migration down

# 백업에서 복구
psql $DATABASE_URL < backup_before_deploy.sql
```

### 성능 최적화

**1. Vercel 설정 최적화:**
```javascript
// vercel.json
{
  "functions": {
    "app/api/**/*.js": {
      "maxDuration": 10
    }
  },
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "s-maxage=60" }
      ]
    }
  ]
}
```

**2. Edge Functions 활용:**
```javascript
// middleware.js
export function middleware(request) {
  // Edge에서 처리할 로직
}

export const config = {
  matcher: '/api/:path*'
}
```

---

## 📋 배포 체크리스트

### Pre-Deploy 체크리스트
- [ ] 모든 테스트 통과 확인
- [ ] 타입스크립트 오류 없음
- [ ] ESLint 검사 통과
- [ ] 로컬 빌드 성공
- [ ] 환경변수 설정 확인
- [ ] 데이터베이스 백업 완료

### 배포 후 체크리스트
- [ ] 메인 페이지 로딩 확인
- [ ] 로그인/회원가입 기능 테스트
- [ ] API 엔드포인트 응답 확인
- [ ] 이미지 업로드 기능 테스트
- [ ] 모바일 반응형 확인
- [ ] 성능 지표 모니터링

### Emergency 체크리스트
- [ ] 헬스체크 API 응답 확인
- [ ] 데이터베이스 연결 상태 확인
- [ ] CDN 캐시 상태 확인
- [ ] 필요시 즉시 롤백 준비
- [ ] 장애 알림 확인

---

## 🚨 장애 대응

### 장애 등급
- **P0 (Critical)**: 전체 서비스 중단
- **P1 (High)**: 핵심 기능 장애
- **P2 (Medium)**: 일부 기능 장애
- **P3 (Low)**: 성능 저하

### 대응 절차
1. **장애 감지** → 모니터링 시스템 알림
2. **상황 파악** → 로그 분석 및 원인 조사
3. **임시 조치** → 롤백 또는 우회 방안 적용
4. **근본 해결** → 코드 수정 및 재배포
5. **사후 분석** → 장애 보고서 작성 및 개선책 수립

---

*이 배포 가이드는 지속적으로 업데이트되며, 새로운 배포 도구나 프로세스가 도입되면 함께 문서화됩니다.*