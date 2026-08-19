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

## 권한 경계 검증 (단계 2b-3)

인증을 Supabase에서 옮기면 Supabase 쿠키 세션이 사라지고 `auth.uid()`가
NULL이 된다 — 운영 RLS 정책 58개 중 52개가 그 함수에 의존하므로 전부
거짓이 된다. "앱 계층이 스스로 같은 접근 판정을 내리는가"는 **RLS를 끈
상태**로 권한 E2E를 돌려야만 판정할 수 있다. **RLS가 켜진 채로 초록인 것은
증거가 아니다** — 실측으로 확인했다: `src/app/api/notifications/route.ts`의
`.eq('user_id', user.id)` 필터를 지우고 RLS ON으로 돌리면 스위트가 여전히
18/18 통과한다(RLS가 조용히 대신 막아준다). 같은 결함을 RLS OFF로 돌리면
그제서야 실패한다. 그래서 판정은 항상 RLS OFF 실행 기준이다.

전체 58개 정책 대 앱 계층 검사 1:1 매핑표는
`docs/superpowers/specs/2026-08-13-rls-mapping.md`에 있다(`docs/`는
gitignore 대상이라 이 저장소에는 커밋되지 않는다 — 새로 클론한 환경에는
없다). 아래는 그 표를 다시 만드는 절차다.

### 1. 로컬 스택을 띄운다

로컬 Supabase는 `supabase/migrations`를 그대로 두면 `supabase start`가
드리프트로 실패한다(운영이 `applied` 마킹과 실제 DDL이 어긋나 있다 — 위
"Supabase 마이그레이션 드리프트" 항목 참고). 그래서 마이그레이션을 잠깐
치우고 운영 스키마를 직접 주입한다. 포트는 Supabase 기본값
(API 54321 / DB 54322)을 그대로 쓴다 — `supabase/config.toml`을 건드릴
필요가 없다(포트가 이미 비어 있다는 전제 — 충돌하면 별도 포트 이동이
필요하며, 그 경우에만 config.toml을 고치고 **끝나면 반드시 원복한다**).

```bash
# 드리프트 우회: 마이그레이션을 잠시 다른 곳으로 옮기고 빈 상태로 기동
mv supabase/migrations /tmp/ggac-migrations-parked
mkdir -p supabase/migrations
supabase start

# 운영 스키마를 읽기 전용으로 덤프해 로컬 컨테이너에 주입
supabase db dump --linked -f /tmp/ggac-schema.sql
docker cp /tmp/ggac-schema.sql supabase_db_ggac:/tmp/schema.sql
docker exec supabase_db_ggac psql -U postgres -f /tmp/schema.sql
```

확인:

```bash
export E2E_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
node scripts/testing/rls-toggle.mjs status
```

기대값: `RLS 켜진 테이블: 30개` — 운영과 정확히 같은 수여야 한다. 다르면
스키마 주입이 불완전한 것이므로 멈추고 원인을 확인한다(정책 개수도 58개와
일치해야 한다).

끝나면(작업이 완전히 끝난 뒤): `supabase stop`, 그리고
`rm -rf supabase/migrations && mv /tmp/ggac-migrations-parked
supabase/migrations`로 원복한다. 포트를 옮겼다면 `config.toml`도 543xx로
되돌린다.

### 2. 픽스처를 시드한다

```bash
node scripts/testing/seed-authz-fixtures.mjs
```

`admin`/`owner`/`other`/`pending` 네 계정(GoTrue admin API로 생성)과 글 1·
댓글 1·알림 1·좋아요 1을 채우는 멱등 스크립트다. 두 번 돌려도 행이 늘지
않는다. 로컬이 아닌 호스트(`E2E_SUPABASE_URL`의 호스트가
127.0.0.1/localhost/::1이 아닌 경우)에는 거부하고 exit 1로 죽는다 — 운영에
잘못 시드되는 사고를 막는 가드다. 결과는 `e2e/.authz-fixtures.json`
(gitignore 대상)에 남고, E2E 스펙은 이 파일을 읽어 계정 id·글 id 등을
얻는다.

RLS를 끄고 켜는 스크립트는 `scripts/testing/rls-toggle.mjs`다:

```bash
node scripts/testing/rls-toggle.mjs status   # 현재 RLS 켜진 테이블 수
node scripts/testing/rls-toggle.mjs off      # 30개 전부 끈다 (판정용)
node scripts/testing/rls-toggle.mjs on       # 복원
```

`off`/`on` 모두 `docker exec <컨테이너> psql`로 실행되며(호스트에 psql 설치
불필요), `E2E_DATABASE_URL`의 호스트·Docker 엔드포인트·컨테이너의
`com.supabase.cli.project` 라벨 셋 다 로컬임을 확인해야만 동작한다 — 셋 중
하나라도 아니면 ALTER TABLE 이전에 거부한다. 컨테이너명은
`E2E_DB_CONTAINER`로 바꿀 수 있다(기본값 `supabase_db_ggac`).

### 3. 권한 E2E를 돌린다

```bash
export E2E_SUPABASE_URL="http://127.0.0.1:54321"
export E2E_SUPABASE_ANON_KEY="<supabase status의 anon key>"
export E2E_SUPABASE_SERVICE_ROLE_KEY="<supabase status의 service_role key>"
export E2E_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

npm run test:e2e:authz
```

필요한 환경변수는 이 넷뿐이다. `npm run test:e2e:authz`는
`playwright test --project=authz`의 별칭이며, `authz-setup` 프로젝트(4개
계정 로그인 → `e2e/.auth/*.json` storageState 저장)에 의존한 뒤
`e2e/authz-ownership.spec.ts`·`e2e/authz-personal.spec.ts`(총 18개 테스트)를
돈다. Playwright의 `webServer`가 이 네 환경변수를 `npm run dev`에 그대로
주입하므로, `.env.local`(운영 Supabase를 가리킴)보다 우선한다 — 빠뜨리면
`assertLocalSupabase()` 가드가 즉시 예외를 던진다.

**판정 절차:**

```bash
node scripts/testing/rls-toggle.mjs off
npm run test:e2e:authz    # 이 결과가 판정이다
node scripts/testing/rls-toggle.mjs on
```

**RLS OFF에서 18/18 통과해야 "앱 계층이 스스로 접근을 판정한다"고 말할 수
있다. RLS ON 상태로 돌려서 나온 통과는 증거가 아니다** — 위에서 실측한
대로, RLS가 조용히 대신 막아주는 사례가 실제로 있었다(알림 목록 필터
제거). RLS ON 실행은 앱 코드가 정상적으로 동작하는지 확인하는 회귀
스모크 정도로만 취급한다.

### 4. 커버리지의 한계

이 스위트는 게시글·댓글·알림·마이페이지 프로필 10개 엔드포인트만
건드린다. 운영 RLS 정책 58개 중 이 스위트가 실제로 경계를 단정하는 것은
9개뿐이다. 나머지는 코드를 읽어 동등한 검사를 확인했지만 테스트는 없거나
(28개), 테스트도 코드상 동등 검사도 없다(21개, `user_settings`·
`notifications` UPDATE처럼 여전히 DB RPC 내부의 `auth.uid()`에 의존하는
경우 포함). 행 단위 판정과 근거는
`docs/superpowers/specs/2026-08-13-rls-mapping.md`에 있다(커밋되지 않으므로
로컬에서만 볼 수 있다).
