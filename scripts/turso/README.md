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
