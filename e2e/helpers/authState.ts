import { readFileSync } from 'node:fs'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export type Fixtures = {
  users: Record<
    // 로그인 상태(storageState)를 만드는 계정 — `e2e/authz.setup.ts`와 짝이다.
    | 'admin'
    | 'owner'
    | 'other'
    | 'pending'
    | 'director'
    // 탈퇴 "신청" 상태(Task 8) — `registration_status`는 여전히 'approved'라
    // 정상 로그인하고 storageState도 만든다.
    | 'withdrawalRequested'
    // 로그인하지 않는 계정: 관리자 전용 쓰기 경계(회원 승인)의 **대상**이다.
    | 'approvalTarget'
    // 탈퇴 **완료** 계정(Task 8)의 자리표시자 이메일. 로그인 수단(account
    // 행)이 없어 storageState를 만들지 않는다 — 값은 id가 아니라 이메일이다.
    | 'withdrawnEmail',
    string
  >
  postId: string
  commentId: string
  notificationId: string
  /** 이사회 안건 토론 경계용 — `director`가 작성자다. */
  boardMeetingId: string
  boardAgendaId: string
  boardCommentId: string
  /** 관리자 삭제 스펙이 소모하는 쪽. 스펙이 실행 안에서 되돌린다. */
  boardCommentDeletableId: string
  /** 작성자가 `admin`인 댓글 — "이사이지만 작성자가 아닌 사람" 경계용. */
  boardCommentByAdminId: string
}

/**
 * 권한 E2E는 계정을 만들고 글을 쓰고 지운다. 그리고 유지보수 모드를 켰다 끈다.
 * 대상 DB가 운영 Turso면 그 조작이 전부 실제 회원 데이터 위에서 벌어진다 —
 * 그래서 스펙 파일과 시드 스크립트가 **맨 처음** 이 가드를 부른다.
 *
 * 단계 4 Task 5에서 앱 코드의 Supabase가 0개가 됐다. 그 전까지 같은 자리에
 * 있던 `assertLocalSupabase()`(`E2E_SUPABASE_URL`의 호스트가 로컬인지 확인)는
 * 이제 아무것도 지키지 못한다 — 앱도 스펙도 Supabase에 접속하지 않으므로 그
 * 환경변수가 맞든 틀리든 테스트가 실제로 쓰는 저장소는 Turso 하나다. 이
 * 함수가 그 자리를 통째로 대신한다.
 *
 * **허용 목록 방식이다.** 예전 판정은 `libsql://`로 시작하면 거부하는 금지
 * 목록이었는데, 그 방식은 다른 표기로 노출된 원격 엔드포인트(예: Turso의
 * `https://` 호스트)를 조용히 통과시킨다. 여기서는 다음 둘만 통과시키고
 * 나머지는 전부 거부한다:
 *
 *   - `file:` — 로컬 SQLite 파일
 *   - `http:`/`https:` + 호스트가 127.0.0.1/localhost/::1 —
 *     `turso dev --db-file <경로> --port <포트>`가 띄우는 로컬 엔드포인트.
 *     **유지보수 스펙에는 이 형태가 필수다**: Edge 런타임용
 *     `@libsql/client` 진입점이 `file:` URL을 `URL_SCHEME_NOT_SUPPORTED`로
 *     거부하는데, 유지보수 판정은 Edge 미들웨어 안에서 Turso를 읽기 때문이다
 *     (`src/middleware/settings.ts`). `file:`로 돌리면 그 조회가 매번 실패해
 *     fail-open(유지보수 꺼짐)으로 흡수되고, 스펙은 "켰는데 안 걸린다"로
 *     깨진다.
 */
export function assertLocalTurso(): void {
  const url = process.env.TURSO_DATABASE_URL
  if (!url) {
    throw new Error(
      'TURSO_DATABASE_URL이 없다. 권한 E2E는 로컬 Turso에서만 돌린다 ' +
        '(scripts/turso/README.md의 「권한 E2E를 돌린다」 참고).'
    )
  }
  if (url.startsWith('file:')) return

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`TURSO_DATABASE_URL을 해석할 수 없다: ${url}`)
  }
  const isLocalHttp =
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    LOCAL_HOSTS.has(parsed.hostname)
  if (!isLocalHttp) {
    throw new Error(
      `권한 E2E를 로컬이 아닌 TURSO_DATABASE_URL에 돌리지 않는다: ${url}\n` +
        '허용되는 형태는 `file:...` 또는 `http(s)://127.0.0.1:<포트>`뿐이다.'
    )
  }
}

/**
 * **dev 서버가 상속할 값**을 판정한다 — `playwright.config.ts`가 조건 없이
 * 부른다.
 *
 * Playwright는 webServer 프로세스에 `{...process.env, ...webServer.env}`를
 * 넘긴다(`node_modules/playwright/lib/plugins/webServerPlugin.js`). 그래서
 * `E2E_TURSO_DATABASE_URL`을 주지 않은 채 셸에 운영 `TURSO_DATABASE_URL`이
 * export돼 있으면, e2e 전용 변수를 다루는 분기를 통째로 건너뛰고도 **운영
 * URL이 그대로 dev 서버로 흘러간다.** 실측: 그 상태에서 dev 서버가 먼저 뜨고
 * (`[WebServer]` 로그 7줄) 스펙 파일 로드 시점에야 죽는다 — 그 사이 readiness
 * 요청이 운영 Turso를 읽는다.
 *
 * **판정 자체는 `assertLocalTurso()` 하나뿐이다**(사본을 만들지 않는다).
 * 차이는 "값이 아예 없을 때"의 처리 하나다:
 *
 * - 이 함수는 **미설정을 통과시킨다.** CI는 `--project=chromium`으로
 *   `e2e/smoke.spec.ts`만 돌리고 Turso 환경변수를 전혀 주지 않는다
 *   (`.github/workflows/ci.yml`의 smoke-test 잡). 상속으로 운영에 닿을 값
 *   자체가 없는 경우라 여기서 던지면 권한 E2E와 무관한 CI가 깨진다.
 * - 권한 E2E 쪽은 미설정도 막아야 한다(대상이 `.env.local`로 새는 것을
 *   허용하지 않는다). 그건 시드 스크립트와 authz 스펙들이 여전히
 *   `assertLocalTurso()`를 직접 부르는 것으로 유지된다.
 */
export function assertNoRemoteTursoTarget(): void {
  if (!process.env.TURSO_DATABASE_URL) return
  assertLocalTurso()
}

export function storageStatePath(role: string): string {
  return `e2e/.auth/${role}.json`
}

export function readFixtures(): Fixtures {
  return JSON.parse(readFileSync('e2e/.authz-fixtures.json', 'utf8'))
}
