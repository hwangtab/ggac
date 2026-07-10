import { fetchBoardPosts } from '@/lib/server/board'
import BoardPageShell from '@/components/board/BoardPageShell'

// 게시글 전량을 ISR(페이지 revalidate=60)로 렌더하고, 카테고리 필터와
// 페이지네이션은 ServerBoardView(클라이언트)가 useSearchParams로 파생한다.
// 참고: 이 파일의 과거 `export const revalidate`는 라우트 세그먼트 파일이
// 아니어서 무효인 죽은 선언이라 제거했다(전수감사 P6) — 유효한 revalidate는
// board/page.tsx에 있다.
interface BoardServerDataProps {
  /** 클라이언트 페이지네이션의 페이지당 표시 수 */
  pageSize?: number
  /** 서버가 한 번에 렌더하는 게시글 상한(전량 로드용 여유값) */
  fetchLimit?: number
}

const BoardServerData = async ({ pageSize = 15, fetchLimit = 200 }: BoardServerDataProps) => {
  const initialData = await fetchBoardPosts({ category: '전체', page: 1, pageSize: fetchLimit })

  return <BoardPageShell posts={initialData.posts} pageSize={pageSize} />
}

export default BoardServerData
