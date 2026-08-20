/**
 * System Settings Middleware Logic
 * 시스템 설정 조회 및 캐싱을 담당합니다.
 *
 * 주의: 이 모듈은 일반 사용자에게도 적용되어야 하는 site 설정
 * (maintenance_mode, registration_enabled)을 service role client로 직접 조회한다.
 * 기존 get_system_settings RPC는 SECURITY DEFINER 내부에서 admin 체크를 하므로
 * 일반 사용자가 호출하면 항상 예외를 던져 유지보수 모드가 무력화되는 문제가 있었다.
 */

import { fetchSystemSettingsRows } from './supabase-rest'

interface PublicSystemSettings {
  maintenanceMode: boolean
  maintenanceMessage?: string
  registrationEnabled: boolean
  timestamp: number
}

// 캐시는 Edge isolate 단위라 인스턴스 간 전파가 없다. 관리자가 유지보수 모드를
// 토글했을 때 최대 이 시간만큼 반영이 늦을 수 있으므로 짧게 유지한다
// (조회는 2.5s 타임아웃의 경량 REST 1회 — 60초당 1회면 부담 없음).
// 조회 실패 시에는 null을 반환해 유지보수 모드가 꺼진 것처럼 동작한다(fail-open).
// 이는 의도된 정책이다: settings 장애가 사이트 전체 차단(fail-closed)으로
// 번지는 것보다 유지보수 안내가 늦는 쪽이 낫다.
let settingsCache: PublicSystemSettings | null = null

// 기본 60초. 테스트 환경에서만 0으로 낮춰 설정 변경이 즉시 반영되게 한다
// (E2E는 유지보수 모드를 켜고 끄며 미들웨어의 반응을 검증한다).
// 운영에서는 절대 설정하지 않는다 — 요청마다 system_settings를 읽게 된다.
const SETTINGS_CACHE_DURATION = (() => {
  const raw = Number(process.env.SETTINGS_CACHE_TTL_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 60 * 1000
})()

export async function getSystemSettings(_supabase?: unknown): Promise<PublicSystemSettings | null> {
  // _supabase 인자는 하위 호환성을 위해 유지하되 사용하지 않는다.
  // 일반 사용자도 settings를 읽어야 하므로 service role client를 사용한다.
  void _supabase

  if (settingsCache && Date.now() - settingsCache.timestamp < SETTINGS_CACHE_DURATION) {
    return settingsCache
  }

  try {
    const { data, error } = await fetchSystemSettingsRows()

    if (error) {
      console.error(
        '[middleware/settings] Failed to fetch system settings:',
        (error as { message?: string }).message
      )
      return null
    }

    let maintenanceMode = false
    let maintenanceMessage = '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.'
    let registrationEnabled = true

    for (const row of data || []) {
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
