export type EnvGroupStatus = 'present' | 'missing' | 'partial'

export interface EnvGroupResolution {
  status: EnvGroupStatus
  values: Record<string, string>
  group?: readonly string[]
  missing?: readonly string[]
}

export const REDIS_RATE_LIMIT_ENV_GROUPS = [
  ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
] as const

function readNonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

export function resolveFirstCompleteEnvGroup(
  groups: readonly (readonly string[])[]
): EnvGroupResolution {
  let firstPartial: EnvGroupResolution | null = null

  for (const group of groups) {
    const values: Record<string, string> = {}
    const missing: string[] = []

    for (const name of group) {
      const value = readNonEmptyEnv(name)
      if (value) {
        values[name] = value
      } else {
        missing.push(name)
      }
    }

    if (missing.length === 0) {
      return { status: 'present', values, group }
    }

    if (Object.keys(values).length > 0 && !firstPartial) {
      firstPartial = { status: 'partial', values, group, missing }
    }
  }

  return firstPartial ?? { status: 'missing', values: {} }
}

export function requireServerEnv(name: string): string {
  const value = readNonEmptyEnv(name)

  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}

export function getRedisRateLimitEnv(): {
  status: EnvGroupStatus
  url?: string
  token?: string
  group?: readonly string[]
  missing?: readonly string[]
} {
  const result = resolveFirstCompleteEnvGroup(REDIS_RATE_LIMIT_ENV_GROUPS)

  if (result.status !== 'present' || !result.group) {
    return {
      status: result.status,
      group: result.group,
      missing: result.missing,
    }
  }

  const [urlName, tokenName] = result.group

  return {
    status: 'present',
    url: result.values[urlName],
    token: result.values[tokenName],
    group: result.group,
  }
}
