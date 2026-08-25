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
 * 이전에는 이 디렉터리의 다른 파일이 노출하던 Supabase REST 헬퍼로
 * service-role 키를 써서 `system_settings`을 직접 읽었다(그 파일은 이제
 * 아무도 참조하지 않는다 — 8절/보고서 참고, 삭제는 Task 5 몫). 일반
 * 사용자도 유지보수 모드를 확인해야
 * 하는데 `get_system_settings` RPC는 SECURITY DEFINER 내부에서 admin 체크를
 * 해 일반 사용자가 호출하면 항상 실패했기 때문이다. `listSystemSettings`는
 * 권한을 모르는 순수 쿼리 계층이라 애초에 그 문제가 없다.
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
 * `fetchSettings`는 테스트에서 지연 응답을 주입하기 위한 선택 인자다(두 번째
 * 인자, `src/middleware/profile.ts`의 `fetchMemberProfileForMiddleware`와
 * 같은 자리) — 실제 호출부(`middleware.ts`)는 넘기지 않고 기본값
 * (`listSystemSettings(true)`)을 그대로 쓴다. `includeSensitive: true`로
 * 부르는 이유: `maintenance_mode`/`registration_enabled`는 `is_sensitive`가
 * never true인 설정이라 마스킹 여부가 결과에 영향을 주지 않지만, 이전
 * Supabase REST 구현도 service-role 키로 마스킹 없이 원값을 읽었으므로 그
 * 동작을 그대로 맞춘다.
 */
export async function getSystemSettings(
  _supabase?: unknown,
  fetchSettings: () => Promise<SystemSettingRow[]> = () => listSystemSettings(true)
): Promise<PublicSystemSettings | null> {
  // _supabase 인자는 하위 호환성을 위해 유지하되 사용하지 않는다.
  void _supabase

  if (settingsCache && Date.now() - settingsCache.timestamp < SETTINGS_CACHE_DURATION) {
    return settingsCache
  }

  try {
    // 미들웨어는 요청마다 실행된다 — Turso 응답이 지연되면 타임아웃 없이는
    // 요청 하나가 무기한 대기하다가 Edge 실행 시간 제한에 하드킬(504)당하고,
    // 그 상태가 반복되면 사이트 전체가 죽는다. profile.ts와 같은 보호.
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
    return settingsCache
  } catch (error) {
    console.error('[middleware/settings] System settings fetch error:', error)
    return null
  }
}

// 참고: 과거의 invalidateSettingsCache export는 어떤 코드도 호출하지 않는 dead
// export였고, 설정 변경 API(Node 런타임)가 호출해도 Edge 미들웨어의 isolate
// 메모리에는 전파될 수 없어 제거했다. 전파는 위 TTL(60초)이 담당한다.
