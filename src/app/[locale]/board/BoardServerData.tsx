import { fetchBoardPosts } from '@/lib/server/board'
import BoardPageShell from '@/components/board/BoardPageShell'
import { isBoardEnabled } from '@/lib/features/settings'

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
  // 글쓰기 버튼을 누를 수 있는지. 목록 자체는 스위치와 무관하게 그대로다 —
  // 끈 것은 새 글이지 읽기가 아니다. 이 페이지는 ISR(revalidate=60)이라
  // 스위치를 내린 뒤 최대 그만큼 버튼이 남아 있을 수 있는데, 눌러도 작성
  // 화면과 `POST /api/posts`가 각각 다시 판정하므로 글은 올라가지 않는다.
  const boardEnabled = await isBoardEnabled()

  return (
    <BoardPageShell
      posts={initialData.posts}
      pageSize={pageSize}
      initialHasNext={initialData.hasNext}
      boardEnabled={boardEnabled}
    />
  )
}

export default BoardServerData
