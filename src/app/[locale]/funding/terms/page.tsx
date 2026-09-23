/**
 * 펀딩 약관.
 *
 * 한 문서에 두 부가 들어 있다 — 제1부는 후원자에게, 제2부는 펀딩을 여는
 * 창작자에게 적용된다. 창작자 동의 체크박스(`/mypage/funding/new`)가
 * `#creator`로 제2부를 가리킨다. 문서를 둘로 나누지 않는 이유는 시행일이
 * 하나여야 하기 때문이다 — 동의 기록(`terms_version`)은 개설자 쪽도
 * 후원자 쪽도 같은 판본 문자열(`FUNDING_TERMS_REVISION`)을 남긴다.
 *
 * 후원 폼의 동의 문구가 이 주소를 가리킨다. 전자상거래법 제13조는 청약철회·
 * 환불 조건의 **고지**를 요구하고(동의 체크가 아니다), 개인정보보호법 제30조는
 * 처리방침의 **공개**를 요구한다. 그래서 이 문서는 읽을 수 있게 놓여 있기만
 * 하면 되고, 후원 화면은 "누르면 동의한 것으로 본다"고 알리기만 한다.
 *
 * 본문을 번역하지 않는다 — 법적 고지문의 번역본이 원문과 어긋나면 어느 쪽이
 * 구속력을 갖는지 다툼이 된다. 영문 방문자에게는 정본이 한국어임을 알린다.
 */

import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'

import { Link } from '@/i18n/navigation'
import { FUNDING_TERMS_REVISION } from '@/lib/funding/terms'
import { getLocaleAlternates, getSiteUrl } from '@/utils/site'

// 시행일 문자열의 정본은 `@/lib/funding/terms`다 — 동의를 기록하는 두
// 라우트가 같은 상수를 읽으므로, 이 문서가 바뀌면 기록된 판본도 함께 바뀐다.
const REVISION = FUNDING_TERMS_REVISION

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const site = getSiteUrl()
  const path = '/funding/terms'
  return {
    title: '펀딩 약관',
    description: '경기아트콜렉티브 협동조합 펀딩의 후원·환불·배송 약관과 창작자 약관입니다.',
    alternates: getLocaleAlternates(path, locale),
    openGraph: {
      title: '펀딩 약관',
      description: '경기아트콜렉티브 협동조합 펀딩의 후원·환불·배송 약관과 창작자 약관입니다.',
      url: `${site}${locale === 'ko' ? '' : `/${locale}`}${path}`,
      type: 'website',
    },
  }
}

export default async function FundingTermsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-32 pb-20 sm:px-6 md:pt-40">
      <article className="prose prose-gray mx-auto max-w-3xl">
        <h1>펀딩 약관</h1>
        <p className="text-sm text-gray-500">
          시행일 {REVISION}
          {locale === 'en' ? ' · The Korean text is the authoritative version.' : ''}
        </p>

        <h2>제1부 후원자 약관</h2>
        <p>
          제1조부터 제8조까지는 펀딩에 후원하시는 분에게 적용됩니다. 펀딩을 여는 창작자에게는{' '}
          <Link href="/funding/terms#creator">제2부</Link>가 함께 적용됩니다.
        </p>

        <h2>제1조 (성격)</h2>
        <p>
          이 약관은 경기아트콜렉티브 협동조합(이하 “조합”)이 운영하는 펀딩에 적용됩니다. 펀딩은{' '}
          <strong>기부가 아니라 리워드를 받는 선주문 형태의 통신판매</strong>입니다. 기부금영수증은
          발급되지 않습니다.
        </p>

        <h2>제2조 (목표 미달)</h2>
        <p>
          목표 금액에 미치지 못해도 모인 금액으로 제작을 진행합니다. 목표 미달을 이유로 후원이
          취소되지 않습니다. 제작이 불가능해진 경우 조합은 후원자에게 알리고 후원 금액 전액을
          환불합니다.
        </p>

        <h2>제3조 (마감)</h2>
        <p>
          캠페인에 적힌 마감일은 <strong>안내를 위한 표시</strong>이고, 후원 접수의 종료는 창작자
          또는 조합이 마감을 실행한 시점입니다. 마감일이 지난 뒤에도 캠페인이 열려 있을 수 있습니다.
        </p>

        <h2>제4조 (청약철회와 취소)</h2>
        <p>
          캠페인이 진행 중이고 리워드 준비가 시작되기 전이라면 후원 조회 화면에서 직접 전액 취소할
          수 있습니다. 그 뒤의 취소는 사무국(contact@ggac.kr)으로 연락해 주시면 전자상거래법이
          정하는 바에 따라 처리합니다.
        </p>
        <p>
          디지털 리워드를 이미 내려받으신 경우, 전자상거래법 제17조 제2항에 따라 청약철회가 제한될
          수 있습니다.
        </p>

        <h2>제5조 (리워드 발송)</h2>
        <p>
          발송 예정 시기는 캠페인에 적힌 대로이며, 제작 사정으로 늦어질 수 있습니다. 늦어지는 경우
          창작자가 후원자에게 알립니다. 배송이 필요한 리워드는 후원 시 입력하신 주소로 보내
          드립니다.
        </p>

        <h2>제6조 (개인정보)</h2>
        <p>
          후원에 필요한 정보(이름·이메일·연락처, 배송이 필요한 경우 주소)는 후원 처리와 리워드
          발송에 쓰입니다. 자세한 내용은 <Link href="/privacy">개인정보 처리방침</Link>을 따릅니다.
          후원자 명단과 응원 메시지는 <strong>공개에 동의하신 경우에만</strong>
          캠페인 화면에 표시되며, 익명을 선택하시면 이름 대신 “익명”으로 적힙니다.
        </p>

        <h2>제7조 (결제)</h2>
        <p>
          결제는 토스페이먼츠를 통해 이루어집니다. 조합은 카드 정보를 보관하지 않습니다. 환불은
          결제하신 수단으로 되돌려 드리며, 카드사 사정에 따라 며칠 걸릴 수 있습니다.
        </p>

        <h2>제8조 (문의)</h2>
        <p>
          펀딩과 리워드에 관한 문의는 사무국(<a href="mailto:contact@ggac.kr">contact@ggac.kr</a>)이
          받습니다.
        </p>

        <h2 id="creator">제2부 창작자 약관</h2>
        <p>
          아래 제9조부터 제13조까지는 <strong>펀딩을 여는 창작자</strong>와 조합 사이에 적용됩니다.
          캠페인을 만들 때 동의하시는 개설자 약관이 이 부분입니다. 제1부는 그대로 후원자에게
          적용됩니다.
        </p>

        <h2>제9조 (목표 미달과 제작)</h2>
        <p>
          목표 금액에 미치지 못해도 모인 금액으로 제작을 진행합니다. 창작자는 목표 미달을 이유로
          제작을 중단하거나 리워드를 줄이지 않습니다. 제작이 불가능해진 경우 창작자는 조합에 곧바로
          알리고, 후원 금액은 제2조에 따라 환불됩니다.
        </p>

        <h2>제10조 (마감)</h2>
        <p>
          캠페인에 적힌 마감일은 <strong>안내를 위한 표시</strong>이고, 후원 접수의 종료는 창작자
          또는 조합이 마감을 실행한 시점입니다. 마감을 실행하지 않으면 마감일이 지난 뒤에도 캠페인은
          열려 있습니다.
        </p>

        <h2>제11조 (공개 뒤 변경)</h2>
        <p>
          캠페인이 공개된 뒤에는 제목·목표 금액·분류를 바꿀 수 없습니다. 소개·본문·이미지·마감일은
          공개된 뒤에도 고칠 수 있습니다.
        </p>
        <p>
          리워드는 공개된 뒤에 새로 추가하거나 수량을 늘리는 것만 됩니다. 이미 올라간 리워드는
          후원이 들어왔는지와 무관하게{' '}
          <strong>
            이름·설명·금액·배송 여부를 바꿀 수 없고, 수량을 줄이거나 삭제할 수 없습니다.
          </strong>{' '}
          다른 조건이 필요하면 리워드를 새로 추가해 주세요.
        </p>

        <h2>제12조 (리워드 이행)</h2>
        <p>
          캠페인에 적은 리워드를 후원자에게 전달할 책임은 창작자에게 있습니다. 배송이 필요한
          리워드는 후원자가 입력한 주소로 창작자가 보냅니다. 발송이 예정보다 늦어지는 경우 창작자가
          후원자에게 알립니다.
        </p>

        <h2>제13조 (심사)</h2>
        <p>
          조합은 캠페인을 공개하기 전에 심사합니다. 심사 중에는 내용을 고칠 수 없고, 심사를 통과하지
          못한 캠페인은 공개되지 않습니다. 조합은 사유를 적어 창작자에게 돌려보냅니다.
        </p>
      </article>
    </div>
  )
}
