import { fetchBoardPosts } from '@/lib/server/board'
import BoardPageShell from '@/components/board/BoardPageShell'

// 첫 페이지(전체 카테고리)만 ISR(page revalidate=60)로 프리렌더한다. 카테고리
// 변경·2페이지 이후는 BoardListView가 /api/board/posts(정상 서버 페이지네이션 +
// s-maxage CDN 캐시)로 페치한다 — 과거처럼 전량(200)을 로드해 클라이언트에서
// 슬라이스하면 게시글이 200건을 넘는 순간 오래된 글이 어느 페이지로도 도달
// 불가능해진다(코드리뷰 CONFIRMED, 잠복). 이 구조는 SSR HTML에 1페이지 글을
// 그대로 담아 SEO/크롤러/첫 페인트를 보존하면서 상한 문제를 제거한다.
// 참고: 이 파일의 과거 `export const revalidate`는 라우트 세그먼트 파일이 아니어서
// 무효인 죽은 선언이라 제거했다(전수감사 P6) — 유효한 revalidate는 board/page.tsx에 있다.
interface BoardServerDataProps {
  /** 페이지당 표시 수 (첫 페이지 SSR·이후 API 페이지네이션 공통) */
  pageSize?: number
}

const BoardServerData = async ({ pageSize = 15 }: BoardServerDataProps) => {
  const initialData = await fetchBoardPosts({ category: '전체', page: 1, pageSize })

  return (
    <BoardPageShell
      posts={initialData.posts}
      pageSize={pageSize}
      initialHasNext={initialData.hasNext}
    />
  )
}

export default BoardServerData
