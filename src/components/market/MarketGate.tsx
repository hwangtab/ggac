import { Link } from '@/i18n/navigation'

/** 장터 화면의 "들어올 수 없음" 안내. `board/write/page.tsx`의 상자와 같은 모양이다. */
export default function MarketGate({
  title,
  body,
  backLabel,
  backHref = '/board',
}: {
  title: string
  body: string
  backLabel: string
  backHref?: string
}) {
  return (
    <div className="min-h-screen bg-gray-50 pt-20 md:pt-24">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h1 className="text-2xl font-bold text-yellow-800 mb-4">{title}</h1>
            <p className="text-yellow-700 mb-4">{body}</p>
            <Link
              href={backHref}
              className="inline-block bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
            >
              {backLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
