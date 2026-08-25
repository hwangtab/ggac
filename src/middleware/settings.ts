/**
 * System Settings Middleware Logic
 * 시스템 설정 조회 및 캐싱을 담당합니다.
 *
 * 단계 4에서 `system_settings`의 권위가 Turso로 옮겨갔다. 이 모듈은 그 쿼리
 * 계층(`src/db/queries/settings.ts`)의 `listSystemSettings`를 그대로
 * 재사용한다 — 쿼리 계층 자체(리뷰 대기 중)는 손대지 않는다.
 * `src/middleware/profile.ts`가 `getProfileById`를 그대로 통과시키는 것과
 * 같은 패턴이다.
 *
 * 이전에는 이 디렉터리의 다른 모듈이 노출하던 REST 헬퍼로 service-role 키를
 * 써서 `system_settings`을 직접 읽었다. 일반 사용자도 유지보수 모드를 확인해야
 * 하는데 `get_system_settings` RPC는 SECURITY DEFINER 내부에서 admin 체크를 해
 * 일반 사용자가 호출하면 항상 실패했기 때문이다. `listSystemSettings`는 권한을
 * 모르는 순수 쿼리 계층이라 애초에 그 문제가 없다. 그 모듈은 Task 5에서
 * 저장소에서 삭제됐다.
 *
 * Edge 런타임: `@libsql/client`의 Edge 진입점은 `file:` URL을 거부하지만
 * `libsql://`(운영 Turso URL)은 정상 동작한다 — 단계 2c에서
 * `src/middleware/profile.ts` 전환 시 실측 확인됐고, 그 파일이 이미 매
 * 요청마다 Edge에서 Turso를 읽고 있다. 로컬/CI에서 `TURSO_DATABASE_URL`이
 * `file:...`이면 이 조회는 실패하지만, 아래 타임아웃 + fail-open 정책이
 * 그대로 흡수한다(사이트가 죽지 않는다).
 */

import { listSystemSettings, type SystemSettingRow } from '../db/queries/settings.ts'
import { withTimeout, FETCH_TIMEOUT_MS } from './profile.ts'

interface PublicSystemSettings {
  maintenanceMode: boolean
  maintenanceMessage?: string
  registrationEnabled: boolean
  timestamp: number
}

// 캐시는 Edge isolate 단위라 인스턴스 간 전파가 없다. 관리자가 유지보수 모드를
// 토글했을 때 최대 이 시간만큼 반영이 늦을 수 있으므로 짧게 유지한다
// (조회는 타임아웃 보호가 걸린 Turso 쿼리 1회 — 60초당 1회면 부담 없음).
// 조회 실패 시에는 null을 반환해 유지보수 모드가 꺼진 것처럼 동작한다(fail-open).
// 이는 의도된 정책이다: settings 장애가 사이트 전체 차단(fail-closed)으로
// 번지는 것보다 유지보수 안내가 늦는 쪽이 낫다. Turso 전환 이후에도 이 정책은
// 그대로 유지한다 — "모름"을 "꺼짐"으로 처리하지 않으면(fail-closed로 바꾸면)
// Turso 순단 한 번에 사이트 전체가 503이 된다.
let settingsCache: PublicSystemSettings | null = null

// 기본 60초. 테스트 환경에서만 0으로 낮춰 설정 변경이 즉시 반영되게 한다
// (E2E는 유지보수 모드를 켜고 끄며 미들웨어의 반응을 검증한다).
// 운영에서는 절대 설정하지 않는다 — 요청마다 system_settings를 읽게 된다.
const SETTINGS_CACHE_DURATION = (() => {
  const raw = Number(process.env.SETTINGS_CACHE_TTL_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 60 * 1000
})()

/**
 * **실패도 캐시한다**(최종 리뷰 B-4).
 *
 * 이 미들웨어의 matcher는 전 페이지 + 대부분의 `/api/*`다. 예전에는 실패를
 * 전혀 기억하지 않아서, Turso가 잠깐 느려지거나 멎으면 **모든 요청이 각자**
 * 조회를 시작하고 각자 `FETCH_TIMEOUT_MS`(3000ms)를 기다렸다 — 회원 전원의
 * 모든 요청에 최대 3초가 얹히고, 포기한 요청의 쿼리는 취소되지 않은 채
 * 뒤에 남아 쌓인다(아래 "취소" 문단 참고). 순단 한 번이 그대로 폭주가 된다.
 *
 * 실패를 짧게 기억하면 그 창 동안은 조회를 아예 시도하지 않고 즉시 null
 * (fail-open, 유지보수 꺼짐)을 돌려준다. 성공 TTL(60초)보다 훨씬 짧게 두는
 * 이유는 복구를 늦게 알아채면 안 되기 때문이다.
 *
 * `SETTINGS_CACHE_TTL_MS=0`(E2E)에서는 이 값도 0이 되어 실패 캐시가 꺼진다 —
 * 유지보수 모드를 켜고 끄며 즉시 반영을 검증하는 스펙이 실패 캐시에 걸리면
 * 안 된다.
 */
const SETTINGS_FAILURE_CACHE_MS = Math.min(10 * 1000, SETTINGS_CACHE_DURATION)

/** 실패 캐시가 유효한 시각(ms). 이 시각 전에는 조회를 시도하지 않는다. */
let settingsFailureUntil = 0

/**
 * 같은 isolate에서 이미 날아간 조회가 있으면 그 promise를 **공유**한다.
 *
 * `@libsql/client`(0.17.4)의 `execute()`는 `AbortSignal`을 받지 않고, 취소
 * 수단은 클라이언트 **생성 시점**의 `Config.fetch` 훅뿐이다 — 즉 호출부에서
 * 개별 쿼리를 취소할 방법이 없다(그래서 BASE의 `AbortSignal.timeout(2500)`을
 * 그대로 되돌릴 수 없다). 취소가 불가능하다면 애초에 **여러 개를 시작하지
 * 않는 것**이 유일한 실질적 방어다: 이 공유로 한 isolate가 동시에 들고 있는
 * 설정 조회는 최대 1개가 되고, 실패 캐시가 그 뒤 재시도 간격을 벌린다.
 */
let settingsInFlight: Promise<PublicSystemSettings | null> | null = null

/**
 * `fetchSettings`는 테스트에서 지연 응답을 주입하기 위한 선택 인자다(두 번째
 * 인자, `src/middleware/profile.ts`의 `fetchMemberProfileForMiddleware`와
 * 같은 자리) — 실제 호출부(`middleware.ts`)는 넘기지 않고 기본값
 * (`listSystemSettings(false)`)을 그대로 쓴다.
 *
 * `includeSensitive: false`인 이유: 이 모듈이 읽는
 * `maintenance_mode`/`registration_enabled`는 `is_sensitive = false`라
 * 마스킹 여부가 결과에 영향을 주지 않는다. 반면 `true`로 부르면 캐시 미스마다
 * SMTP 비밀번호 같은 민감 설정의 **평문**이 Edge isolate 메모리로 끌려온다 —
 * 응답에 새지는 않지만 넓힐 이유가 없다(단계 4 리뷰 1회차).
 */
export async function getSystemSettings(
  fetchSettings: () => Promise<SystemSettingRow[]> = () => listSystemSettings(false)
): Promise<PublicSystemSettings | null> {
  if (settingsCache && Date.now() - settingsCache.timestamp < SETTINGS_CACHE_DURATION) {
    return settingsCache
  }

  // 직전 조회가 실패했다면 짧은 창 동안은 재시도하지 않는다(위 상수 설명 참고).
  if (Date.now() < settingsFailureUntil) {
    return null
  }

  // 같은 isolate에서 이미 조회가 날아가 있으면 그것을 공유한다 — 취소가 불가능한
  // 이상 "여러 개를 시작하지 않는 것"이 유일한 실질적 방어다.
  if (settingsInFlight) {
    return settingsInFlight
  }

  const run = fetchPublicSystemSettings(fetchSettings)
  settingsInFlight = run
  try {
    return await run
  } finally {
    settingsInFlight = null
  }
}

async function fetchPublicSystemSettings(
  fetchSettings: () => Promise<SystemSettingRow[]>
): Promise<PublicSystemSettings | null> {
  try {
    // 미들웨어는 요청마다 실행된다 — Turso 응답이 지연되면 타임아웃 없이는
    // 요청 하나가 무기한 대기하다가 Edge 실행 시간 제한에 하드킬(504)당하고,
    // 그 상태가 반복되면 사이트 전체가 죽는다. profile.ts와 같은 보호.
    //
    // 값이 바뀐 것은 의도한 것이다: 옛 Supabase REST 구현은 이 조회에만
    // `AbortSignal.timeout(2500)`을 썼지만, 이제는 미들웨어의 두 Turso 조회
    // (profile.ts의 프로필 조회와 이 설정 조회)가 같은 상수
    // `FETCH_TIMEOUT_MS`(3000ms)를 공유한다 — 같은 런타임·같은 트랜스포트에
    // 서로 다른 두 임계값을 두면 어느 쪽이 먼저 끊는지가 요청마다 달라져
    // 장애 분석이 어려워진다. 500ms 차이는 fail-open 정책상 관측 가능한
    // 동작 차이를 만들지 않는다(둘 다 null → 유지보수 모드 꺼짐).
    const rows = await withTimeout(
      fetchSettings(),
      FETCH_TIMEOUT_MS,
      `getSystemSettings: ${FETCH_TIMEOUT_MS}ms 안에 응답하지 않았다`
    )

    let maintenanceMode = false
    let maintenanceMessage = '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.'
    let registrationEnabled = true

    for (const row of rows) {
      if (row.category !== 'site') continue
      const value = row.setting_value as { enabled?: boolean; message?: string } | null
      if (row.setting_key === 'maintenance_mode') {
        maintenanceMode = value?.enabled === true
        if (value?.message) maintenanceMessage = value.message
      } else if (row.setting_key === 'registration_enabled') {
        registrationEnabled = value?.enabled !== false
      }
    }

    settingsCache = {
      maintenanceMode,
      maintenanceMessage,
      registrationEnabled,
      timestamp: Date.now(),
    }
    // 성공하면 실패 캐시를 즉시 푼다 — 복구를 늦게 알아채면 안 된다.
    settingsFailureUntil = 0
    return settingsCache
  } catch (error) {
    console.error('[middleware/settings] System settings fetch error:', error)
    settingsFailureUntil = Date.now() + SETTINGS_FAILURE_CACHE_MS
    return null
  }
}

// 참고: 과거의 invalidateSettingsCache export는 어떤 코드도 호출하지 않는 dead
// export였고, 설정 변경 API(Node 런타임)가 호출해도 Edge 미들웨어의 isolate
// 메모리에는 전파될 수 없어 제거했다. 전파는 위 TTL(60초)이 담당한다.
