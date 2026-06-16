import dns from 'dns/promises'
import net from 'net'

function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase()
  if (lower.startsWith('[') && lower.endsWith(']')) {
    return lower.slice(1, -1)
  }
  return lower
}

function isPrivateIPv4(ip: string): boolean {
  if (net.isIP(ip) !== 4) return false
  const parts = ip.split('.').map(n => Number.parseInt(n, 10))
  const [a, b] = parts
  if (a === 0) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a >= 224) return true
  return false
}

function isPrivateIPv6(ip: string): boolean {
  if (net.isIP(ip) !== 6) return false
  const lower = ip.toLowerCase()
  return (
    lower === '::1' ||
    lower === '::' ||
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
    const normalized = normalizeHostname(hostname)
    const blockedHostnames = new Set(['localhost'])
    if (blockedHostnames.has(normalized)) return true

    const literalIpVersion = net.isIP(normalized)
    if (literalIpVersion === 4) return isPrivateIPv4(normalized)
    if (literalIpVersion === 6) return isPrivateIPv6(normalized)

    const records = await dns.lookup(normalized, { all: true })
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
