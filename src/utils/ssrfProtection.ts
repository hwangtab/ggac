import dns from 'dns/promises'

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(n => parseInt(n, 10))
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  return (
    lower === '::1' ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('fc') ||
    lower.startsWith('fd')
  )
}

/**
 * Checks if a hostname resolves to a private/internal IP address.
 * Returns true if the host is unsafe (should be blocked), false if safe.
 */
export async function isUnsafeHost(hostname: string): Promise<boolean> {
  try {
    const blockedHostnames = new Set(['localhost', '0.0.0.0'])
    if (blockedHostnames.has(hostname.toLowerCase())) return true

    const records = await dns.lookup(hostname, { all: true })
    if (!records || records.length === 0) return true
    for (const rec of records) {
      const ip = rec.address
      if (ip.includes(':')) {
        if (isPrivateIPv6(ip)) return true
      } else {
        if (isPrivateIPv4(ip)) return true
      }
    }
    return false
  } catch {
    // DNS resolution failure → block conservatively
    return true
  }
}
