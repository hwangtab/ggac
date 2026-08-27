# Utility Scripts

프로젝트 운영에 필요한 다양한 유틸리티 스크립트들을 관리합니다.

## 📁 하위 디렉터리

### `image-processing/`
이미지 처리 관련 스크립트들
- 이미지 포맷 변환 (WebP, AVIF)
- 이미지 최적화 및 압축
- 로고 및 아이콘 생성

### `data-migration/`
Supabase 시절의 데이터 이관 스크립트들 — ⛔ **대부분 무해화돼 실행하면 즉시 중단된다.**
- `generate-test-activity-data.js` / `run-sql-script.js`: Supabase에 쓰던 것. 중단됨.
- `analyze-member-status.js`: 로컬 서버(http://localhost:3000) API만 호출한다. 그대로 쓸 수 있다.
- `optimize-activity-tracking.js`: 파일만 읽어 보고서를 만든다. DB를 건드리지 않는다.

Turso로 옮긴 뒤의 데이터 이관 도구는 `scripts/migrate/`에 있다.

### `deployment/`
배포 관련 스크립트들
- 배포 알림 전송
- Webhook 처리
- 환경 설정 검증

## 🛠️ 사용 예시

```bash
# 이미지 변환
node scripts/utils/image-processing/convert-images.js

# 데이터 이관 (Turso) — scripts/migrate/ 를 쓴다
node scripts/migrate/copy-private-objects.mjs   # 인자 없이 = dry-run 대조

# 배포 알림
node scripts/utils/deployment/deploy-notify.js
```

## 📋 스크립트 실행 전 체크리스트

- [ ] 환경변수 설정 확인
- [ ] 필요한 의존성 설치
- [ ] 백업 데이터 준비 (필요시)
- [ ] 실행 권한 확인