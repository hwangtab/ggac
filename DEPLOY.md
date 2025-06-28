# Vercel 자동 배포 설정 가이드

## 🚀 자동 배포 설정

이 프로젝트는 GitHub과 Vercel이 연동되어 `main` 브랜치에 push할 때마다 자동으로 배포됩니다.

### 📋 필수 설정

#### 1. Vercel 대시보드 설정
1. [Vercel 대시보드](https://vercel.com/hwang-khs-projects/ggac-wkr6) 접속
2. **Settings** > **Git** 에서 다음 확인:
   - ✅ Production Branch: `main`
   - ✅ Auto-deploy on push: `Enabled`
   - ✅ Connected Repository: `hwangtab/ggac`

#### 2. GitHub Secrets 설정 (GitHub Actions 사용 시)
GitHub 저장소 Settings > Secrets and variables > Actions에서 다음 추가:

```
VERCEL_TOKEN=<your-vercel-token>
VERCEL_ORG_ID=<your-org-id>
VERCEL_PROJECT_ID=<your-project-id>
```

**토큰 발급 방법:**
1. [Vercel Settings > Tokens](https://vercel.com/account/tokens)
2. **Create Token** 클릭
3. 토큰 복사하여 GitHub Secrets에 추가

**ORG ID & PROJECT ID 확인:**
```bash
npx vercel link  # 프로젝트 연결
cat .vercel/project.json  # ID 확인
```

### 🔄 배포 과정

#### 자동 배포 (Recommended)
```bash
git add .
git commit -m "Update content"
git push origin main
# → Vercel에서 자동으로 배포 시작
```

#### 수동 배포
```bash
npm run vercel:deploy  # Production 배포
npm run vercel:preview # Preview 배포
```

### 🌐 배포 URL
- **Production**: https://ggac.kr (Custom Domain)
- **Vercel URL**: https://ggac-wkr6.vercel.app (Backup)
- **Preview**: PR마다 자동 생성

### 📊 배포 상태 확인
- [Vercel 대시보드](https://vercel.com/hwang-khs-projects/ggac-wkr6)
- GitHub 커밋에 자동으로 상태 체크 표시

### 🛠️ 로컬 개발
```bash
npm run dev              # 개발 서버 실행
npm run build           # 프로덕션 빌드 테스트
npm run vercel:dev      # Vercel 환경에서 로컬 개발
```

---

## 문제 해결

### 빌드 실패 시
1. 로컬에서 `npm run build` 테스트
2. TypeScript 오류 확인
3. Vercel 빌드 로그 확인

### 자동 배포 안 될 때
1. GitHub-Vercel 연결 상태 확인
2. Vercel Settings > Git > Auto-deploy 설정 확인
3. GitHub Webhook 상태 확인
