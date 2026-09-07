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
/**
 * 첨부 파일 최대 크기. Resend가 상한을 문서화하지 않아 우리가 감당할 수 있는 선으로
 * 정한 값이다. 전환 절차 4단계에서 실제 첨부로 재본 뒤 조정한다.
 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

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
      body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)
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

/**
 * Resend 첨부 서명 URL에서 파일을 내려받는다.
 *
 * 실패하면 던진다 — 호출부(Task 8)는 해당 첨부만 건너뛰고 나머지와 본문은 저장한다.
 *
 * @throws 크기 초과, HTTP 실패 등
 */
export async function downloadAttachment(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`첨부 내려받기 실패 (${response.status})`)
  }

  // Content-Length 헤더로 미리 크기 확인 (헤더 없으면 스킵).
  const contentLength = response.headers.get('content-length')
  if (contentLength) {
    const size = parseInt(contentLength, 10)
    if (!Number.isNaN(size) && size > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `첨부가 크기 제한을 초과합니다 (${Math.round(size / 1024 / 1024)}MB > ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`
      )
    }
  }

  // 실제 본문 크기 재확인 (Content-Length는 거짓일 수 있음). 이미 메모리에 올린 뒤라
  // 늦지만 저장은 막는다.
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `첨부가 크기 제한을 초과합니다 (${Math.round(buffer.length / 1024 / 1024)}MB > ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`
    )
  }

  return buffer
}
