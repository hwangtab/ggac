import { expect, test } from '@playwright/test'

test.describe('Public API regression checks', () => {
  test('malformed reporting API payloads return 400 instead of 500', async ({ request }) => {
    const cspReport = await request.post('/api/security/csp-report')
    expect(cspReport.status()).toBe(400)
    expect(cspReport.headers()['content-type']).toMatch(/application\/json/)

    const clientError = await request.post('/api/client-error')
    expect(clientError.status()).toBe(400)
    expect(clientError.headers()['content-type']).toMatch(/application\/json/)
  })

  test('client error reporting still accepts valid payloads', async ({ request }) => {
    const response = await request.post('/api/client-error', {
      data: {
        message: 'playwright regression check',
        timestamp: new Date('2026-06-04T00:00:00.000Z').toISOString(),
        url: 'https://ggac.kr/reset-password?token=secret-token#fragment',
      },
    })

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/application\/json/)
    await expect(response).toBeOK()
  })

  test('event application photo upload rejects unsafe slug and spoofed image bodies', async ({
    request,
  }) => {
    const unsafeSlug = await request.post('/api/event-applications/photo?event_slug=../admin', {
      multipart: {
        file: {
          name: 'photo.png',
          mimeType: 'image/png',
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        },
      },
    })
    expect(unsafeSlug.status()).toBe(400)

    const spoofedImage = await request.post(
      '/api/event-applications/photo?event_slug=home-recording-mixing-workshop',
      {
        multipart: {
          file: {
            name: 'photo.png',
            mimeType: 'image/png',
            buffer: Buffer.from('not actually a png'),
          },
        },
      }
    )
    expect(spoofedImage.status()).toBe(400)
  })

  test('image proxy rejects unsupported protocols and private hosts', async ({ request }) => {
    const unsupportedProtocol = await request.get('/api/images/proxy?url=file:///etc/passwd')
    expect(unsupportedProtocol.status()).toBe(400)

    const privateHost = await request.get(
      `/api/images/proxy?url=${encodeURIComponent('http://127.0.0.1:3101/robots.txt')}`
    )
    expect(privateHost.status()).toBe(403)

    const unspecifiedIpv4 = await request.get(
      `/api/images/proxy?url=${encodeURIComponent('http://0.0.0.0:3101/robots.txt')}`
    )
    expect(unspecifiedIpv4.status()).toBe(403)

    const loopbackIpv6 = await request.get(
      `/api/images/proxy?url=${encodeURIComponent('http://[::1]:3101/robots.txt')}`
    )
    expect(loopbackIpv6.status()).toBe(403)
  })

  test('event application submission rejects externally supplied photo URLs', async ({
    request,
  }) => {
    const response = await request.post('/api/event-applications', {
      data: {
        event_slug: 'home-recording-mixing-workshop',
        applicant_name: 'Regression Test',
        contact_phone: '010-0000-0000',
        photo_url: 'https://example.com/tracker.png',
        privacy_consent: true,
      },
    })

    expect(response.status()).toBe(400)
  })

  test('event application submission rejects malformed JSON bodies explicitly', async ({
    request,
  }) => {
    const response = await request.post('/api/event-applications', {
      data: '{"event_slug":',
      headers: {
        'content-type': 'application/json',
      },
    })

    expect(response.status()).toBe(400)
    expect(response.headers()['content-type']).toMatch(/application\/json/)
  })

  test('posts API treats malformed page and cursor values as page one', async ({ request }) => {
    const response = await request.get('/api/posts?page=1.5&cursor=2abc')
    expect(response.status()).toBe(200)

    const body = await response.json()
    expect(body.data.pagination.has_prev).toBe(false)
    expect(body.data.pagination.prev_cursor).toBeNull()
  })
})
