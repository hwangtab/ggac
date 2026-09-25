import dns from 'dns/promises'
import http from 'http'
import https from 'https'
import net from 'net'
import type { LookupFunction } from 'net'
import zlib from 'zlib'

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

// ---------------------------------------------------------------------------
// 검사한 IP로만 접속한다 (DNS 리바인딩 차단)
// ---------------------------------------------------------------------------

/**
 * `isUnsafeHost(host)`로 통과시킨 뒤 `fetch(url)`을 부르면, 이름을 **두 번**
 * 푸는 것이 된다. 그 사이는 공격자가 고르는 간격이다 — 자기 도메인의 TTL을 0으로
 * 두고 첫 조회에는 공개 IP를, 두 번째 조회에는 169.254.169.254를 주면 검사는
 * 통과하고 접속은 내부로 간다. 검사와 접속이 같은 주소를 본다는 보장이 없으면
 * 검사는 장식이다.
 *
 * 그래서 이름을 **한 번만** 풀고, 그 결과를 검사한 뒤, 그 IP로 못을 박아
 * 접속한다. 못은 `http.request`/`https.request`의 `lookup` 옵션이다 — 소켓이
 * 이름을 다시 풀지 않고 넘겨받은 주소로만 연결한다. `host`에는 원래 이름을
 * 그대로 넘기므로 Host 헤더·SNI·인증서 검증은 도메인 기준으로 유지된다.
 *
 * (전역 `fetch`로는 이 못을 박을 수 없다. 접속 주소를 지정하는 창구가
 * undici 디스패처뿐인데 undici는 이 저장소의 직접 의존성이 아니고, URL의
 * 호스트를 IP로 바꿔치우는 방식은 https 인증서 검증을 깨뜨린다.)
 */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

/** 상한을 넘는 본문을 받았을 때. 부분 버퍼는 버리고 연결을 끊는다. */
export class ResponseTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResponseTooLargeError'
  }
}

export type PinnedRequestInit = {
  method?: string
  headers?: Record<string, string>
  /** 연결부터 본문 수신 완료까지의 총 시간 상한. 기본 10초. */
  timeoutMs?: number
  /** 본문 누적 상한. 읽는 중에 넘으면 즉시 끊는다. 기본 2MB. */
  maxBytes?: number
  /**
   * 리다이렉트는 **어떤 값을 주든** 따라가지 않는다(호출부가 Location을 직접
   * 검사해야 한다). 호출부의 의도를 코드에 남기려고 받아만 둔다.
   */
  redirect?: 'manual'
  /**
   * 헤더만 보고 본문을 받을지 정한다. `false`를 돌려주면 연결을 끊고 본문이
   * 빈 `Response`를 돌려준다 — 호출부는 평소처럼 status·헤더로 판정하면 된다.
   */
  acceptResponse?: (status: number, headers: Headers) => boolean
}

const PINNED_ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 2_000_000

/** 본문이 없어야 하는 상태 코드 — Response 생성자가 본문을 거부한다. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

type PinnedAddress = { address: string; family: 4 | 6 }

/**
 * 이름을 한 번 풀고 안전한 주소 하나를 고른다. 레코드가 하나라도 사설이면
 * 전부 거부한다 — `isUnsafeHost`가 쓰던 판정과 같은 보수적 계약이다.
 */
async function resolvePinnedAddress(hostname: string): Promise<PinnedAddress | null> {
  const normalized = normalizeHostname(hostname)
  if (normalized === 'localhost') return null

  const literal = net.isIP(normalized)
  if (literal === 4) return isPrivateIPv4(normalized) ? null : { address: normalized, family: 4 }
  if (literal === 6) return isPrivateIPv6(normalized) ? null : { address: normalized, family: 6 }

  let records: { address: string; family: number }[]
  try {
    records = await dns.lookup(normalized, { all: true })
  } catch {
    return null
  }
  if (!records || records.length === 0) return null
  for (const rec of records) {
    if (isPrivateIpLiteral(rec.address)) return null
  }

  const chosen = records[0]
  return { address: chosen.address, family: chosen.family === 6 ? 6 : 4 }
}

function createPinnedLookup(pinned: PinnedAddress): LookupFunction {
  return ((
    _hostname: string,
    options: unknown,
    callback?: (err: NodeJS.ErrnoException | null, ...args: unknown[]) => void
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      ...args: unknown[]
    ) => void
    const wantsAll =
      typeof options === 'object' && options !== null && (options as { all?: boolean }).all === true
    if (wantsAll) {
      cb(null, [{ address: pinned.address, family: pinned.family }])
      return
    }
    cb(null, pinned.address, pinned.family)
  }) as unknown as LookupFunction
}

/** 본문을 풀어야 하면 여기서 푼다. 상한을 넘겨 부풀리는 폭탄은 zlib이 끊는다. */
function decodeBody(buffer: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const codec = (encoding || '').trim().toLowerCase()
  if (!codec || codec === 'identity') return buffer
  if (codec === 'gzip' || codec === 'x-gzip') {
    return zlib.gunzipSync(buffer, { maxOutputLength: maxBytes })
  }
  if (codec === 'deflate') return zlib.inflateSync(buffer, { maxOutputLength: maxBytes })
  if (codec === 'br') return zlib.brotliDecompressSync(buffer, { maxOutputLength: maxBytes })
  throw new Error(`Unsupported content-encoding: ${codec}`)
}

/**
 * 검사가 끝난 IP로만 접속해서 응답을 통째로 받아 표준 `Response`로 돌려준다.
 *
 * - 리다이렉트는 따라가지 않는다(3xx가 그대로 온다).
 * - 본문은 `maxBytes`를 넘는 순간 끊는다 — 다 받고 나서 재지 않는다.
 * - 이름이 사설 주소로 풀리면 `SsrfBlockedError`.
 */
export async function fetchPinned(url: string, init: PinnedRequestInit = {}): Promise<Response> {
  const target = new URL(url)
  if (!PINNED_ALLOWED_PROTOCOLS.has(target.protocol)) {
    throw new SsrfBlockedError(`Protocol not allowed: ${target.protocol}`)
  }

  const pinned = await resolvePinnedAddress(target.hostname)
  if (!pinned) {
    throw new SsrfBlockedError('Host resolves to a private or unresolvable address')
  }

  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES
  const transport = target.protocol === 'https:' ? https : http

  // 응답 본문을 스스로 풀어야 하므로 압축을 요구하지 않는다(그래도 압축해
  // 보내는 상대는 decodeBody가 푼다).
  const headers: Record<string, string> = {
    'Accept-Encoding': 'identity',
    ...(init.headers || {}),
  }

  return new Promise<Response>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      fn()
    }

    const request = transport.request(
      {
        protocol: target.protocol,
        // 이름은 그대로 — Host 헤더·SNI·인증서 검증이 도메인 기준으로 남는다.
        host: normalizeHostname(target.hostname),
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: init.method || 'GET',
        headers,
        // 접속 주소는 위에서 검사한 IP 하나로 고정한다.
        lookup: createPinnedLookup(pinned),
        family: pinned.family,
      },
      response => {
        const status = response.statusCode ?? 502
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (value === undefined) continue
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(key, item)
          } else {
            responseHeaders.append(key, String(value))
          }
        }

        // 본문을 받을 가치가 없는 응답(리다이렉트·엉뚱한 content-type)은 헤더만
        // 보고 여기서 끊는다. 상한이 8MB라도, 거절할 응답을 8MB까지 받아 주면
        // 그 자체가 대역폭 증폭기가 된다.
        if (init.acceptResponse && !init.acceptResponse(status, responseHeaders)) {
          response.destroy()
          request.destroy()
          finish(() => resolve(new Response(null, { status, headers: responseHeaders })))
          return
        }

        const chunks: Buffer[] = []
        let total = 0

        response.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > maxBytes) {
            response.destroy()
            request.destroy()
            finish(() => reject(new ResponseTooLargeError('Response body exceeded the size limit')))
            return
          }
          chunks.push(chunk)
        })

        response.on('end', () => {
          finish(() => {
            try {
              const raw = Buffer.concat(chunks)
              const body =
                NULL_BODY_STATUSES.has(status) || init.method === 'HEAD'
                  ? null
                  : decodeBody(
                      raw,
                      response.headers['content-encoding'] as string | undefined,
                      maxBytes
                    )

              // 본문을 풀었으면 길이·인코딩 헤더는 더 이상 본문을 설명하지 않는다.
              if (body && responseHeaders.get('content-encoding')) {
                responseHeaders.delete('content-encoding')
                responseHeaders.set('content-length', String(body.length))
              }

              // Buffer(=Uint8Array<ArrayBufferLike>)는 BodyInit 타입에 그대로
              // 들어가지 않는다. ArrayBuffer를 등에 업은 뷰로 옮겨 넘긴다.
              const bodyInit = body ? Uint8Array.from(body) : null
              resolve(new Response(bodyInit, { status, headers: responseHeaders }))
            } catch (error) {
              reject(error)
            }
          })
        })

        response.on('error', error => finish(() => reject(error)))
      }
    )

    const deadline = setTimeout(() => {
      request.destroy(new Error('Pinned request timed out'))
    }, timeoutMs)

    request.on('error', error => finish(() => reject(error)))
    request.end()
  })
}
