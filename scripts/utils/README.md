# Utility Scripts

프로젝트 운영에 필요한 다양한 유틸리티 스크립트들을 관리합니다.

## 📁 하위 디렉터리

### `image-processing/`
이미지 처리 관련 스크립트들
- 이미지 포맷 변환 (WebP, AVIF)
- 이미지 최적화 및 압축
- 로고 및 아이콘 생성

### `data-migration/`
데이터 이관 관련 스크립트들
- JSON에서 데이터베이스로 이관
- 아티스트 데이터 동기화
- 프로젝트 데이터 업데이트

### `deployment/`
배포 관련 스크립트들
- 배포 알림 전송
- Webhook 처리
- 환경 설정 검증

## 🛠️ 사용 예시

```bash
# 이미지 변환
node scripts/utils/image-processing/convert-images.js

# 데이터 마이그레이션
node scripts/utils/data-migration/sync-artists-json-to-db.js

# 배포 알림
node scripts/utils/deployment/deploy-notify.js
```

## 📋 스크립트 실행 전 체크리스트

- [ ] 환경변수 설정 확인
- [ ] 필요한 의존성 설치
- [ ] 백업 데이터 준비 (필요시)
- [ ] 실행 권한 확인