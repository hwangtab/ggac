import ServerBoardView from './ServerBoardView'
import type { BoardInitialPost } from '@/lib/server/board'
import BoardUserSection from './BoardUserSection'

interface BoardPageShellProps {
  posts: BoardInitialPost[]
  pageSize: number
}

const BoardPageShell = ({ posts, pageSize }: BoardPageShellProps) => {
  // 클라이언트 컴포넌트에는 함수 prop을 직렬화할 수 없으므로 ReactNode 슬롯으로 전달
  return <ServerBoardView posts={posts} pageSize={pageSize} authSection={<BoardUserSection />} />
}

export default BoardPageShell
