# Turso 운영 메모

## DB
- 이름: `ggac-prod`
- 리전: `aws-ap-northeast-1`(도쿄). 무료 플랜은 그룹 1개 제한이고 기존
  `default` 그룹이 이미 도쿄에 있어서, `ggac-prod`는 새 그룹을 만드는 대신
  그 그룹에 합류해 리전을 자동 상속했다. `turso db create`에 `--location`을
  주지 않았고 앞으로도 주면 안 된다 — 새 그룹 생성을 시도해 그룹 한도
  초과로 실패한다.
- 스키마 적용: `npx drizzle-kit push` (drizzle.config.ts가
  `process.env.TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`을 읽는다). drizzle-kit은
  `.env.local`을 자동으로 읽지 않으므로, 실행 전에 셸에 직접 로드해야 한다:
  `set -a; source .env.local; set +a`. 로드하지 않으면 조용히 로컬
  `file:local.db`에 push된다 — 실행 후 출력에 원격 `libsql://` URL이
  찍히는지 반드시 확인한다.

## 자주 쓰는 명령
```bash
turso db shell ggac-prod                 # 대화형 셸
turso db show ggac-prod                  # URL·리전 확인
turso db tokens create ggac-prod         # 새 토큰 발급
turso db shell ggac-prod .dump > backup.sql  # 덤프
```

⚠️ `turso db dump`는 이 CLI(v1.0.31 기준)에 존재하지 않는 서브커맨드다.
실행해도 종료 코드는 0이고, 대신 `turso db --help`의 도움말 텍스트가
표준출력으로 찍혀 그대로 "덤프 파일"에 저장된다 — 에러 없이 조용히
쓰레기 파일을 만든다는 뜻이다. 반드시 위의 `turso db shell ggac-prod .dump`
형태를 쓴다. (Task 10에서 발견: `.superpowers/sdd/2026-08-11-turso-stage0-foundation/task-10-report.md`)

## 주의
- `drizzle-kit push --force`는 스키마 차이를 확인 없이 반영한다. 운영에는
  마이그레이션 파일 적용을 우선하고, push는 단계 0의 초기 구축에만 쓴다.
- 로컬은 `TURSO_DATABASE_URL`을 비워두면 `file:local.db`로 떨어진다.
- CLI가 PATH에 없는 셸에서는 `~/.turso/turso`를 직접 호출한다(PATH 설정은
  `~/.zshrc`에 있으나 모든 셸이 이를 읽어오지는 않는다).
- 그룹/리전 제약(1개 그룹, `--location` 금지)은 위 "DB" 절 참고 — `ggac-prod`
  뿐 아니라 앞으로 이 계정에서 DB를 추가로 만들 때도 동일하게 적용된다.

⚠️ **`ggac-prod`에는 `__drizzle_migrations` 베이스라인이 없다.** 이 DB의
스키마는 `drizzle-kit push`로 만들어졌고, push는 `__drizzle_migrations`
북키핑 테이블을 전혀 기록하지 않는다. 그런데 이 브랜치는
`src/db/migrations/0000_dizzy_krista_starr.sql`을 커밋하고 있고, 그 파일은
26개 테이블 전부에 대한 `CREATE TABLE`을 담고 있다. 따라서 `ggac-prod`를
베이스라인 처리하지 않은 채로 `drizzle-kit migrate`를 그대로 실행하면
`0000`을 처음부터 적용하려 시도해 "table already exists" 에러로 실패한다.
`migrate`를 처음 실행하기 전에 반드시 `0000`의 해시로 `ggac-prod`의
`__drizzle_migrations` 원장을 베이스라인 처리해야 한다 — 다만 구체적인
베이스라인 명령은 아직 검증하지 않았으므로 여기 적지 않는다. 단계 2에서
`migrate`를 실행하기 전에 반드시 이 절차부터 확인할 것.

## 단계 2로 넘기는 제약

RLS 정책 → 앱 계층 검사의 전체 58행 매핑은
`docs/superpowers/specs/2026-08-13-rls-mapping.md`에 있다. `docs/`는
저장소 관례상 gitignore 대상이라 이 파일은 로컬에만 존재하고 커밋되지
않는다 — 새로 클론한 환경에는 없다. 아래 두 가지는 그 문서에서 단계 2
구현자가 반드시 알아야 할 제약만 뽑아 여기(추적되는 파일)에 옮겨 적은
것이다.

1. **`post_attachments`** — Postgres의 `{anon}` 대상 SELECT 정책
   `"Anyone can view attachments"`는 `qual = true`, 즉 필터가 전혀 없다.
   그래서 익명 호출자가 다른 사용자의 `is_temporary = true` 임시 업로드까지
   조회할 수 있다. `/api/posts/[id]/attachments` GET은 현재 이 부분을
   라이브 RLS에 의존해 막고 있다(사실상 막지 못하고 있다는 뜻이기도 하다).
   앱 계층이 RLS를 대체할 때는 이 DB의 리터럴 동작을 그대로 베끼지 말고,
   익명 사용자에게 보이는 범위를 `is_temporary = false`로 **의도적으로
   좁혀서** 구현해야 한다.

2. **`posts`** — SELECT에 역할 범위가 다른 정책 두 개가 있다: `{anon}`
   대상의 `"Anyone can view posts"`(`is_deleted = false`)와,
   `{authenticated}` 대상의 `"Approved members can view posts"`(승인+활성).
   `{anon}` 스코프 정책은 `authenticated` 역할 연결에는 적용되지 않으므로,
   로그인은 했지만 아직 승인되지 않은 회원은 두 정책 어느 쪽으로도
   구제받지 못해 **로그아웃 상태 방문자보다 더 적게 보는** 역전이 생긴다.
   단계 2는 두 정책을 하나의 통합 규칙으로 대체하게 되는데, 이 비대칭을
   모르고 우연히 없애는 게 아니라 어떤 동작을 택할지 의도적으로 결정해야
   한다.

---

## 단계 1a — 공개 스토리지 전환 기록 (2026-08-14 완료)

Supabase Storage의 공개 버킷 3개(`artists`, `posts`, `attachments`)를 Vercel
Blob 공개 저장소로 옮기고, DB에 저장돼 있던 URL을 재작성했다. 조합원이 새로
올리는 파일은 이제 Blob으로 간다.

### 되돌리는 방법

DB의 URL만 백업 시점 값으로 되돌린다. **Supabase 원본 객체는 지우지 않았으므로
이 복원만으로 옛 URL이 다시 살아난다.**

```bash
set -a; source .env.local; set +a
BACKUP_DIR="$HOME/ggac-url-backup/2026-08-14T01-45-11-393Z" \
  node scripts/storage/restore-db-urls.mjs --dry-run   # 먼저 확인
BACKUP_DIR="$HOME/ggac-url-backup/2026-08-14T01-45-11-393Z" \
  node scripts/storage/restore-db-urls.mjs
```

`BACKUP_DIR`은 **JSON 4개가 직접 들어 있는 디렉터리**다(재작성 스크립트의
`BACKUP_DIR`은 그 상위 베이스 디렉터리라는 점에서 다르다). 백업에는 재작성
직전의 `artists` / `posts` / `post_attachments` / `event_applications` 값이
들어 있다.

복원과 함께 신규 업로드도 Supabase로 되돌리려면 `STORAGE_PROVIDER`를 지우고
재배포한다:

```bash
vercel env rm STORAGE_PROVIDER production
git commit --allow-empty -m "chore(storage): 제공자 롤백 반영" && git push origin main
```

### 주의 — 복원은 시점 되돌리기다

복원은 백업 시점 값을 무조건 덮어쓴다. 재작성 이후 정상적으로 바뀐 값(예: 그
사이 교체된 사진)도 함께 되돌아간다. 사고 대응용으로는 맞지만, 시간이 꽤
지난 뒤에 쓰려면 먼저 현재 값을 따로 떠두는 편이 안전하다.

### Supabase 원본을 지워도 되는 시점

단계 1b(이사회 문서)까지 끝나고 운영에서 한동안 문제가 없다고 확인된 뒤,
Supabase 프로젝트 자체를 삭제할 때 함께 사라진다. 그 전에 개별 객체를 미리
지우면 위의 복원 경로가 무력해지므로 지우지 않는다.
