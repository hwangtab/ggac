// 하이브리드 렌더링: 서버 컴포넌트 + 클라이언트 하이드레이션
import { Suspense } from 'react'
import BoardServerData from './BoardServerData'

export const revalidate = 60

interface BoardPageProps {
  searchParams?: {
    category?: string
    page?: string
  }
}

const BoardPage = ({ searchParams = {} }: BoardPageProps) => {
  const category = searchParams.category || '전체'
  const pageParam = parseInt(searchParams.page || '1', 10)
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1

  return (
    <div>
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
        <BoardServerData category={category} page={page} pageSize={15} />
      </Suspense>
    </div>
  )
}

export default BoardPage
