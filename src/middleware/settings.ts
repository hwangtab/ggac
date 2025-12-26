/**
 * System Settings Middleware Logic
 * 시스템 설정 조회 및 캐싱을 담당합니다.
 */

// 시스템 설정 캐시 (5분 캐시)
let settingsCache: {
  maintenanceMode: boolean
  maintenanceMessage?: string
  registrationEnabled: boolean
  timestamp: number
} | null = null

const SETTINGS_CACHE_DURATION = 5 * 60 * 1000 // 5분

export async function getSystemSettings(supabase: any) {
  // 캐시 확인
  if (settingsCache && Date.now() - settingsCache.timestamp < SETTINGS_CACHE_DURATION) {
    return settingsCache
  }

  try {
    const { data, error } = await supabase.rpc('get_system_settings', { include_sensitive: false })

    if (error) {
      console.error('Failed to fetch system settings:', error)
      return null
    }

    let maintenanceMode = false
    let maintenanceMessage = '시스템 점검 중입니다. 잠시 후 다시 이용해 주세요.'
    let registrationEnabled = true

    // 설정 파싱
    for (const setting of data || []) {
      if (setting.category === 'site' && setting.setting_key === 'maintenance_mode') {
        maintenanceMode = setting.setting_value?.enabled || false
        maintenanceMessage = setting.setting_value?.message || maintenanceMessage
      } else if (setting.category === 'site' && setting.setting_key === 'registration_enabled') {
        registrationEnabled = setting.setting_value?.enabled !== false
      }
    }

    // 캐시 업데이트
    settingsCache = {
      maintenanceMode,
      maintenanceMessage,
      registrationEnabled,
      timestamp: Date.now(),
    }

    return settingsCache
  } catch (error) {
    console.error('System settings fetch error in middleware:', error)
    return null
  }
}
