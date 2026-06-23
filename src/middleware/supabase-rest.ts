/**
 * site 설정(maintenance_mode, registration_enabled)을 service role 키로 직접 조회한다.
 * 일반 사용자에게도 적용되어야 하는 설정이므로 RPC(SECURITY DEFINER) 대신 REST로 읽는다.
 * 세션 인증은 미들웨어의 표준 @supabase/ssr createServerClient가 담당하므로
 * 이 모듈은 더 이상 인증 클라이언트를 제공하지 않는다.
 */
export async function fetchSystemSettingsRows() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return { data: null, error: null }
  }

  try {
    const params = new URLSearchParams({
      select: 'category,setting_key,setting_value',
      category: 'eq.site',
      setting_key: 'in.(maintenance_mode,registration_enabled)',
    })
    const response = await fetch(`${url}/rest/v1/system_settings?${params.toString()}`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }))
      return { data: null, error }
    }

    return { data: await response.json(), error: null }
  } catch (error) {
    return { data: null, error }
  }
}
