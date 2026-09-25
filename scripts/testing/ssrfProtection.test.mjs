import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * SSRF 호스트 필터 회귀 방어.
 *
 * `isUnsafeHost`는 이미지 프록시(`/api/images/proxy`)와 링크 프리뷰가 공유하는
 * 유일한 경계다. IPv4 사설 범위는 막고 있었지만 **같은 주소의 IPv6 표기**는
 * 문자열 접두사(`startsWith('fd')` 등)로만 걸렀기 때문에 IPv4-mapped 형태가
 * 그대로 통과했다. `http://[::ffff:127.0.0.1]/`은 WHATWG URL이
 * `[::ffff:7f00:1]`로 정규화해 넘기고, OS는 이를 127.0.0.1로 접속한다.
 *
 * 리터럴 IP는 DNS 조회 전에 판정되므로 이 테스트는 네트워크를 타지 않는다.
 */
const { isUnsafeHost, fetchPinned, SsrfBlockedError } = await import(
  '../../src/utils/ssrfProtection.ts'
)

// -------------------------------------------------------------------------
// IPv4-mapped IPv6 — 이 구멍으로 메타데이터 서비스까지 닿았다
// -------------------------------------------------------------------------

const MAPPED_PRIVATE = [
  '::ffff:127.0.0.1',
  '::ffff:10.0.0.1',
  '::ffff:169.254.169.254',
  '::ffff:192.168.0.1',
  '::ffff:172.16.0.1',
  '::ffff:0.0.0.0',
  // 대괄호가 붙은 채로 들어오는 경로(URL.hostname)
  '[::ffff:127.0.0.1]',
  '[::ffff:169.254.169.254]',
  // 헥스 대문자
  '::FFFF:127.0.0.1',
  '::FFFF:169.254.169.254',
  // WHATWG URL이 실제로 넘기는 정규화 형태 — 점 표기가 남지 않는다
  '::ffff:7f00:1',
  '[::ffff:7f00:1]',
  '[::ffff:a9fe:a9fe]',
  '[::ffff:a00:1]',
  // 압축하지 않은 전체 표기
  '0:0:0:0:0:ffff:7f00:1',
  '0:0:0:0:0:FFFF:169.254.169.254',
  // SIIT(::ffff:0:a.b.c.d) · NAT64(64:ff9b::a.b.c.d)
  '::ffff:0:127.0.0.1',
  '64:ff9b::169.254.169.254',
  // IPv4-compatible(deprecated)
  '::127.0.0.1',
  '::10.0.0.1',
]

for (const host of MAPPED_PRIVATE) {
  test(`isUnsafeHost: IPv4-mapped/embedded 사설 주소를 차단한다 — ${host}`, async () => {
    assert.equal(await isUnsafeHost(host), true)
  })
}

// -------------------------------------------------------------------------
// 순수 IPv6 사설·예약 범위
// -------------------------------------------------------------------------

const PRIVATE_IPV6 = [
  '::1', // loopback
  '[::1]',
  '0:0:0:0:0:0:0:1', // 압축하지 않은 loopback — 접두사 판정으로는 새던 형태
  '::', // unspecified
  '0:0:0:0:0:0:0:0',
  'fd00::1', // fc00::/7 unique-local
  'fc00::1',
  'FD12:3456:789A::1',
  'fe80::1', // fe80::/10 link-local
  'fe80::200:5aee:feaa:20a2',
  'febf::1',
  'fec0::1', // fec0::/10 site-local(deprecated)
  'ff02::1', // ff00::/8 multicast
]

for (const host of PRIVATE_IPV6) {
  test(`isUnsafeHost: IPv6 사설·예약 범위를 차단한다 — ${host}`, async () => {
    assert.equal(await isUnsafeHost(host), true)
  })
}

// -------------------------------------------------------------------------
// IPv4 리터럴 (기존 보장 유지)
// -------------------------------------------------------------------------

const PRIVATE_IPV4 = [
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '192.168.1.1',
  '172.16.0.1',
  '0.0.0.0',
  '224.0.0.1',
  'localhost',
]

for (const host of PRIVATE_IPV4) {
  test(`isUnsafeHost: IPv4 사설·예약 범위를 차단한다 — ${host}`, async () => {
    assert.equal(await isUnsafeHost(host), true)
  })
}

// -------------------------------------------------------------------------
// 과차단 확인 — 공개 주소는 표기가 무엇이든 통과해야 한다
// -------------------------------------------------------------------------

const PUBLIC_HOSTS = [
  '8.8.8.8',
  '1.1.1.1',
  '172.15.0.1', // 172.16/12 바로 앞
  '172.32.0.1', // 172.16/12 바로 뒤
  '192.169.0.1', // 192.168/16 바로 뒤
  '::ffff:8.8.8.8', // mapped 형태지만 8.8.8.8은 공개 주소다
  '[::ffff:8.8.8.8]',
  '::ffff:808:808', // 같은 주소의 WHATWG 정규화 형태
  '::ffff:1.1.1.1',
  '2001:4860:4860::8888',
  '[2606:4700:4700::1111]',
]

for (const host of PUBLIC_HOSTS) {
  test(`isUnsafeHost: 공개 주소를 과차단하지 않는다 — ${host}`, async () => {
    assert.equal(await isUnsafeHost(host), false)
  })
}

// -------------------------------------------------------------------------
// 판정 불가 입력은 보수적으로 차단한다
// -------------------------------------------------------------------------

test('isUnsafeHost: 해석할 수 없는 호스트는 차단한다', async () => {
  assert.equal(await isUnsafeHost('not a host at all'), true)
  assert.equal(await isUnsafeHost(''), true)
})

// -------------------------------------------------------------------------
// fetchPinned — 검사와 접속이 같은 주소를 본다
// -------------------------------------------------------------------------
//
// `isUnsafeHost`로 통과시킨 뒤 따로 `fetch`를 부르면 이름을 두 번 푸는 것이
// 되고, 그 사이는 공격자가 고르는 간격이다(DNS 리바인딩). `fetchPinned`는
// 이름을 한 번 풀어 검사한 IP로만 접속한다 — 여기서는 그 앞단, 즉 "막아야 할
// 주소에는 **연결 자체가 일어나지 않는다**"를 서버 쪽에서 확인한다.

import http from 'node:http'

async function withLocalServer(run) {
  let connections = 0
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<title>should never be reached</title>')
  })
  server.on('connection', () => {
    connections += 1
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    return await run(server.address().port, () => connections)
  } finally {
    server.close()
  }
}

test('fetchPinned: 루프백으로 풀리는 이름은 연결조차 하지 않는다', async () => {
  await withLocalServer(async (port, connections) => {
    await assert.rejects(
      () => fetchPinned(`http://localhost:${port}/`, { timeoutMs: 2000 }),
      error => error instanceof SsrfBlockedError
    )
    await assert.rejects(
      () => fetchPinned(`http://127.0.0.1:${port}/`, { timeoutMs: 2000 }),
      error => error instanceof SsrfBlockedError
    )
    assert.equal(connections(), 0)
  })
})

test('fetchPinned: 사설·링크로컬 리터럴을 거부한다', async () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
  ]) {
    await assert.rejects(
      () => fetchPinned(url, { timeoutMs: 2000 }),
      error => error instanceof SsrfBlockedError,
      url
    )
  }
})

test('fetchPinned: http·https가 아닌 프로토콜을 거부한다', async () => {
  for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'gopher://example.com/']) {
    await assert.rejects(
      () => fetchPinned(url, { timeoutMs: 2000 }),
      error => error instanceof SsrfBlockedError,
      url
    )
  }
})
