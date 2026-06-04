import type { NextRequest } from 'next/server'

type SupabaseUser = {
  id: string
  [key: string]: unknown
}

type SupabaseRestError = {
  message?: string
  error_description?: string
  [key: string]: unknown
}

type QueryBuilderState = {
  table: string
  select?: string
  filters: string[]
  single: boolean
}

const SUPABASE_COOKIE_PATTERN = /^sb-.+-auth-token(?:\.\d+)?$/

function decodeBase64(value: string): string {
  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(value)
  }

  throw new Error('Base64 decoding is unavailable in this runtime')
}

function parseAuthCookie(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value)
    const jsonText = decoded.startsWith('base64-') ? decodeBase64(decoded.slice(7)) : decoded
    const parsed = JSON.parse(jsonText)

    if (Array.isArray(parsed)) {
      return typeof parsed[0] === 'string' ? parsed[0] : null
    }

    if (parsed && typeof parsed === 'object' && typeof parsed.access_token === 'string') {
      return parsed.access_token
    }
  } catch {
    return null
  }

  return null
}

export function getSupabaseAccessToken(request: NextRequest): string | null {
  const authCookies = request.cookies
    .getAll()
    .filter(cookie => SUPABASE_COOKIE_PATTERN.test(cookie.name))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (authCookies.length === 0) {
    return null
  }

  const chunkedValue = authCookies.map(cookie => cookie.value).join('')
  return parseAuthCookie(chunkedValue)
}

export function createMiddlewareSupabaseClient(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const accessToken = getSupabaseAccessToken(request)

  const requestJson = async <T>(
    endpoint: string,
    token: string,
    init?: RequestInit
  ): Promise<{ data: T | null; error: SupabaseRestError | null }> => {
    if (!url || !anonKey) {
      return { data: null, error: { message: 'Supabase configuration missing' } }
    }

    try {
      const response = await fetch(`${url}${endpoint}`, {
        ...init,
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      })

      if (!response.ok) {
        const error = (await response.json().catch(() => ({
          message: response.statusText,
        }))) as SupabaseRestError
        return { data: null, error }
      }

      return { data: (await response.json()) as T, error: null }
    } catch (error) {
      return { data: null, error: error as SupabaseRestError }
    }
  }

  const runQuery = async <T>(state: QueryBuilderState) => {
    if (!accessToken) {
      return { data: null, error: { message: 'Missing Supabase access token' } }
    }

    const params = new URLSearchParams()
    if (state.select) params.set('select', state.select)
    for (const filter of state.filters) {
      const [key, value] = filter.split('=')
      params.append(key, value)
    }

    const endpoint = `/rest/v1/${state.table}?${params.toString()}`
    const headers: Record<string, string> = {}
    if (state.single) {
      headers.Accept = 'application/vnd.pgrst.object+json'
    }

    return requestJson<T>(endpoint, accessToken, { headers })
  }

  return {
    auth: {
      async getUser() {
        if (!accessToken) {
          return {
            data: { user: null },
            error: { message: 'Missing Supabase access token' },
          }
        }

        const { data, error } = await requestJson<SupabaseUser>('/auth/v1/user', accessToken)
        return { data: { user: data }, error }
      },
    },
    from(table: string) {
      const state: QueryBuilderState = { table, filters: [], single: false }
      const builder = {
        select(columns: string) {
          state.select = columns
          return builder
        },
        eq(column: string, value: string) {
          state.filters.push(`${column}=eq.${encodeURIComponent(value)}`)
          return builder
        },
        single<T = unknown>() {
          state.single = true
          return runQuery<T>(state)
        },
      }

      return builder
    },
  }
}

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
