/**
 * System Settings Middleware Logic
 * 시스템 설정 조회 및 캐싱을 담당합니다.
 *
 * 주의: 이 모듈은 일반 사용자에게도 적용되어야 하는 site 설정
 * (maintenance_mode, registration_enabled)을 service role client로 직접 조회한다.
 * 기존 get_system_settings RPC는 SECURITY DEFINER 내부에서 admin 체크를 하므로
 * 일반 사용자가 호출하면 항상 예외를 던져 유지보수 모드가 무력화되는 문제가 있었다.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

interface PublicSystemSettings {
  maintenanceMode: boolean
  maintenanceMessage?: string
  registrationEnabled: boolean
  timestamp: number
}

let settingsCache: PublicSystemSettings | null = null
const SETTINGS_CACHE_DURATION = 5 * 60 * 1000 // 5분

let serviceRoleClient: SupabaseClient | null = null

function getServiceRoleClient(): SupabaseClient | null {
  if (serviceRoleClient) return serviceRoleClient

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null

  serviceRoleClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return serviceRoleClient
}

export async function getSystemSettings(_supabase?: unknown): Promise<PublicSystemSettings | null> {
  // _supabase 인자는 하위 호환성을 위해 유지하되 사용하지 않는다.
  // 일반 사용자도 settings를 읽어야 하므로 service role client를 사용한다.
  void _supabase

  if (settingsCache && Date.now() - settingsCache.timestamp < SETTINGS_CACHE_DURATION) {
    return settingsCache
  }

  const admin = getServiceRoleClient()
  if (!admin) {
    // service role 미설정 시 안전하게 통과(개발 환경 등)
    return null
  }

  try {
    const { data, error } = await admin
      .from('system_settings')
      .select('category, setting_key, setting_value')
      .eq('category', 'site')
      .in('setting_key', ['maintenance_mode', 'registration_enabled'])

    if (error) {
      console.error('[middleware/settings] Failed to fetch system settings:', error.message)
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

/**
 * 캐시 무효화 (관리자가 설정 변경 시 호출)
 */
export function invalidateSettingsCache() {
  settingsCache = null
}
