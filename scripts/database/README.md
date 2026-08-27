# Database Scripts

> ## ⛔ 이 디렉터리는 통째로 Supabase 시절 잔재다 (2026-08-27 갱신)
>
> 2026-08-26 Turso 컷오버로 **운영 데이터의 권위는 Turso(SQLite)** 다. 앱은
> Supabase를 어디에서도 읽지 않는다.
>
> - 여기의 `.js`는 **전부 무해화돼 실행하면 즉시 중단된다.** 각 파일 상단에
>   "무엇을 하려던 스크립트였고, 지금은 어디를 봐야 하는지"가 적혀 있다.
> - 여기의 `.sql`은 **Postgres 전용**이다(RLS·`auth.uid()`·`DO $$`). Supabase
>   SQL Editor나 psql에 붙여넣지 마라 — 버려진 사본만 바뀌고 화면은 그대로다.
> - **Turso에는 RLS가 없다.** 접근 통제는 앱 계층(`src/middleware/`,
>   `src/db/queries/`, API 라우트의 인가 게이트)이 하고, 권한 경계는
>   `npm run test:e2e:authz`로 증명한다.
>
> 지금 필요한 것 → 볼 곳
>
> | 하려는 일 | 지금 쓰는 것 |
> | --- | --- |
> | 데이터 조회 | `turso db shell ggac-prod`, `src/db/queries/` |
> | 스키마 확인 | `src/db/schema/`, `npm run test:schema-contract` |
> | 스키마 변경 | `npm run db:generate` → `src/db/migrations/` (절차: `scripts/turso/README.md`) |
> | 권한 검증 | `npm run test:e2e:authz` |
>
> 아래 설명은 Supabase 시절의 원문이며 기록용으로만 남긴다.

데이터베이스 관련 모든 스크립트를 관리하는 디렉터리입니다.

## 📁 하위 디렉터리

### `migrations/`
데이터베이스 스키마 변경을 위한 마이그레이션 파일들
- SQL 파일들은 순서대로 실행되어야 함
- 파일명은 `YYYYMMDD_description.sql` 형식 권장

### `fixes/`
긴급 수정 및 패치 스크립트들
- 프로덕션 이슈 해결용 스크립트
- 실행 전 반드시 백업 필요

### `setup/`
초기 설정 및 테이블 생성 스크립트들
- 새 환경 구축시 사용
- Supabase 초기 설정 포함

### `checks/`
데이터베이스 상태 확인 스크립트들
- 테이블 구조 검증
- 데이터 무결성 검사
- 성능 모니터링

## ⚠️ 사용시 주의사항

1. **백업 필수**: 모든 스크립트 실행 전 데이터 백업
2. **환경 확인**: 개발/스테이징 환경에서 먼저 테스트
3. **순서 준수**: 마이그레이션 파일은 순서대로 실행
4. **권한 확인**: 적절한 데이터베이스 권한으로 실행