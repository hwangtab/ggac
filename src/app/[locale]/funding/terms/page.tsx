/**
 * 펀딩 약관.
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
import { getLocaleAlternates, getSiteUrl } from '@/utils/site'

const REVISION = '2026-09-23'

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
    description: '경기아트콜렉티브 협동조합 펀딩의 후원·환불·배송 약관입니다.',
    alternates: getLocaleAlternates(path, locale),
    openGraph: {
      title: '펀딩 약관',
      description: '경기아트콜렉티브 협동조합 펀딩의 후원·환불·배송 약관입니다.',
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
      </article>
    </div>
  )
}
