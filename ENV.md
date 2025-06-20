# 환경 변수 설정 가이드

## Vercel 환경 변수

Vercel 대시보드에서 다음 환경 변수를 설정하세요:

### Production 환경
```
NODE_ENV=production
NEXT_PUBLIC_SITE_URL=https://ggac.kr
NEXT_PUBLIC_DOMAIN=ggac.kr
```

### Preview 환경
```
NODE_ENV=preview
NEXT_PUBLIC_SITE_URL=https://ggac-wkr6.vercel.app
NEXT_PUBLIC_DOMAIN=ggac-wkr6.vercel.app
```

### Development 환경
```
NODE_ENV=development
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_DOMAIN=localhost:3000
```

## 설정 방법

1. [Vercel Dashboard](https://vercel.com/hwang-khs-projects/ggac-wkr6) 접속
2. **Settings** > **Environment Variables** 이동
3. 각 환경별로 변수 추가

## 로컬 개발용 .env.local

프로젝트 루트에 `.env.local` 파일 생성:

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_DOMAIN=localhost:3000
NODE_ENV=development
```

> **주의**: `.env.local` 파일은 Git에 커밋하지 마세요!
