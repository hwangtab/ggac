// 하이브리드 렌더링: 서버 컴포넌트 + 클라이언트 하이드레이션
import { Suspense } from 'react'
import BoardServerData from './BoardServerData'

// ISR 설정 - 서버 컴포넌트에서 초기 데이터 캐싱
export const revalidate = 60

// 서버 컴포넌트 - ISR로 초기 데이터 캐싱
async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; cursor?: string; refresh?: string }>
}) {
  const params = await searchParams
  const category = params.category || '전체'
  const refreshKey = params.refresh

  return (
    <div>
      {/* 서버에서 초기 데이터 제공 (ISR 캐시됨) - 즉시 스트리밍을 위해 Suspense로 감싸기 */}
      <Suspense
        fallback={
          <div className="pt-24 md:pt-28 container mx-auto px-4">
            <div className="h-6 w-40 bg-gray-200 rounded mb-4 animate-pulse" />
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-white p-6 rounded-lg shadow-md animate-pulse">
                  <div className="w-24 h-4 bg-gray-200 rounded mb-2" />
                  <div className="w-2/3 h-6 bg-gray-200 rounded mb-3" />
                  <div className="w-full h-16 bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          </div>
        }
      >
        <BoardServerData category={category} limit={15} refreshKey={refreshKey} />
      </Suspense>
    </div>
  )
}

export default BoardPage
