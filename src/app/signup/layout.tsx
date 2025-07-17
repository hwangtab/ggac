import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '조합원 가입 - 경기아트콜렉티브 협동조합',
  description: '경기아트콜렉티브 협동조합 조합원으로 가입하여 다양한 예술 활동에 참여하고 창작 공동체의 일원이 되어보세요. 음악, 미술, 영상, 공연 등 모든 예술 분야의 아티스트들과 함께 협력하고 성장할 수 있습니다.',
  keywords: ['조합원 가입', '경기아트콜렉티브', '협동조합', '예술가 가입', '아티스트 등록', '창작 공동체', '예술 협력'],
  openGraph: {
    title: '조합원 가입 - 경기아트콜렉티브 협동조합',
    description: '경기아트콜렉티브 협동조합 조합원으로 가입하여 창작 공동체의 일원이 되어보세요.',
    type: 'website'
  },
  twitter: {
    card: 'summary',
    title: '조합원 가입 - 경기아트콜렉티브 협동조합',
    description: '경기아트콜렉티브 협동조합 조합원으로 가입하여 창작 공동체의 일원이 되어보세요.'
  },
  robots: {
    index: true,
    follow: true
  }
}

export default function SignupLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}