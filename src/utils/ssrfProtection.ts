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

/**
 * IPv6 리터럴을 16바이트로 펼친다. 문자열 접두사(`startsWith('fd')` 등)로
 * 판정하면 같은 주소의 다른 표기를 모두 놓친다 — `::1`은 막히지만
 * `0:0:0:0:0:0:0:1`은 통과하고, `::ffff:127.0.0.1`은 `fe`·`fc`로 시작하지
 * 않으니 loopback인데도 통과했다. 표기를 없애고 바이트로만 판정한다.
 * 파싱할 수 없으면 null — 호출자가 보수적으로 차단한다.
 */
function parseIPv6Bytes(ip: string): number[] | null {
  if (net.isIP(ip) !== 6) return null

  let text = ip.toLowerCase()

  // 끝에 붙은 점 표기(IPv4-mapped/compatible)를 헥스텟 두 칸으로 바꿔 통일한다.
  const lastColon = text.lastIndexOf(':')
  if (lastColon === -1) return null
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    if (net.isIP(tail) !== 4) return null
    const quad = tail.split('.').map(n => Number.parseInt(n, 10))
    if (quad.length !== 4 || quad.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hi = ((quad[0] << 8) | quad[1]).toString(16)
    const lo = ((quad[2] << 8) | quad[3]).toString(16)
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`
  }

  const halves = text.split('::')
  if (halves.length > 2) return null

  const head = halves[0] ? halves[0].split(':') : []
  const rear = halves.length === 2 && halves[1] ? halves[1].split(':') : []

  let groups: string[]
  if (halves.length === 1) {
    if (head.length !== 8) return null
    groups = head
  } else {
    const fill = 8 - head.length - rear.length
    if (fill < 0) return null
    groups = [...head, ...new Array(fill).fill('0'), ...rear]
  }

  const bytes: number[] = []
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null
    const value = Number.parseInt(group, 16)
    bytes.push((value >> 8) & 0xff, value & 0xff)
  }
  if (bytes.length !== 16) return null
  return bytes
}

/**
 * IPv4 주소를 품고 있는 IPv6 표기라면 그 점 표기 IPv4를 돌려준다.
 * - `::ffff:a.b.c.d` (IPv4-mapped, RFC 4291)
 * - `::a.b.c.d` / `::1` / `::` (IPv4-compatible 및 loopback·unspecified)
 * - `::ffff:0:a.b.c.d` (SIIT, RFC 2765)
 * - `64:ff9b::a.b.c.d` (NAT64, RFC 6052)
 */
function embeddedIPv4(bytes: number[]): string | null {
  const dotted = () => `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`
  const zeros = (from: number, to: number) => bytes.slice(from, to).every(b => b === 0)

  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return dotted()
  if (zeros(0, 12)) return dotted()
  if (zeros(0, 8) && bytes[8] === 0xff && bytes[9] === 0xff && zeros(10, 12)) return dotted()
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeros(4, 12)
  ) {
    return dotted()
  }

  return null
}

function isPrivateIPv6(ip: string): boolean {
  if (net.isIP(ip) !== 6) return false

  const bytes = parseIPv6Bytes(ip)
  if (!bytes) return true

  // IPv4를 품은 표기는 품고 있는 IPv4 규칙으로 판정한다.
  // `::ffff:8.8.8.8`처럼 공개 주소를 가리키는 형태는 그대로 통과해야 한다.
  const mapped = embeddedIPv4(bytes)
  if (mapped !== null) return isPrivateIPv4(mapped)

  // fc00::/7 unique-local
  if ((bytes[0] & 0xfe) === 0xfc) return true
  // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true
  // fec0::/10 site-local (deprecated)
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true
  // ff00::/8 multicast
  if (bytes[0] === 0xff) return true

  return false
}

function isPrivateIpLiteral(ip: string): boolean {
  const version = net.isIP(ip)
  if (version === 4) return isPrivateIPv4(ip)
  if (version === 6) return isPrivateIPv6(ip)
  return true
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
      if (isPrivateIpLiteral(rec.address)) return true
    }
    return false
  } catch {
    // DNS resolution failure → block conservatively
    return true
  }
}
