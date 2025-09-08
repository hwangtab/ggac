// 하이브리드 렌더링: 서버 컴포넌트 + 클라이언트 하이드레이션
import { Suspense } from 'react'
import BoardClient from './BoardClient'
import BoardServerData from './BoardServerData'

// ISR 설정 - 서버 컴포넌트에서 초기 데이터 캐싱
export const revalidate = 60

// 서버 컴포넌트 - ISR로 초기 데이터 캐싱
async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; cursor?: string }>
}) {
  const params = await searchParams
  const category = params.category || '전체'

  return (
    <div>
      {/* 서버에서 초기 데이터 제공 (ISR 캐시됨) */}
      <BoardServerData category={category} limit={20} />

      {/* 클라이언트 컴포넌트로 하이드레이션 */}
      <Suspense
        fallback={
          <div className="min-h-screen pt-24 md:pt-28 flex items-center justify-center">
            <div className="text-gray-600">게시판을 로드하는 중...</div>
          </div>
        }
      >
        <BoardClientWrapper />
      </Suspense>
    </div>
  )
}

// 클라이언트 데이터 읽기 및 BoardClient에 전달하는 래퍼
function BoardClientWrapper() {
  // 서버에서 제공한 초기 데이터 읽기
  const initialDataScript =
    typeof document !== 'undefined'
      ? document.getElementById('initial-posts-data')?.textContent
      : null

  const initialData = initialDataScript ? JSON.parse(initialDataScript) : undefined

  return <BoardClient initialData={initialData} />
}

export default BoardPage
