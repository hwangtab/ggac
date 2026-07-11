import { Suspense } from 'react'
import ServerBoardView, { BoardListView } from './ServerBoardView'
import type { BoardInitialPost } from '@/lib/server/board'
import BoardUserSection from './BoardUserSection'

interface BoardPageShellProps {
  posts: BoardInitialPost[]
  pageSize: number
  initialHasNext: boolean
}

// useSearchParams(ServerBoardView)는 정적 프리렌더에서 이 Suspense 경계까지
// CSR bailout된다. fallback을 스켈레톤이 아닌 "기본 상태(전체·1페이지) 목록"
// 으로 렌더해 프리렌더 HTML에 게시글 콘텐츠를 포함시킨다 — 쿼리 없는 방문
// (대부분·크롤러 포함)은 fallback과 실제 뷰가 동일해 시각적 교체가 없다.
const BoardPageShell = ({ posts, pageSize, initialHasNext }: BoardPageShellProps) => {
  const authSection = <BoardUserSection />

  return (
    <Suspense
      fallback={
        <BoardListView
          initialPosts={posts}
          initialHasNext={initialHasNext}
          pageSize={pageSize}
          category="전체"
          requestedPage={1}
          authSection={authSection}
        />
      }
    >
      <ServerBoardView
        posts={posts}
        pageSize={pageSize}
        initialHasNext={initialHasNext}
        authSection={authSection}
      />
    </Suspense>
  )
}

export default BoardPageShell
