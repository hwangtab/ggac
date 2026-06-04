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
      },
    })

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/application\/json/)
    await expect(response).toBeOK()
  })
})
