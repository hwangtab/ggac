# Turso 운영 메모

## DB
- 이름: `ggac-prod`
- 리전: `aws-ap-northeast-1`(도쿄). 무료 플랜은 그룹 1개 제한이고 기존
  `default` 그룹이 이미 도쿄에 있어서, `ggac-prod`는 새 그룹을 만드는 대신
  그 그룹에 합류해 리전을 자동 상속했다. `turso db create`에 `--location`을
  주지 않았고 앞으로도 주면 안 된다 — 새 그룹 생성을 시도해 그룹 한도
  초과로 실패한다.
- 스키마 적용: **`drizzle-kit push`를 운영에 쓰지 마라.**

  > **🔴 정정(2026-08-27 적대 감사).** 이 줄은 원래 `.env.local`을 셸에 로드한 뒤
  > push하라고 안내했다. **그대로 하면 성능 인덱스 23개가 전부 사라진다** —
  > 실측으로 `idx_*` 23 → 0, 질의 계획이 `SEARCH` → `SCAN`으로 되돌아갔다.
  > 원인은 `0004`·`0005`가 만든 인덱스가 Drizzle 스키마에 `index()`로 선언돼
  > 있지 않아 push가 "잉여"로 보고 지우기 때문이다. 에러는 나지 않는다 —
  > 전 조합원이 로그인·게시판 속도를 잃고 아무도 알아채지 못한다.
  >
  > 이제 `drizzle.config.ts`가 **원격 URL이면 던진다.** 로컬(`file:`·루프백)만
  > 통과한다. 우회 변수가 있지만 그걸 쓰기 전에 **인덱스를 스키마에 선언해
  > push가 지우지 않게 만드는 것이 먼저다.**

  운영 스키마 변경은 `src/db/migrations/`의 마이그레이션으로 한다 — `0002`~`0005`가
  그 방식이고 적용 절차가 이 문서 아래에 있다. push는 **로컬 개발·CI 전용**이다.

## 자주 쓰는 명령
```bash
turso db shell ggac-prod                 # 대화형 셸
turso db show ggac-prod                  # URL·리전 확인
turso db tokens create ggac-prod         # 새 토큰 발급

# 덤프 — 반드시 저장소 밖에. 아래 두 줄을 한 셸에서 이어서 실행한다.
DUMP_DIR=$(mktemp -d)
turso db shell ggac-prod .dump > "$DUMP_DIR/ggac-prod.sql"
```

⚠️ **덤프를 저장소 안에 만들지 마라.** `ggac-prod` 덤프에는 조합원 전원의
실명·전화번호·생년월일·계좌번호와 비밀번호 해시가 들어 있고 이 저장소는
공개다. 예전 이 문서는 `.dump > backup.sql`이라고만 적어 놨는데 그 명령은
CWD에 파일을 만든다 — 저장소 루트에서 한 번 실행하고 `git add -A` 한 번이면
그대로 공개된다. `mktemp -d` 안에서 다루고 끝나면 `rm -rf "$DUMP_DIR"`로
지운다(인증 덤프에 이미 쓰던 관례를 같은 이유로 여기에도 적용한다 —
"단계 2b-3 이후" 절 참고). `.gitignore`에 루트 한정
`*.sql`/`*.sql.gz`/`*.db` 규칙을 함께 넣어 뒀지만 그건 마지막 그물일 뿐이다.

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

### 되돌리는 방법 — ⛔ **이 탈출구는 단계 4 컷오버로 사라졌다** (2026-08-27 갱신)

예전 이 절은 아래 명령을 복붙용으로 안내했다.

```bash
# ⛔ 실행하지 마라 — 스크립트가 즉시 중단된다.
set -a; source .env.local; set +a
BACKUP_DIR="$HOME/ggac-url-backup/<타임스탬프>" \
  node scripts/storage/restore-db-urls.mjs --dry-run
```

**그 복원은 Supabase의 표를 되돌린다.** 단계 4(2026-08-26)에서 `artists` /
`posts` / `post_attachments` / `event_applications`의 권위가 Turso로 옮겨갔고,
앱은 Supabase를 어디에서도 읽지 않는다 — 되돌려도 **화면은 한 픽셀도 안
바뀐다.** 그래서 `scripts/storage/restore-db-urls.mjs`와 짝인
`rewrite-db-urls.mjs`는 직접 실행하면 즉시 중단되게 막아 뒀다(단위 테스트가
순수 함수를 import하므로 모듈 로딩 자체는 그대로 통과한다).

지금 URL을 되돌려야 한다면:

1. 대상은 **Turso의 같은 네 표**다(`src/db/schema/identity.ts`·`content.ts`).
2. 백업 JSON(`$HOME/ggac-url-backup/<타임스탬프>/*.json`)은 Supabase 시절의 행
   id를 담고 있다. Turso의 id와 같은지부터 확인해야 한다
   (`scripts/migrate/lib/`의 매핑 참고).
3. 그 일을 하는 도구는 **아직 없다.** 필요해지면 새로 써야 한다.

Supabase 원본 객체는 아직 지우지 않았으므로 옛 URL 자체는 계속 열린다. 다만
그 URL을 다시 쓰게 만들려면 Turso를 고쳐야 한다.

> **⚠ 신규 업로드 되돌리기도 사라졌다.** 예전에는 `STORAGE_PROVIDER`를 지우면
> 신규 업로드가 다시 Supabase Storage로 갔다. 이제 코드에 제공자 분기 자체가
> 없다(`src/lib/storage/provider.ts`는 Vercel Blob만 부른다) — 환경변수를 지워도
> 아무 효과가 없고, Supabase 클라이언트가 저장소에 0개라 되살릴 수도 없다.
> 신규 업로드까지 되돌려야 하는 상황이라면 배포 자체를 단계 4 이전 커밋으로
> 되돌리는 수밖에 없다.

### 주의 — 복원은 시점 되돌리기다

(Turso용 복원 도구를 새로 쓸 때도 그대로 적용되는 성질이다.) 복원은 백업 시점
값을 무조건 덮어쓴다. 재작성 이후 정상적으로 바뀐 값(예: 그 사이 교체된 사진)도
함께 되돌아간다. 사고 대응용으로는 맞지만, 시간이 꽤 지난 뒤에 쓰려면 먼저 현재
값을 따로 떠두는 편이 안전하다.

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
없다).

위 문단은 **단계 2b-3 시점의 판정 기준**이다(Postgres·RLS가 살아 있던
때). 아래 절차는 그 이후 저장소가 Turso 단일 저장소가 된 현재 기준으로
갱신돼 있다 — 권한 E2E는 지금도 권한 경계 회귀를 잡는 **유일한 자동
검사**이므로, 컷오버 전에 반드시 초록불임을 확인한다.

### 1. 로컬 스택을 띄운다 (단계 4 Task 6c 이후)

**로컬 Supabase 스택은 더 이상 필요 없다.** 단계 4 Task 5에서 앱 코드의
Supabase가 0개가 됐고, Task 6c에서 시드 스크립트와 e2e 스펙도 Turso만
쓰도록 바뀌었다. 필요한 것은 로컬 Turso 하나뿐이다.

```bash
# 1) 로컬 Turso를 HTTP 엔드포인트로 띄운다. 포트는 비어 있는 것으로 고른다.
#    (8080은 turso dev의 기본값이지만 다른 로컬 서비스와 부딪히기 쉽다)
turso dev --db-file /tmp/ggac-authz.db --port 8901 &

# 2) 스키마를 밀어 넣는다
TURSO_DATABASE_URL=http://127.0.0.1:8901 npx drizzle-kit push --force
```

**왜 `file:` 파일 DB가 아니라 `turso dev`인가.** 유지보수 모드 판정은 Edge
미들웨어 안에서 Turso를 읽는다(`src/middleware/settings.ts`). Edge 런타임용
`@libsql/client` 진입점은 `file:` URL을 `URL_SCHEME_NOT_SUPPORTED`로 거부하고,
그 실패는 fail-open(유지보수 꺼짐)으로 흡수된다 — 즉 `file:`로 돌리면
`authz-maintenance.spec.ts`가 "켰는데 안 걸린다"로 항상 깨진다. HTTP
엔드포인트여야 앱의 Edge 경로와 스펙이 같은 DB를 본다.

> **옛 절차(단계 2b-3, 2026-08-13).** 그때는 RLS 정책 58개를 판정하려고 로컬
> Supabase 스택(`supabase start` + 운영 스키마 주입 + `rls-toggle.mjs off`)을
> 띄우고 "RLS OFF에서 통과해야 증거"라는 기준으로 돌렸다. Postgres가 사라진
> 지금 그 절차는 재현 불가능하고 의미도 없다 — 접근 판정이 전부 앱 계층에만
> 있다. 절차 원문은 git 이력(`scripts/turso/README.md`, Task 6c 이전)에 있다.

### 2. 픽스처를 시드한다

```bash
TURSO_DATABASE_URL=http://127.0.0.1:8901 \
  node --experimental-strip-types scripts/testing/seed-authz-fixtures.mjs
```

계정 **6개**(Better Auth `user`/`account` + `member_profiles`)와 글 1·댓글
1·알림 1·좋아요 1, 그리고 **`system_settings` 2행**(`site/maintenance_mode`,
`site/registration_enabled`)과 `default_settings` 16행을 채우는 멱등
스크립트다. 두 번 돌려도 행이 늘지 않는다(id가 전부 고정값이다).

| 계정             | 역할                                    | 로그인 |
| ---------------- | --------------------------------------- | ------ |
| `admin`          | 관리자(승인·활성)                       | O      |
| `owner`          | 승인된 일반 조합원 — 픽스처 글의 작성자 | O      |
| `other`          | 승인된 일반 조합원 — "남"               | O      |
| `pending`        | 미승인                                  | O      |
| `director`       | 관리자가 **아닌** 이사                  | O      |
| `approvalTarget` | 관리자 승인 액션의 대상(미승인)         | X      |

- `system_settings`가 없으면 `authz-maintenance.spec.ts`의 UPDATE가 0행에
  적용돼 유지보수 모드가 아예 켜지지 않는다. 스펙은 `rowsAffected`를 확인해
  그 상태를 통과가 아니라 실패로 만든다.
- `default_settings`가 없으면 `getUserSettings`(default_settings를 왼쪽
  테이블로 조인)가 항상 빈 목록을 돌려줘 정책 58 스펙이 깨진다.
- 픽스처 글은 `is_deleted = false`로 **되돌려진다**. 삭제 인가에 회귀가
  생기면 스위트가 그 글을 실제로 소프트 삭제하는데, 이 값이 upsert에 없으면
  시드를 다시 돌려도 복구되지 않아 **수정을 검증하려는 바로 그 순간**
  소유권·첨부 스펙이 앱 탓처럼 보이는 엉뚱한 메시지로 계속 빨간불이 된다.
- **권한·승인 컬럼도 같은 이유로 강제로 되돌려진다**(`AUTHZ_DEFAULTS`).
  `upsertProfile()`은 이 컬럼들을 되돌리지 못한다 — 그 함수의 충돌 갱신
  화이트리스트(`CONFLICT_UPDATABLE_FIELDS`)가 권한·승인 컬럼을 **의도적으로**
  제외하기 때문이고, 그건 운영을 지키는 올바른 설계다(재이관·재가입이 관리자
  플래그를 덮어쓰면 안 된다). 그래서 되돌리는 책임이 시드 쪽에 있다.
  `authz-roles.spec.ts`가 관리자 승인 액션을 실제로 호출하므로, `where` 누락
  같은 회귀 상태로 스위트를 한 번만 돌려도 `authz-pending`이 `approved`가 되고
  그 뒤 시드를 몇 번 돌려도 복구되지 않았다(수정 전 실측). 시드는 되돌리기
  전 상태와 다르면 **무엇이 어떻게 달랐는지 경고로 찍고**(조용히 고치면 원인을
  못 본다), 되돌린 뒤 다시 읽어 대조해 그래도 다르면 **던진다**(fail-closed).

대상이 로컬 Turso가 아니면 아무것도 쓰기 전에 거부한다 —
`e2e/helpers/authState.ts`의 `assertLocalTurso()`가 허용하는 형태는 `file:...`
또는 `http(s)://127.0.0.1|localhost|::1` 뿐이고, `libsql://`·원격 `https://`는
전부 거부한다. 스펙 파일도 같은 함수를 부른다(판정이 한 곳뿐이다).

결과는 `e2e/.authz-fixtures.json`(gitignore 대상)에 남고, E2E 스펙은 이
파일을 읽어 계정 id·글 id 등을 얻는다.

### 3. 권한 E2E를 돌린다

```bash
export E2E_TURSO_DATABASE_URL="http://127.0.0.1:8901"
export BETTER_AUTH_SECRET="<아무 로컬 문자열>"
# 정책 36(첨부 업로드)만 필요로 한다. 공개 스토어 토큰만 쓴다.
export PUBLIC_BLOB_READ_WRITE_TOKEN="<공개 Blob 스토어 토큰>"
export NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL="<공개 Blob 베이스 URL>"

npm run test:e2e:authz
```

`E2E_TURSO_DATABASE_URL`은 **일부러 이름이 다르다.** `playwright.config.ts`가
그 값을 `process.env.TURSO_DATABASE_URL`로 옮겨 심고 dev 서버에도 같은 값을
넘긴다 — 셸에 운영 `TURSO_DATABASE_URL`이 export돼 있어도 그 값으로는 절대
돌지 않고, e2e 전용 변수를 의도적으로 지정해야만 돈다. `TURSO_AUTH_TOKEN`도
함께 지운다(로컬 `turso dev`는 토큰을 요구하지 않는다). 로컬 엔드포인트인지는
**옮겨 심기가 끝난 자리에서 조건 없이** 판정한다(`assertNoRemoteTursoTarget()`)
— 원격 URL을 주면 dev 서버가 뜨기 전에 config 로드가 죽는다(실측:
`libsql://ggac-prod…`·`https://ggac-prod…` 둘 다 `playwright.config.ts`에서
거부).

판정이 `if (E2E_TURSO_DATABASE_URL)` **밖**에 있어야 하는 이유: Playwright는
webServer에 `{...process.env, ...webServer.env}`를 넘긴다. e2e 전용 변수를 주지
않고 셸에 운영 `TURSO_DATABASE_URL`만 export된 경우 그 블록은 통째로 건너뛰지만
**운영 URL은 상속으로 그대로 dev 서버에 간다** — 안에 두었을 때 실측하면 dev
서버가 먼저 뜨고(`[WebServer]` 로그) 스펙 로드 시점에야 죽었다. 밖으로 뺀 뒤
같은 조건에서 `[WebServer]` 출력은 **0줄**이다. (`TURSO_DATABASE_URL`이 아예
없는 경우는 통과시킨다 — CI의 smoke 잡이 Turso 없이 `--project=chromium`만
돌리기 때문이다. 권한 E2E 쪽은 시드와 스펙이 여전히 `assertLocalTurso()`를
직접 불러 미설정도 거부한다.)

`npm run test:e2e:authz`는
`playwright test --project=authz --project=authz-public`의 별칭이다. 두
프로젝트를 다 도는 이유: `authz-boundaries.spec.ts`(비인증 401·보호 페이지
리다이렉트·API 계약)가 `authz-public`에 있어서, `--project=authz`만 돌리면
**컷오버 게이트인 이 명령 하나가 그 17건을 통째로 빼먹는다.**

- `authz-setup`(5개 계정 로그인 → `e2e/.auth/*.json` storageState 저장) 5건
- `authz`: `authz-maintenance`·`authz-ownership`·`authz-personal`·
  `authz-remaining`·`authz-roles` 5개 스펙 28건
- `authz-public`: `authz-boundaries` 17건

**실측 기준선(2026-08-26, Task 6c 수정 2회차):** 50 passed.

`PUBLIC_BLOB_READ_WRITE_TOKEN`을 빼면 **최초 실행에서는** 정책 36 테스트가
"토큰이 없으면 업로드 준비 단계를 통과할 수 없다"로 **명시적으로 실패한다**
(조용히 건너뛰지 않는다). 다만 그 준비 단계는 `if (!attachmentId)` 안에 있어서
**이전 실행이 남긴 첨부 행이 로컬 DB에 있으면 업로드 블록을 통째로 건너뛴다**
— 그 상태에서는 토큰 없이 돌려도 50건 전부 통과한다(실측). 즉 "토큰을 빼면
반드시 빨간불"은 빈 DB에서만 참이다.

`authz-roles.spec.ts`는 **관리자 경계**와 **이사 경계** 전용이다. 두 경계는
각각 대표 엔드포인트 하나씩만 보되 **짝지어 단정한다**(금지된 세션 403 +
허용된 세션 성공) — 금지 쪽만 보면 게이트가 "전부 막기"로 퇴화해 관리자
화면이 통째로 죽어도 초록불이기 때문이다. 관리자 게이트는 구현이 두 벌
(`requireAdmin()`과 `checkAdminPermission()`)이라 쓰기·읽기를 각각 다른
구현에서 골랐다.

같은 파일에 **페이지 레벨 인가** 2건이 더 있다(`/board-room`·`/admin`).
`src/app/[locale]/admin/page.tsx`와 `src/app/[locale]/board-room/page.tsx`는
**둘 다 `'use client'`**라 서버측 인가가 전혀 없고 **미들웨어가 유일한
게이트**인데(`src/middleware/auth.ts`의 `/admin`·board-room 두 분기), 그 두
분기를 동시에 무력화해도 이전 48건은 전부 초록이었다. API 스펙과 같은 규칙으로
짝지어 단정한다 — 금지 세션은 `/board`로 리다이렉트되고, 허용 세션(이사·관리자)은
그 화면에 실제로 도달해 제목이 그려진다. 리다이렉트만 보면 게이트가 "전부
리다이렉트"로 퇴화한 것을 못 잡는다(실측으로 확인).


### 4. 커버리지의 한계

이 스위트는 게시글·댓글·알림·마이페이지 프로필 10개 엔드포인트에 더해
관리자·이사 경계의 **대표 3개**(`/api/admin/member-action`,
`/api/admin/settings`, `/api/board-room/documents`)를 건드린다. 관리자
경계는 `/api/admin/*` 12개 디렉터리 중 두 라우트만 보는 셈이지만, 목적은
전수 커버리지가 아니라 **게이트 두 구현이 살아 있는지**다 — 그 게이트가
죽으면 나머지 라우트도 함께 열린다. 운영 RLS 정책 58개 중 이 스위트가
실제로 경계를 단정하는 것은
9개였다(단계 2b-3 시점). **단계 2b-4에서 3개가 추가로 승격돼 12개가 됐다** —
아래 「단계 2b-4: 신원 경로 일원화 판정」 참고. 나머지는 코드를 읽어 동등한
검사를 확인했지만 테스트는 없거나(28개), 테스트도 코드상 동등 검사도
없다(18개). 행 단위 판정과 근거는
`docs/superpowers/specs/2026-08-13-rls-mapping.md`에 있다(커밋되지 않으므로
로컬에서만 볼 수 있다).

### RLS 밖의 `auth.uid()` 의존 — 단계 2b-4 차단 항목

RLS 정책만 보면 놓친다. **Postgres 함수 본문 안에서 `auth.uid()`를 부르는 RPC가
20개 있고, 그중 13개를 앱이 실제로 호출한다.** 신원 판단이 앱 코드가 아니라 DB
함수 안에 있어서, 라우트를 아무리 읽어도 보이지 않는다. 전환 후 `auth.uid()`가
NULL이 되면 두 가지로 갈린다.

**(1) 즉시 깨지는 것 — 사용자 id를 넘길 방법이 없다. → 단계 2b-4에서 4건 모두
해소.**

| 함수 | 시그니처 | 호출부 | 상태 (2026-08-19, 단계 2b-4) |
|---|---|---|---|
| `mark_notification_read` | `(p_notification_id uuid)` | `api/notifications/[id]/route.ts:46` | **해소** — RPC 호출을 제거하고 `.from('notifications').update(...).eq('id', id).eq('user_id', user.id).is('read_at', null)` 직접 UPDATE로 교체 |
| `upsert_user_setting` | `(p_category, p_setting_key, p_setting_value)` | `api/settings/route.ts:142,210` | **해소** — RPC 호출을 제거하고 `.from('user_settings').upsert({user_id: user.id, ...}, {onConflict:'user_id,category,setting_key'})` 직접 UPSERT로 교체. 부수 발견: 이 RPC는 PL/pgSQL 지역 변수 `user_id`가 컬럼명과 겹쳐 `ON CONFLICT (user_id,...)`가 42702(column reference ambiguous)로 항상 실패하던, `auth.uid()`와 무관한 선행 버그였다 — 아래 참고 |
| `reset_user_settings` | `(p_category DEFAULT NULL, p_setting_key DEFAULT NULL)` | `api/settings/reset/route.ts:59` | **해소** — RPC 호출을 제거하고 `.from('user_settings').delete().eq('user_id', user.id)`(category/setting_key 조건부 체이닝) 직접 DELETE로 교체. 이 RPC도 동일한 `user_id` 변수-컬럼 충돌로 `WHERE user_id = user_id`가 42702였다 — 게다가 이 버그가 해소된 채로 그대로 실행됐다면 조건 없이 호출 시 **전체 사용자의 설정을 삭제**했을 것이다 |
| `get_user_settings` | `(p_user_id uuid DEFAULT NULL)` | `api/settings/route.ts:59` — **인자 없이 호출**해서 `auth.uid()`로 떨어진다 | **해소** — 호출부에서 `{ p_user_id: user.id }`를 명시적으로 넘기도록 수정(RPC 자체는 유지) |

RPC 함수 본문 자체는 DDL 변경 금지 지시로 고치지 않았다 — DB에는 여전히 깨진
채로 남아 있다. 다른 어딘가에서 이 RPC들을 계속 호출한다면(현재 grep으로는
없음을 확인) 동일하게 실패한다.

**부수 발견 — `user_settings` 저장 기능은 운영에서 한 번도 동작한 적이
없었다.** `upsert_user_setting`·`reset_user_settings`의 컬럼-변수 충돌
버그는 이번 `auth.uid()` 전환과 무관하게 처음부터 있었다. 운영
`user_settings`가 0행인 이유는 `auth.uid()` 문제가 아니라 이 버그였다 —
누구도 설정을 저장한 적이 없는 게 아니라, 저장을 시도할 때마다 항상 실패해
왔다. 이번 교체로 처음으로 정상 동작하게 됐다(로컬 스택에서 저장 단건·벌크·
초기화 전 구간 왕복 확인).

**(2) 조용히 검사가 사라지는 것 — id는 넘기지만 `auth.uid()`로 대조한다.
단계 2b-4는 조사만 했다, 아직 미해결이다.**

`toggle_post_like`·`toggle_comment_like`·`log_user_activity` 등은 본문에
`IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN <거부>` 형태의 가드가
있다. 전환 후에는 첫 조건이 거짓이 되어 **가드를 건너뛰고 그대로 실행된다.**
동작은 계속하지만 "남의 id를 넘겨 대신 좋아요를 누르는" 것을 막던 방어가
사라진다는 뜻이다. 호출부가 항상 세션 사용자의 id를 넘기는지 라우트별로 확인해야
한다. 단계 2b-4가 `grep -rn "p_user_id" src/app/api/` 전수 조사로 impersonation
구멍은 없음을 확인했지만(세션 id를 직접 쓰거나, 클라이언트가 대상 id를 넘기는
3곳은 모두 관리자/본인 게이트가 앱 계층에 별도로 있음), **이 가드 자체가
사라지는 문제는 여전히 해결되지 않았다** — 단계 2b-5의 몫이다.

조사 명령(로컬 스택 기준):

```bash
docker exec supabase_db_ggac psql -U postgres -At -c "
  select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and pg_get_functiondef(p.oid) like '%auth.uid()%' order by 1"
```

### 단계 2b-4: 신원 경로 일원화 판정 (2026-08-19)

인증 컷오버를 실행하지는 않고 준비만 했다. 네 가지를 확정했다.

1. **`readSessionUser()`가 서버 라우트의 단일 세션 읽기 창구가 됐다.**
   `supabase.auth.getUser()` 직접 호출은 17곳에서 이 함수(및 함께 도입한
   퍼널)와, 의도적으로 이번 단계에서 이월한 5곳으로 줄었다: `src/middleware.ts`,
   `src/middleware/auth.ts`, `src/components/CommentSection.tsx`,
   `src/app/api/auth/verify-session/route.ts`,
   `src/app/api/auth/reset-password/route.ts`. 정적 게이트의
   `directGetUserAllowlist`도 9건에서 2건으로 줄었다. **17곳이 5곳으로 준
   것이지 1곳이 된 게 아니다** — 이 5곳은 단계 2b-5가 마저 처리해야 한다.
2. **RPC 내부 `auth.uid()` 의존 4건 해소** — 위 표 참고. 그 과정에서
   `upsert_user_setting`·`reset_user_settings`가 애초에 컬럼-변수 충돌로
   깨져 있었다는 것과, 설정 저장 기능이 운영에서 한 번도 동작한 적이
   없었다는 것을 실측으로 확인했다.
3. **RLS 정책 8건("살아 있는데 미검증")에 대한 엔드포인트 조사와, 도달
   가능한 3건의 E2E 승격.** `docs/superpowers/specs/2026-08-13-rls-mapping.md`
   집계가 `E2E로 증명됨 9 / 앱 계층 확인(테스트 없음) 28 / 미검증 21`에서
   **`E2E로 증명됨 12 / 앱 계층 확인(테스트 없음) 28 / 미검증 18`**로
   바뀌었다(전체 58). 새로 승격된 3건: notifications UPDATE(정책 34,
   본인 알림만), post_attachments SELECT anon(정책 36, 무조건 공개),
   user_settings ALL(정책 58, GET+POST 경로만). 나머지 5건(정책
   15/26/29/37/56)은 검증할 앱 호출부 자체가 없다 — 댓글 수정 PATCH
   라우트가 없고(정책 15), 본인 임시 첨부 조회 GET이 없고(정책 37, `temp_session`은
   업로드 경로에만 쓰임), `member_profiles` INSERT 정책 두 건(정책 26/29)은
   단계 2b-5가 통째로 다시 짤 가입 흐름 전용이고, `user_activities` 본인
   조회(정책 56)는 관리자 전용 엔드포인트만 존재한다. 미검증 18건 전체
   목록과 사유는 매핑표에 있다(gitignore 대상이라 새로 클론한 환경에는
   없다 — 이 문단이 그 요약이다).
4. **판별력을 실측으로 확인했다.** 정책 34를 지키는
   `.eq('user_id', user.id)` 필터를 `src/app/api/notifications/[id]/route.ts`에서
   실제로 지우고 RLS OFF로 `npm run test:e2e:authz`를 돌리니 "남의 알림
   읽음 처리는 404 + 찾을 수 없음이다" 테스트가 `Expected: 404, Received:
   200`으로 실패했다. 필터를 복원하니 다시 22/22 통과했고, 연속 재실행에도
   같은 결과라 순서 의존 결함도 아니었다.

**RLS ON 상태로 초록인 것은 증거가 아니다 — 다시 말한다.** 이 단계도 앞선
단계(2b-3)와 같은 원칙을 그대로 따랐다: 판정은 **RLS OFF** 실행
기준이며, RLS ON 실행은 앱 코드가 정상 동작하는지 보는 회귀 스모크일
뿐이다. RLS ON 상태로 통과한다고 해서 앱 계층이 그 경계를 스스로 지킨다는
뜻이 아니다 — DB가 대신 막아주고 있을 수 있다(정책 34가 정확히 그 사례였다,
위 4번 참고). 이 단계를 끝낸 뒤에도 로컬 스택의 RLS는 30개 테이블 전부
켠 채로 남겨 두었다.

**가드가 조용히 사라지는 RPC 부류는 여전히 남아 있다.** 위 (2)절 그대로 —
`toggle_post_like` 등은 이번 단계에서 고치지 않았고, 조사(impersonation 구멍
없음 확인)만 했다. 단계 2b-5가 실제로 처리해야 한다.

## 단계 2b-5 — 전환 준비 기록 (2026-08-19/20 완료)

이 단계는 **인증 컷오버를 준비만 하고 실행하지 않았다.** 신원이 어디서
오는지(Supabase 세션 vs Better Auth 세션)는 아직 바꾸지 않았고, 컷오버 당일
바뀌는 지점만 미리 옮겨 놓았다. 넷을 미리 고쳤고, 각각 컷오버 **당일이
아니라 지금** 고쳐야 했던 이유가 있다.

### 1. 미들웨어 프로필 조회를 서비스롤로

미들웨어가 조합원 프로필을 읽을 때 쿠키 기반 anon 클라이언트를 썼다 — 즉
RLS가 그대로 걸렸다. 컷오버 후에는 `auth.uid()`가 NULL이 되고, RLS는
행을 감추지 에러를 내지 않는다. 그러면 승인된 조합원 19명 전원이 조용히
`/register/pending`으로 튕겨나가는데, 로그에는 아무것도 안 남는다 — 에러가
아니라 "행이 없다"로 보이기 때문이다. 이 결함은 컷오버 당일 트래픽으로만
드러났을 것이다. 지금 서비스롤로 옮겨야 컷오버 이전에 발견하고 고칠 수
있다. 헬퍼는 "행 없음"에 `null`을 돌려주고 조회 실패에는 던지도록 만들어
기존 3갈래 동작(공개 페이지 통과, 보호 페이지는 `/login`)을 그대로
보존한다.

### 2. 유지보수 모드가 API도 막게

미들웨어 matcher가 `api`를 제외하고 있었다 — "쓰기 동결"을 걸어도 아무것도
얼지 않았다. 컷오버는 반드시 쓰기 동결 구간(유지보수 켜기 → 배포 → 검증 →
끄기)을 거치므로, 그 동결이 실제로 동결인지는 컷오버 이전에 검증해야
한다. `/api/auth/*`와 정확히 `/api/health`만 열어 둔다 — 관리자가 스스로를
잠그지 않게, 그리고 배포 스모크 체크가 계속 돌게 하기 위해서다.
`/api/health` 지연은 콜드 스타트 이후 약 25ms → 26~33ms로 늘었다(matcher
확장으로 미들웨어 진입 비용이 붙었다).

### 3. Better Auth 설정을 실제 데이터 흐름에 맞춤

가입 훅이 Turso에 프로필을 썼는데 관리자 승인 화면은 Supabase를 읽고
있었다 — 컷오버 후 신규 가입자는 승인 화면에 아예 나타나지 않았을
것이다. 지금 Supabase에 쓰도록 고쳤고, **`auth.users`를 참조하는 FK가
13개**라는 사실이 드러나 그림자 `auth.users` 행을 먼저 만들도록
했다. `session.cookieCache`를 켜서 다음 단계 미들웨어가 쓸 수 있게 했다.
재설정·인증 메일은 콜백이 받는 `token`으로 자체 URL을 구성한다.

### 4. 7개 필드를 나르는 자체 가입 라우트

Better Auth가 가입 시 조용히 버리는 조합원 필드 7개(주소·전화번호·회비
등)를 나르는 커스텀 라우트를 추가했다. 운영에서는 여전히 닫혀 있다
(`disableSignUp: true` 유지) — 정상 경로 검증은 로컬에서만 끝났고, 운영
첫 실행은 단계 2b-6이다.

### 단계 2b-6의 원자적 변경 목록

아래는 **한 번에 함께 배포해야 하는** 변경이다. 신원의 출처가 Supabase
세션에서 Better Auth 세션으로 바뀌는 지점을 하나라도 빠뜨리면, 나머지는
새 신원을 보고 이것만 옛 신원을 봐서 로그인은 되는데 글은 못 쓰는 식의
불일치가 생긴다. 부분 배포가 없다.

- 화면 4개: `login/page.tsx`(550줄) · `signup/page.tsx`(685줄) ·
  `forgot-password/page.tsx`(114줄) · `reset-password/page.tsx`(183줄)
- `src/lib/server/session.ts`의 `readSessionUser()` — Better Auth 세션을
  읽도록 교체
- `src/middleware/auth.ts:117`의 `getClaims()`와 `src/middleware.ts`의 **두 곳**(`:127` 유지보수
  관리자 재검증, `:214`)의
  `getUser()` — 둘 다 Better Auth의 `getCookieCache` 계열로 교체
- `/auth/callback`(189줄) — Better Auth 인증 후 착지 지점으로 축소
- `api/auth/{logout,reset-password,verify-session}` 세 라우트
- `src/components/CommentSection.tsx`의 직접 `getUser()` 호출
- `src/app/api/activities/session/route.ts`의 세션 읽기 — **500 분기를
  보존한 채로** 교체(이 분기가 없으면 세션 조회 실패가 조용히 성공으로
  보인다)
- `disableSignUp: true` 제거 — 자체 가입 라우트가 처음으로 운영 트래픽을
  받는다
- `createSupabaseServer()`를 서비스롤로 전환 — **위 항목이 전부 끝나
  `.auth.*`를 부르는 소비자가 0이 된 뒤에만** 한다. 순서를 뒤집으면 아직
  안 옮긴 소비자가 인증 없는 서비스롤 클라이언트로 동작한다.

### 전환 당일 재이관이 필요하다

Turso에는 조합원 19명이 들어 있다. 운영 Supabase는 현재 21명이다 — 두
명이 2026-08-19에 새로 가입했다. `scripts/migrate/identity.mjs`는
`ON CONFLICT("id") DO UPDATE`로 쓰기 때문에 멱등이다. 그래서 절차는
간단하다: 컷오버 직전에 다시 실행한다.

```bash
supabase db dump --schema auth --data-only -f <스크래치패드>/auth.sql
node scripts/migrate/identity.mjs --dump <스크래치패드>/auth.sql            # dry-run으로 먼저 확인
node scripts/migrate/identity.mjs --dump <스크래치패드>/auth.sql --apply    # 실제 반영
```

`<auth.sql>`은 bcrypt 해시와 개인정보를 담으므로 저장소 밖(스크래치패드)에
두고 작업 후 지운다.

### 컷오버 순서

1. 유지보수 모드 켜기 (`system_settings.maintenance_mode.enabled = true`) —
   위 2번 항목 덕분에 이제 API 쓰기까지 실제로 얼어붙는다
2. 재이관 실행 (위 절차)
3. 배포
4. 검증 (로그인 4계정 왕복, 권한 E2E, 헬스체크)
5. 유지보수 모드 끄기

**롤백:** 직전 커밋으로 되돌리고 재배포한다. **Turso의 `user` /
`account` / `session` 테이블은 절대 지우지 않는다** — 이관된 bcrypt
해시가 그 안에 있고, 다시 만들 방법이 재이관 절차 자체이기 때문이다.

### matcher 확장으로 달라진 것

`api`를 matcher에서 빼지 않게 되면서 **모든 `/api/*` 요청이 미들웨어를 거친다.**
유지보수가 꺼져 있으면 설정·세션 조회를 건너뛰고 즉시 통과하지만, 미들웨어에 진입하는
고정 비용(실측 약 5~7ms)은 모든 API에 붙는다.

그리고 유지보수 중에는 예외 목록(`/api/auth/*`, 정확히 `/api/health`)에 없는 API가
전부 503이다.

> **정정(2026-08-27):** `/api/webhook/deploy-hook`은 제거됐다. 이 저장소는
> `git push origin main`으로만 배포하고, 그 라우트는 `DEPLOY_HOOK_SECRET`·
> `VERCEL_DEPLOY_HOOK_URL`이 설정된 적이 없어 **항상 401이었다**(호출하던
> `npm run deploy`도 헤더를 안 보냈다). 안 되는 경로를 남기면 다음 사람이
> 그걸 고치려고 시간을 쓴다.

### 여전히 미해결 — 정직하게 적는다

- `toggle_post_like` · `toggle_comment_like` · `log_user_activity` 안의
  `auth.uid() <> p_user_id` 가드가 컷오버 후 **조용히 무력화**된다(위
  "RLS 밖의 `auth.uid()` 의존" 절 참고). impersonation 구멍은 없다고
  확인했지만, 가드 자체가 없어지는 문제는 미해결이다.
- ~~그림자 `auth.users` 행이 프로필 없이 남는 경우(가입 훅이 두 쓰기 사이에
  죽는 경우)를 보여주는 관리자 화면이 없다.~~ **단계 4 Task 6b에서 해소.**
  회원 관리 화면 상단에 프로필 없는 계정 경고 배너가 뜨고(0건이면 렌더되지
  않는다), `GET/POST /api/admin/members/orphans`가 목록과 복구를 맡는다.
  이메일 인증 콜백(`/auth/callback`)도 프로필이 없으면 승인 대기 프로필을
  다시 만든다.
- `reset-password/page.tsx`는 아직 Supabase의 링크 모양을 전제로 하고,
  이 단계에서 손본 이메일은 `?token=` 모양의 URL을 만든다. 화면이 그
  파라미터를 읽지 않는다 — 단계 2b-6이 화면을 옮길 때 함께 고쳐야 한다.

### 경고 — `npm run dev`는 운영 Turso를 본다

`.env.local`의 `TURSO_DATABASE_URL`은 로컬이 아니라 **운영 Turso**를
가리킨다. 로컬 Supabase로 테스트하려고 `NEXT_PUBLIC_SUPABASE_URL`만
로컬로 덮어쓰면, Better Auth 가입 훅은 여전히 운영 Turso에 쓴다. 실제로
2026-08-20에 이 사고가 났다 — 테스트 계정 6개가 운영 Turso에
만들어졌고, 발견 후 `user`/`account`/`member_profiles`에서 지워
19/19/19를 복원했다. 로컬로 가입 흐름을 시험할 때는
`TURSO_DATABASE_URL`도 반드시 함께 덮어쓴다.

## 단계 2b-6 — 인증 전환 실행 기록 (2026-08-23 완료)

**이 시점부터 로그인·가입의 권위는 Better Auth(Turso)다.** Supabase Auth는
`auth.users` 껍데기 행(FK 13개용)만 남고 이 앱의 어떤 것도 인증하지 않는다.

전환 순서(실제 실행 순):

1. 유지보수 모드 ON → 페이지·쓰기 API 503, `/api/health`·`/api/auth/*`만 열림.
   `POST /api/posts`가 503인 것으로 쓰기 동결을 실측 확인했다.
2. `supabase db dump --schema auth --data-only` → `node scripts/migrate/identity.mjs
   --dump <path>`(dry-run)로 23/23/23/13을 확인한 뒤 `--apply`.
   적재 결과 user 23 / account 23(bcrypt 23) / member_profiles 23 / artists 13,
   필드 대조 검증 통과.
3. `git push origin main` (병합 커밋 `fb552c0`).
4. 유지보수 OFF 후 프로덕션 실측:
   - 가입 `POST /api/member-signup` 201, `profileSaved: true`, id가 UUID
   - 로그인 `POST /api/auth/sign-in/email` 200 (Turso 인증)
   - `/api/auth/verify-session`이 user + Supabase 프로필을 함께 반환
   - 미승인 계정의 `/mypage` → `/register/pending` (승인 게이트 동작)
   - 이사 승격 계정으로 `/board-room` 서류 **9건 전부** 다운로드 200,
     바이트 수 일치, `filename*=UTF-8''` 유지 — 미들웨어 매처에서 `api`
     제외를 없앤 변경이 다운로드 응답을 깨지 않음을 확인
   - 같은 계정의 `/admin/members`는 307 → `/board` (관리자 경계 유지)
5. 점검용 계정 2개(`cutover-check@`, `cutover-board@`)는 Turso·Supabase 양쪽에서
   삭제했다. 최종 상태 23/23/23/13, session 0, `%@test.local` 0건.

**주의:** 재이관은 멱등이지만 원본이 Supabase다. 회원이 늘어난 뒤 다시 돌릴
일이 있으면 반드시 dry-run 건수를 먼저 확인한다. 인증 덤프에는 bcrypt 해시와
개인정보가 들어 있으므로 `mktemp -d` 안에서만 다루고 즉시 지운다.

**남은 일:** 채팅에 노출된 Resend API 키 교체. `toggle_post_like` 등
`auth.uid()` 의존 RPC 3개는 전환 후 조용히 무력화된 상태이고, 콘텐츠 이관
단계에서 함께 걷어낸다.

---

## 단계 4 Task 6a — 이사회 스키마 제약 회복 (`0002_restore_board_constraints.sql`)

전환 초기 스키마(`0000`)가 Postgres 원본
(`supabase/migrations/20260529090020_create_board_room_tables.sql`)과 어긋난
제약 7개를 되돌린다. 정본 비교표와 근거는 `src/db/schema/board.ts` 상단 주석,
증명은 `scripts/testing/boardSchemaConstraints.test.mjs`에 있다.

| 제약 | 원본(Postgres) | 0000(Turso) | 0002 |
|---|---|---|---|
| `board_minutes.meeting_id` | UNIQUE | (없음) | UNIQUE 인덱스 복원 |
| `board_meetings.created_by` | SET NULL | NO ACTION | SET NULL |
| `board_agendas.proposed_by` | SET NULL | NO ACTION | SET NULL |
| `board_minutes.author_id` | SET NULL | NO ACTION | SET NULL |
| `board_documents.uploaded_by` | SET NULL | NO ACTION | SET NULL |
| `board_meeting_attendees.member_id` | NO ACTION | **cascade** | NO ACTION |
| `board_meeting_date_votes.voter_id` | NO ACTION | **cascade** | NO ACTION |

### ⚠ 적용 방법 — `drizzle-kit migrate`로 적용하지 말 것

SQLite는 `ALTER TABLE`로 제약을 못 바꾸므로 0002는 표 6개를 재작성한다.
재작성은 `PRAGMA foreign_keys=OFF` 상태여야 한다 — **켜진 채로 하면
`DROP TABLE board_meetings`가 자식 표(안건·회의록·출석·후보일자·투표)를
cascade로 전부 지운다.** 로컬 파일 DB에서 실측했다(`drizzle-kit generate`
생성물 원문이 정확히 그 상태였고, 각 1행씩 심어 두고 돌리자 5개 표가 전부
0행이 됐다).

**`drizzle-kit migrate`로 쳤을 때 실제로 일어나는 일(실측 확인):** 참사는
재현되지 **않는다.** PRAGMA가 트랜잭션 안에서 무시되는 것은 맞지만, 그 전에
스크립트의 `BEGIN;`이 `cannot start a transaction within a transaction`으로
즉시 실패해 전체가 롤백된다. 7개 표 행 수 그대로, `__drizzle_migrations`
그대로, 임시 표 0. 게다가 `ggac-prod`에는 `__drizzle_migrations` 베이스라인이
없어 `migrate`는 0000에서 먼저 죽는다.

> **컷오버 중에 exit 1을 봤다면 아무 일도 일어나지 않은 것이다.** 덤프 복원
> 같은 복구 작업에 들어가지 말고, 아래 지정 경로로 다시 적용하면 된다.
> (`BEGIN`은 원자성 장치이면서 동시에 이 오적용을 막는 **우연한 차단
> 장치**다. "트랜잭션은 마이그레이터가 걸어 주니 빼자"는 정리를 하면 그
> 차단이 사라진다 — 같은 경고를 SQL 헤더 주석에도 남겼고, 성질이 사라지면
> 깨지도록 `boardSchemaConstraints.test.mjs`에 테스트로 박아 뒀다.)

그래도 적용은 스크립트를 통째로 실행하는 경로로만 한다:

```bash
set -a; source .env.local; set +a   # 운영에 적용할 때만
node -e "import('@libsql/client').then(async m => {
  const fs = await import('node:fs')
  const c = m.createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  await c.executeMultiple(fs.readFileSync('src/db/migrations/0002_restore_board_constraints.sql','utf8'))
  console.log('applied'); c.close()
})"
```

### 적용 전 확인 (①②는 0행, ③은 인덱스 2개뿐)

```sql
-- ① 중복 회의록이 있으면 UNIQUE 인덱스 생성이 실패해 전체가 롤백된다
SELECT meeting_id, count(*) FROM board_minutes GROUP BY meeting_id HAVING count(*) > 1;
-- ② 기존 고아 행이 하나라도 있으면 0002의 마지막 단언이 전체를 롤백한다.
--    이 저장소의 복원 경로는 FK를 끈 채로 적재하므로(turso-restore) 고아가
--    존재할 수 있는 DB다. 컷오버 도중 실패로 알게 되지 말고 여기서 먼저 본다.
PRAGMA foreign_key_check;
-- ③ 0000이 만든 것 말고 다른 인덱스·트리거가 board_* 에 붙어 있으면
--    재작성에 딸려 사라진다. 적용 전 기대값은 0000이 만든 유니크 인덱스
--    2개뿐이다(board_meeting_attendees_meeting_member_idx,
--    board_meeting_date_votes_option_voter_idx). 적용 후에는
--    board_minutes_meeting_id_idx가 더해져 3개가 된다.
SELECT type, name FROM sqlite_master WHERE tbl_name LIKE 'board_%' AND sql IS NOT NULL AND type <> 'table';
```

### 적용 후 확인

```sql
PRAGMA foreign_key_check;                                  -- 0행
SELECT count(*) FROM board_meeting_attendees;              -- 적용 전 값과 같아야 한다
SELECT count(*) FROM board_meeting_date_votes;             -- 〃
SELECT "table", "from", "on_delete" FROM pragma_foreign_key_list('board_meeting_attendees');
SELECT name FROM sqlite_master WHERE name LIKE '__new_%' OR name LIKE '__migration_assert%';  -- 0행
```

검증은 마이그레이션 안에도 들어 있다: `__migration_assert_0002`는
`CHECK (ok = 1)` 하나뿐인 표이고, **첫 DROP 전에 FK가 실제로 꺼졌는지**·표마다
재작성 전후 행 수가 같은지·마지막에 FK 위반이 0인지를 여기에 INSERT해
확인한다. 어긋나면 CHECK 위반으로 트랜잭션 전체가 롤백된다(변이 테스트로 셋 다
실제로 무는 것을 확인했다).

> **FK 확인이 왜 따로 있나.** 행 수 단언은 표마다 자기 `DROP` 직전에 걸려
> 있어서, 뒤에 오는 `DROP TABLE board_meetings`가 **이미 재작성을 마친 앞
> 표들을** cascade로 비우는 형태의 사고를 하나도 잡지 못한다(앞 단언은 이미
> 통과, 뒤 단언은 `0 = 0`, `PRAGMA foreign_key_check`도 고아가 아니라 행 자체가
> 없으므로 0행). 실측: `PRAGMA foreign_keys=OFF`를 무력화하면 **에러 없이
> 커밋되고 5개 표가 비었다.** FK 단언을 넣은 뒤 같은 시나리오는
> `CHECK constraint failed: ok` → 전체 롤백 → 7개 표 전부 그대로가 된다.
> 즉 이 스크립트가 안전한 근거가 "PRAGMA가 먹었기를 바란다"에서 단언으로
> 바뀌었다. 운영 Turso가 PRAGMA를 어떻게 다루든 조용한 데이터 소실은 없다.

**⚠ 실패했을 때 커넥션에 `foreign_keys=OFF`가 남는다.** 마지막
`PRAGMA foreign_keys=ON;`은 스크립트가 성공했을 때만 실행된다. 위의 일회성
node 스크립트는 곧바로 커넥션을 닫으니 무해하지만, `turso db shell` 같은
대화형 세션에서 실패하면 **같은 세션의 이후 DML이 FK 없이 돈다.** 실패한
세션은 닫거나 `PRAGMA foreign_keys=ON;`을 직접 실행한 뒤 쓴다.

### 운영에 미치는 동작 변화

`board_meeting_attendees`·`board_meeting_date_votes`가 NO ACTION으로 돌아가
**출석·투표 기록이 남아 있는 회원은 `member_profiles`에서 바로 지울 수 없다**
(FK 에러). 이게 Postgres 원본의 동작이고, 출석은 정족수 계산의 원천이라
의도된 것이다. 탈퇴 회원을 실제로 지워야 하면 출석·투표 기록을 어떻게 할지
먼저 정한 뒤 그 행부터 처리한다. 앱에는 회원 삭제 경로가 없으므로(코드에
`member_profiles` DELETE 0곳) 화면 동작에는 영향이 없다.

## 단계 4 Task 6b — 프로필 완성도 소급 채움 (`0003_backfill_profile_completeness.sql`)

Postgres 트리거 `profile_completeness_trigger`를 쿼리 계층으로 이식하면서
(`src/db/queries/profileCompleteness.ts`), 원본 마이그레이션
`supabase/migrations/20250118090020_enhance_member_status_tracking.sql`이
트리거를 만든 **직후** 돌린 소급 채움(241~244행)이 빠져 있었다. 0003이 그것을
채운다.

**왜 지금 필요한가.** 원본 트리거는 `BEFORE UPDATE`인데 본체가 테이블을 다시
읽어 **갱신 직전** 값으로 점수를 매겼다(한 박자 지연). 그 지연은 승인 UPDATE
에도 걸린다 — `registration_status`를 `'approved'`로 바꾸는 UPDATE가 보는 값은
아직 `'pending'`이라 승인 10점이 붙지 않는다. 그래서 **승인 이후 프로필을 한
번도 고치지 않은 회원은 10점이 빠진 점수**로 이관돼 있다. 그대로 두면 관리자
화면에서 이미 다 채운 조합원이 계속 "프로필 미달"로 잡혀 불필요한 독촉 대상이
된다.

**원본의 `WHERE profile_completeness_score = 0`은 베끼지 않았다.** 그 조건은
0인 행만 채우는데, 지금은 **0이 아니면서 틀린 값**(승인 10점 누락)이 실재해서
그 조건으로는 손도 못 댄다. 0003은 조건 없이 전 행을 다시 매긴다 — 점수는 같은
행의 다른 컬럼들만으로 정해지는 순수 함수이므로 몇 번 돌려도 같은 값에
수렴한다(멱등). 근거와 증명은 `src/db/migrations/0003_backfill_profile_completeness.sql`
헤더 주석과 `scripts/testing/profileCompletenessBackfill.test.mjs`에 있다.

### ⚠ 적용 방법 — 0002와 같다(`drizzle-kit migrate` 금지)

단언이 물었을 때 UPDATE까지 통째로 롤백되도록 `BEGIN`/`COMMIT`이 파일 안에
있다. 마이그레이터가 자체 트랜잭션으로 감싸면 그 `BEGIN`이 `cannot start a
transaction within a transaction`으로 즉시 실패해 전체가 롤백된다(= 아무 일도
일어나지 않는다). 파일을 통째로 실행하는 경로로만 적용한다.

```bash
set -a; source .env.local; set +a   # 운영에 적용할 때만
node -e "import('@libsql/client').then(async m => {
  const fs = await import('node:fs')
  const c = m.createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  await c.executeMultiple(fs.readFileSync('src/db/migrations/0003_backfill_profile_completeness.sql','utf8'))
  console.log('applied'); c.close()
})"
```

### 적용 전후 확인

```sql
-- 적용 전: 지금 몇 명이 어떤 점수인지 기록해 둔다(적용 후 비교용).
SELECT id, registration_status, profile_completeness_score FROM member_profiles ORDER BY id;
-- 적용 후: 승인 회원 중 10점이 오른 행이 "승인 이후 프로필을 안 고친 회원"이다.
SELECT count(*) FROM member_profiles;                       -- 적용 전 값과 같아야 한다
SELECT min(profile_completeness_score), max(profile_completeness_score) FROM member_profiles;  -- 0~100
SELECT name FROM sqlite_master WHERE name LIKE '__migration_%';  -- 0행
```

`updated_at`은 하나도 바뀌지 않는다 — 파생 값을 채우는 일이 "이 회원 정보가
방금 바뀌었다"로 보이면 안 되기 때문이다. 마이그레이션 안의
`__migration_assert_0003`(`CHECK (ok = 1)`)이 ① 행 수 유지 ② `updated_at` 무변경
③ 결과 점수 0~100을 직접 확인하고, 어긋나면 트랜잭션 전체를 롤백한다(셋 다
변이 테스트로 실제로 무는 것을 확인했다).

### 운영에 미치는 동작 변화

관리자 회원 관리 화면의 완성도 숫자와 `/api/admin/members/stats`의
`averageProfileCompleteness`가 **한 번 움직인다.** 대부분 오르지만, 저장값이
실제 상태보다 부풀어 있던 행은 내려갈 수도 있다(원본 지연은 양방향이다).
회원에게 보이는 화면·권한·승인 상태에는 영향이 없다 — 0003은
`profile_completeness_score` 컬럼 하나만 쓴다.

## 단계 4 최종 리뷰 B-7 — 성능 인덱스 이관 (`0004_add_performance_indexes.sql`)

0000(`drizzle-kit push` 산출물)은 **스키마에 선언된 UNIQUE 인덱스만** 만들었다.
Postgres 원본이 성능을 위해 따로 만들어 둔 `CREATE INDEX`는 하나도 넘어오지
않았고, `EXPLAIN QUERY PLAN`으로 확인한 결과 뜨거운 읽기 경로가 전부
풀스캔이었다. 특히 로그인한 회원이 페이지를 열 때마다 `NotificationDropdown`이
부르는 `/api/notifications/stats`가 `SCAN notifications`였다 — `notifications`는
**공지 1건당 승인 회원 수만큼 행이 늘어나는 상한 없는 표**라 23명 규모에서는
안 보이지만 선형으로 나빠진다.

0004는 인덱스 20개를 만든다. **표를 재작성하지 않는다** — SQLite의
`CREATE INDEX`는 표 정의를 건드리지 않으므로 0002 같은 12단계 재작성 절차가
필요 없다. 어떤 도구가 이 변경으로 표를 재작성하려 들면 그건 잘못된 것이다.

### 옮긴 것 / 옮기지 않은 것

| 표 | 인덱스 | 원본과의 차이 |
| --- | --- | --- |
| posts | `idx_posts_keyset_pagination` (is_deleted, is_pinned↓, created_at↓, id↓) | 원본은 `WHERE is_deleted=false` 부분 인덱스 → 선행 컬럼화 |
| posts | `idx_posts_category_keyset_pagination` (is_deleted, category, is_pinned↓, created_at↓, id↓) | 〃 |
| posts | `idx_posts_author_id` (author_id, is_deleted, created_at↓) | 〃 |
| posts | `idx_posts_created_at_not_deleted` (is_deleted, created_at↓) | 〃 |
| comments | `idx_comments_post_id_created_at` (post_id, created_at, id) | 원본 부분 인덱스의 `is_deleted`는 Turso `comments`에 컬럼 자체가 없다 |
| comments | `idx_comments_author_id` (author_id, created_at↓) | 정렬 컬럼 추가 |
| post_likes | `idx_post_likes_user_post` (user_id, post_id) | 원본 `idx_post_likes_user_post_unique`와 같은 모양 |
| comment_likes | `idx_comment_likes_user_comment` (user_id, comment_id) | 원본 `idx_comment_likes_user_id` 확장 |
| notifications | `idx_notifications_user_created_at` (user_id, created_at↓) | 원본의 (user_id)와 (created_at↓)를 합친 형태 |
| notifications | `idx_notifications_read_status` (user_id, read_at) | 원본과 동일 |
| member_profiles | `idx_member_profiles_status` (registration_status, created_at↓) | 원본은 (registration_status, is_active) — `listProfiles`가 is_active로 거르지 않아 정렬이 임시 B-트리로 떨어졌다 |
| member_profiles | `idx_member_profiles_created_at` (created_at↓) | 동일 |
| member_profiles | `idx_member_profiles_artist_id` (artist_id) | 동일 |
| post_attachments | `idx_post_attachments_post_sort` (post_id, sort_order) | 원본 `idx_post_attachments_sort_order` |
| post_attachments | `idx_post_attachments_temp_cleanup` (is_temporary, expires_at) | 원본은 `WHERE is_temporary=TRUE` 부분 인덱스 → 선행 컬럼화 |
| user_activities | `idx_user_activities_created_at` (created_at↓) | 동일 |
| user_activities | `idx_user_activities_composite` (user_id, action_type, created_at↓) | 동일 |
| board_agendas | `idx_board_agendas_meeting` (meeting_id, sort_order) | 동일 |
| board_meeting_date_options | `idx_board_date_options_meeting` (meeting_id, candidate_date) | 정렬 컬럼 추가 |
| board_documents | `idx_board_documents_category` (category, created_at↓) | 동일 |

**부분 인덱스를 선행 컬럼으로 바꾼 이유.** SQLite도 부분 인덱스를 지원하지만
질의의 WHERE가 인덱스의 WHERE를 **구문적으로 함의**해야 사용한다. Drizzle이
만드는 조건은 바인딩 파라미터(`"is_deleted" = ?`)라 계획 단계에서 상수로
취급되지 않아 부분 인덱스가 선택되지 않는다(실측). 필터 컬럼을 첫 컬럼으로
올리는 SQLite 관용 형태가 같은 질의를 같은 비용으로 처리하고, 휴지통 조회
(`is_deleted = 1`)도 함께 탄다. 원본의 `OR is_deleted IS NULL` 가지는 Turso
스키마에서 무의미하다(`NOT NULL DEFAULT false`).

**옮기지 않은 원본 인덱스**
- Postgres 전용: `idx_posts_search_gin`(tsvector), `idx_posts_title_trgm`·
  `idx_posts_content_trgm`(pg_trgm). SQLite에 대응물이 없다. 게시판 검색은
  현재 `LIKE` 기반이라 이 인덱스들이 있었어도 안 쓰였다.
- 표가 없음: `activity_logs`, `error_logs`, `member_login_history`,
  `member_status_history`, `post_embedded_images`.
- 컬럼이 없음: `idx_notifications_user_read`(원본 `is_read` ↔ Turso `read_at`),
  `idx_member_profiles_photo_url`(`profile_photo_url`은 `artists`에만 있다).
- 이 저장소의 어떤 질의도 안 씀: `idx_notifications_expires_at`,
  `idx_notifications_type`, `idx_posts_like_count`, `idx_comments_like_count`.
  인덱스는 쓰기마다 갱신 비용이 든다 — 안 쓰이는 것을 옮기지 않는다.
- 기존 UNIQUE 인덱스가 접두사로 덮음: `idx_post_likes_post_id`·
  `idx_post_likes_optimized`, `idx_comment_likes_comment_id`,
  `idx_board_attendees_meeting`, `idx_board_date_votes_option`,
  `idx_user_settings_user_id`·`idx_user_settings_user_category`,
  `idx_artists_slug`·`idx_artists_legacy_id`, `idx_member_profiles_email`.

### ⚠ 적용 방법 — 0002·0003과 같다(`drizzle-kit migrate` 금지)

단언이 물었을 때 전체가 롤백되도록 `BEGIN`/`COMMIT`이 파일 안에 있다.
마이그레이터가 자체 트랜잭션으로 감싸면 그 `BEGIN`이 `cannot start a
transaction within a transaction`으로 즉시 실패해 전체가 롤백된다.

```bash
set -a; source .env.local; set +a   # 운영에 적용할 때만
node -e "import('@libsql/client').then(async m => {
  const fs = await import('node:fs')
  const c = m.createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  await c.executeMultiple(fs.readFileSync('src/db/migrations/0004_add_performance_indexes.sql','utf8'))
  console.log('applied'); c.close()
})"
```

### 적용 전후 확인

```sql
-- 적용 전 행 수를 기록해 둔다(인덱스 생성은 데이터를 건드리지 않는다).
SELECT (SELECT count(*) FROM posts), (SELECT count(*) FROM notifications), (SELECT count(*) FROM member_profiles);
-- 적용 후
SELECT count(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';  -- 20
SELECT name FROM sqlite_master WHERE name LIKE '__migration_%' OR name LIKE '__new_%';  -- 0행
EXPLAIN QUERY PLAN SELECT count(*) FROM notifications WHERE user_id = '<아무 회원 id>';
-- → SEARCH notifications USING INDEX idx_notifications_read_status
```

멱등이다(전부 `IF NOT EXISTS`). 증명은
`scripts/testing/performanceIndexes.test.mjs`가 담당한다 — 적용 전/후 계획을
같은 DB에서 대조하고(적용 전에 실제로 `SCAN`이었는지까지 단정한다), 행 수
불변·재실행 수렴·단언 롤백을 각각 확인한다.

---

## 단계 4 컷오버 실행 기록 (2026-08-26)

**이 배포(`f567ff4`)부터 Supabase는 아무것도 담당하지 않는다.**

실측 순서와 결과:

1. 사전 확인 — unit 918(915 pass)·runtime-risks·schema-contract·lint·type-check·build,
   authz e2e **50 passed**, Vercel 필수 변수 7종 존재 확인(`vercel env ls`, pull 안 씀)
2. 리허설 — `turso dev :8902`에 0000→0004 + content.mjs + stage4.mjs로 운영 덤프 전체 적재,
   빌드·기동 후 공개 화면·API 걷기(아티스트 13명, 저자 조인, 401 경계). 문제 0
3. 유지보수 ON — 현 배포가 Supabase를 읽으므로 **Supabase REST로** 켬(값 병합, 메시지 보존).
   65초 후 페이지·쓰기 503 / health·auth 200 확인
4. 운영 Turso 백업 — CLI 미로그인이라 **libsql API로 직접 덤프**(26표 182행).
   빈 파일 DB에 부어 복원 검증까지(23명/39글/13아티스트)
5. 실측 — 유지보수 ON **이후** 덤프. `maintenance_mode`가 `enabled:true`로 담긴 것 육안 확인.
   history 4→5(ON 기록). boolean 소문자
6. 선행 점검 — 원격 `PRAGMA foreign_keys=1` **실측**(마지막 미검증 구간), fk_check 0,
   board 표 전부 0행, 인덱스 정확히 0000의 2개, 비공개 Blob 서류 14
7. 마이그레이션 0001→0004 `executeMultiple` 적용 — 표 29, 임시 표 0, board 인덱스 6(유니크 3+성능 3),
   0003 점수 30~80, 성능 인덱스 20
8. 재이관 — stage4.mjs 18표, `--expect` 전량(user_activities 11,083 포함), 필드 단위 검증 통과
9. 배포 — `git push` → health `commit=f567ff4`·`turso:ok`. **새 배포가 Turso의 유지보수 값을
   읽어 503 유지** — 권위 전환이 끊기지 않음
10. 유지보수 OFF(`set-maintenance.mjs off`) 후 실측 — 공개 페이지·게시판(저자 조인)·게시글
    상세·아티스트 13명(+사진 Blob 200)·OG 메타·401 경계·`/signup` 200·직접 가입 403 전부 정상
11. 레거시 Storage — Turso 잔여 URL **0건**(6표 전수) → Supabase Storage 객체 삭제:
    board-documents 14 / attachments 37 / artists 27 / profiles 0. 삭제 후 사이트 이미지 정상

주의로 남길 것:
- `turso` CLI는 이 기계에서 미로그인 — 백업·shell은 libsql API로 한다
- zsh에서 루프 변수 `path`는 `PATH`를 덮는다(실제로 당함)
- 컷오버 당일 `og/post`라는 API는 없다 — 게시글 OG는 페이지 metadata에서 나온다

남은 것: 1주 관찰 → Supabase 프로젝트 정지 → 최종 pg_dump 보관 → 삭제(단계 5).
그때 Vercel의 `NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`STORAGE_PROVIDER`
제거(verify-env는 이미 선택 취급), `NEXT_PUBLIC_SUPABASE_URL`도 잔여 0 확인됐으므로 제거 가능.

---

## 인가는 E2E가 지킨다 — 정적 가드가 아니다

적대 감사(2026-08-27)가 인가 우회 15가지를 주입해 `npm run test:runtime-risks`와
`tsc`를 돌렸다. **11가지가 초록불로 통과했다.**

`src/lib/server/authz.ts`의 `isApprovedActive` 맨 앞에 `if (profile) return true`
한 줄이면 — 고정된 문구는 **그대로 남긴 채** — 관리자 API 26개가 열리는데
가드도 타입 검사도 통과한다. 가드는 **"이 문자열이 이 파일에 있는가"**만 보고
도달 가능성·실행 순서·데이터 흐름을 보지 않는다.

**인가를 바꿨으면 `npm run test:e2e:authz`를 돌려라**(기준선 50 passed, 실행 절차는
위 "권한 E2E" 절). 같은 감사에서 **E2E는 관리자 게이트 무력화를 실제로 잡았다.**

`assert-runtime-risks.mjs`가 여전히 값을 하는 자리는 **지워진 것**(게이트를 통째로
삭제하면 개수가 0이 되어 실패), **되살아나는 것**(Supabase 임포트·쓰기), **문자열
계약**(허용목록·파라미터 이름·마이그레이션 관례)이다. 그 파일 서두에 같은 내용을
적어 뒀다.

---

## 백업 — 어디에 있고 어떻게 되찾는가

**컷오버 후 감사(2026-08-27)에서 "백업 자동화가 어떤 문서에도 없다"가 Critical로
지적됐다.** 사고 한복판에서 이 문서를 펴 든 사람이 **이미 있는 백업에 도달하지
못하는 것**이 가장 비싼 실패다. 아래가 정본이다.

### 1. 야간 자동 백업 (정상 경로)

`.github/workflows/turso-backup.yml` — 매일 **18:00 UTC(KST 03:00)** + 수동 트리거.

`turso db shell .dump` → 크기·`CREATE TABLE`·마지막 줄 `COMMIT;` 3중 검증 → gzip →
**Vercel 비공개 Blob `backups/YYYYMMDD.sql.gz`, 90일 보존.**

되찾는 절차:
```bash
node scripts/turso/download-latest-backup.mjs   # 비공개 Blob에서 최신본
node scripts/turso/restore-from-dump.mjs        # 로컬 파일 DB로 복원
```

**실측(2026-08-27):** 최신본을 받아 복원하니 **29표 / `idx_*` 20개 / 18,250행**으로
운영과 완전히 일치했고, 그 DB로 `next start`가 정상 기동했다.
**즉 Turso가 통째로 날아가도 최대 24시간 전으로 완전 복구된다.**

**RPO는 24시간이다.** 그 사이 쓰기는 유실된다.

### 2. `turso db shell .dump`가 이 기계에서 안 되는 이유

**CLI가 미로그인이다**(`~/.turso/settings.json` 없음). 위 워크플로는 GitHub 시크릿
`TURSO_API_TOKEN`으로 돌지만 로컬에는 그 토큰이 없다.

로컬에서 즉석 덤프가 필요하면 **libsql API로 직접 뜬다** — 컷오버 때 쓴 방법이다.
`sqlite_master`를 읽어 DDL을 뽑고 표별로 `SELECT`해 `INSERT`를 만든다.
(`turso auth login`을 하면 CLI 경로가 열린다.)

### 3. `~/ggac-backups/turso-pre-cutover-2026-08-26.sql` — **무엇이 빠졌는지 알고 써라**

컷오버 **직전**(단계 4 재이관 이전) 스냅샷이다. 26표 182행. 복원 자체는 검증됐다.

**이걸로 롤백하면 사라지는 것:**

| | |
|---|---|
| **표가 통째로 없음** | `user_sessions`(5,937) · `daily_activity_stats`(865) · `system_settings_history` |
| **0행이 됨** | `user_activities` 11,083 · **`system_settings` 19**(사이트 설정·SMTP·유지보수·가입 토글) · `default_settings` 16 · 이사회 108 · `event_applications` 15 · `link_previews` 20 |
| **인덱스** | 성능 인덱스 20개 전부 |
| **살아남음** | 회원 23 · 글 39 · 댓글 22 · 알림 24 · 아티스트 13 · 첨부 2 |

**롤백 시 후속 작업**: `0001`~`0004` 재적용(표 3개 + 인덱스 20개) → `system_settings`
재구성. `user_sessions`가 없어도 로그인은 죽지 않지만(`manageUserSession`이 `after()`
안에서 `.catch`) 세션 추적과 관리자 실시간·분석 화면이 조용히 빈다.

**위 컷오버 기록 5번의 "덤프에 `maintenance_mode`가 담긴 것 확인"은 재이관용 Supabase
`pg_dump` 이야기다.** 이 Turso 백업 파일에는 `system_settings` INSERT가 **0건**이다.

### 4. 알려진 빈 곳 (2026-08-27 감사)

- **백업 실패 알림이 없다.** 2026-08-18 실행이 API 토큰 만료로 실패했는데 조용히
  지나갔다(`SLACK_BOT_TOKEN` 시크릿은 있으나 워크플로가 안 쓴다). 토큰은 또 만료된다.
- **백업이 운영과 같은 Vercel 계정 안에만 있다.** `PRIVATE_BLOB_READ_WRITE_TOKEN`
  하나가 유일한 열쇠고 오프사이트 사본이 없다.
- **단계 5 최종 `pg_dump` 절차가 정해져 있지 않다.** Supabase를 지우는 순간
  Postgres 형태의 사본은 영구히 사라진다 — **삭제 전에 어디에·어떤 명령으로·어떻게
  검증할지 정하고 실행할 것.**

### `0005_add_user_sessions_indexes.sql` (2026-08-27)

컷오버 후 감사에서 **0004가 `user_sessions`를 통째로 빠뜨린 것**이 드러났다.
미이관 사유 목록에도 없었으니 판단이 아니라 누락이다. Postgres 원본
(`20250719090020_create_activity_tracking_system.sql:148-151`)에는 인덱스가 4개 있었다.

이 표는 **로그인·세션 갱신마다 읽히고 가장 빨리 자란다**(적용 시점 5,937행).

적용 방법은 0002~0004와 같다(`drizzle-kit migrate` 금지, `executeMultiple`).

실측:

```
적용 전  SELECT … WHERE user_id=? AND is_active=1          → SCAN user_sessions
         SELECT … WHERE is_active=1 ORDER BY last_activity → SCAN user_sessions
적용 후  → SEARCH … idx_user_sessions_user_active (user_id=? AND is_active=?)
         → SEARCH … idx_user_sessions_active_last_activity (is_active=?)
행 수 5,937 불변 · 임시 표 잔여 0 · 2회 적용 수렴
```

---

## 단계 5 — Supabase 프로젝트 해지 절차

**삭제는 되돌릴 수 없다.** 컷오버 후 감사(2026-08-27)가 "최종 `pg_dump` 절차가
계획 문장 한 줄뿐"이라고 Critical로 지적했다. 아래가 정본이다. **순서를 지킨다.**

### 선행 조건 (전부 충족돼야 시작한다)

- [ ] 컷오버 후 **1주 관찰** 완료, 이상 없음
- [ ] **실계정 로그인 1회 성공 확인** — 컷오버 이후 Better Auth `session`이 계속
      0행이면 "아무도 안 들어왔다"와 "로그인이 깨졌다"가 구분되지 않는다.
      이것만은 반드시 사람이 확인한다
- [ ] 야간 자동 백업이 최근 7일 연속 성공 (`gh run list --workflow=turso-backup.yml`)

### Step 1 — 이관되지 않은 표를 어떻게 할지 **먼저 결정한다**

Turso에 없고 Supabase에만 있는 데이터 표(2026-08-27 실측):

| 표 | 행 | 처리 |
|---|---:|---|
| `member_login_history` | 0 | 폐기(원본도 0행) |
| `member_status_history` | 0 | 폐기(원본도 0행) |
| `profiles` | 0 | 폐기(원본도 0행) |
| `error_logs` | 1 | 폐기(README 폐기 목록에 명시) |
| **`member_profiles_normalize_log`** | **11** | **⚠ 결정된 적 없음** |

`member_profiles_normalize_log`는 2025-09-12 정규화 스크립트가 남긴 **변경 전/후
값**이다 — 전화번호 8건, 은행명 2건, **계좌번호 1건**. 관리자에게 열려 있던
되돌리기용 기록이고, 앱 코드 참조는 0곳이라 화면은 안 깨진다. 어느 폐기 목록에도
없으니 **판단이 아니라 누락이다.**

**결정됨(2026-08-27, 사용자): 최종 덤프에 포함해 보관한다.** 아래 Step 2의
`pg_dump`가 전 표를 뜨므로 별도 작업이 필요 없다 — 다만 **검증 ③에서 이 표가
실제로 담겼는지 반드시 확인**한다. 되찾을 일이 생기면 그 덤프가 유일한 출처다.

### Step 2 — 최종 `pg_dump`

```bash
BK=~/ggac-backups && mkdir -p "$BK" && chmod 700 "$BK"
STAMP=$(date +%Y%m%d)

# 스키마 + 데이터 + 역할까지 전부. --data-only를 쓰지 마라 —
# 이건 재이관용이 아니라 영구 보관용이라 DDL·RLS 정책·함수가 다 필요하다.
supabase db dump --file "$BK/supabase-final-$STAMP.sql"
supabase db dump --data-only --file "$BK/supabase-final-data-$STAMP.sql"

chmod 600 "$BK"/supabase-final-*.sql
```

**검증**(하나라도 어긋나면 삭제하지 마라):

```bash
# ① 크기가 0이 아니고 잘리지 않았는가
ls -la "$BK"/supabase-final-*.sql
tail -1 "$BK/supabase-final-data-$STAMP.sql"     # 중간에서 끊기지 않았는지

# ② 표가 다 들어갔는가 (데이터 덤프에 INSERT가 있는 표)
grep -o 'INSERT INTO "public"\."[a-z_]*"' "$BK/supabase-final-data-$STAMP.sql" \
  | sort -u | wc -l

# ③ 결정한 표가 실제로 담겼는가
grep -c 'member_profiles_normalize_log' "$BK/supabase-final-data-$STAMP.sql"

# ④ 스키마 덤프에 함수·정책이 담겼는가 (재현 가능성)
grep -c 'CREATE POLICY' "$BK/supabase-final-$STAMP.sql"
grep -c 'CREATE FUNCTION' "$BK/supabase-final-$STAMP.sql"
```

> **⚠ 개인정보다.** 조합원 23명의 실명·전화·생년월일·계좌번호와 bcrypt 해시가
> 들어 있다. **저장소 밖에 두고**(`~/ggac-backups`, 700/600) **절대 커밋하지 마라.**
> 저장소는 공개다. 루트에 `.sql`을 두면 `.gitignore`의 `/*.sql`이 막지만
> 하위 디렉터리는 안 막는다.

### Step 3 — Storage 확인

**컷오버(2026-08-26)에 4개 버킷 78객체를 이미 삭제했다.** Turso 잔여 URL 0건을
실측한 뒤였다. 지금 비어 있는지만 재확인한다.

### Step 4 — 정지 → 관찰 → 삭제

1. **프로젝트 정지**(삭제 아님). 며칠 두고 사이트에 아무 영향이 없는지 본다 —
   정지 상태에서 무언가 깨지면 **아직 Supabase를 읽는 경로가 남아 있다는 뜻**이고,
   그때는 삭제 전에 그것부터 찾는다.
2. 이상 없으면 **삭제**.

### Step 5 — 삭제 후 코드·환경 정리

삭제 **전에는** 하지 마라. 되돌릴 때 필요하다.

- [ ] Vercel 환경변수 제거: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `STORAGE_PROVIDER`(읽는 코드 0곳 실측), 그리고 **마지막에**
      `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_URL`을 지우면 레거시 Storage URL 판정 4곳
      (`src/utils/site.ts`·`storageUrlValidation.ts`·`imageDimensions.ts`·
      `lib/storage/paths.ts`)이 의미를 잃는다. **Turso 잔여 URL 0건은 컷오버에서
      이미 실측했으므로 제거 전제조건은 충족돼 있다.** 그 판정 코드도 함께 정리한다
- [ ] `verify-env.js`에서 Supabase 항목 제거
- [ ] CSP·preconnect의 Supabase 잔재 제거 — `src/middleware/csp.ts`,
      `next.config.js`, `src/utils/security.ts`(3중복), `layout.tsx`의 preconnect.
      지금은 아무것도 안 깨지지만 **이제 아무것도 서빙하지 않는 호스트로 매 페이지
      DNS+TLS 핸드셰이크를 낭비한다**
- [ ] `supabase/migrations/`는 **역사 기록으로 남긴다.** 원본 제약·트리거·RPC의
      유일한 출처이고, 이 이전 내내 "원본이 무엇이었나"를 여기서 확인했다
- [ ] `.claude/settings.local.json`의 `Bash(supabase:*)`·`supabase db push` 무확인
      허용 제거 — 죽은 DB에 DDL을 밀어넣을 수 있는 경로다

### 이 시점부터 되돌릴 수 없는 것

Supabase를 지우면 **Postgres 형태의 사본은 Step 2의 덤프가 전부다.** Turso 백업은
SQLite다 — 스키마·타입·함수·RLS 정책이 다르다. 즉 "Postgres로 돌아간다"는 선택지는
그 덤프 파일 하나에 달린다.
