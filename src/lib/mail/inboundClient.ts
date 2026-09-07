/**
 * Resend 수신 조회 API.
 *
 * `email.received` 웹훅에는 본문·헤더·첨부가 들어 있지 않다(메타데이터뿐).
 * 그래서 여기로 따로 당긴다. 발신과 다른 API 키를 쓴다 — 수신 조회에 필요한
 * 권한 등급은 전환 절차 4단계에서 확정한다.
 *
 * 보관은 30일이고 첨부 `download_url` 은 한 시간이면 만료된다. 그래서 호출부는
 * 받자마자 우리 저장소로 옮긴다.
 */
const RECEIVING_ENDPOINT = 'https://api.resend.com/emails/receiving'
const TIMEOUT_MS = 15_000

export type ReceivedEmail = {
  id: string
  from: string
  to: string[]
  cc: string[]
  subject: string | null
  html: string | null
  text: string | null
  headers: Record<string, string>
}

export type ReceivedAttachment = {
  id: string
  filename: string
  content_type: string | null
  content_id: string | null
  size: number | null
  download_url: string
}

function apiKey(): string {
  const key = process.env.RESEND_INBOUND_API_KEY?.trim()
  if (!key) {
    throw new Error('RESEND_INBOUND_API_KEY가 설정되지 않았습니다.')
  }
  return key
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${RECEIVING_ENDPOINT}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    // 본문에 API 키가 들어가지 않는다 — 상태 코드와 Resend의 메시지만 남긴다.
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend 수신 조회 실패 (${response.status}): ${detail.slice(0, 200)}`)
  }
  return (await response.json()) as Record<string, unknown>
}

/** 인라인 이미지를 base64 data URI로 받는다 — 외부 요청 없이 렌더된다. */
export async function fetchReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const body = await getJson(`/${encodeURIComponent(emailId)}?html_format=data_uri`)
  return {
    id: String(body.id ?? emailId),
    from: String(body.from ?? ''),
    to: Array.isArray(body.to) ? body.to.map(String) : [],
    cc: Array.isArray(body.cc) ? body.cc.map(String) : [],
    subject: body.subject == null ? null : String(body.subject),
    html: body.html == null ? null : String(body.html),
    text: body.text == null ? null : String(body.text),
    headers:
      body.headers && typeof body.headers === 'object'
        ? (body.headers as Record<string, string>)
        : {},
  }
}

export async function listReceivedAttachments(emailId: string): Promise<ReceivedAttachment[]> {
  const body = await getJson(`/${encodeURIComponent(emailId)}/attachments?limit=100`)
  const rows = Array.isArray(body.data) ? body.data : []
  return rows.map(row => {
    const item = row as Record<string, unknown>
    return {
      id: String(item.id ?? ''),
      filename: String(item.filename ?? 'attachment'),
      content_type: item.content_type == null ? null : String(item.content_type),
      content_id: item.content_id == null ? null : String(item.content_id),
      size: typeof item.size === 'number' ? item.size : null,
      download_url: String(item.download_url ?? ''),
    }
  })
}

export async function downloadAttachment(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`첨부 내려받기 실패 (${response.status})`)
  }
  return Buffer.from(await response.arrayBuffer())
}
