import ServerBoardView from './ServerBoardView'
import type { BoardInitialPost } from '@/lib/server/board'
import type { BoardCategory } from '@/constants/categories'
import BoardUserSection from './BoardUserSection'

interface BoardPageShellProps {
  posts: BoardInitialPost[]
  category: BoardCategory
  pagination: {
    hasNext: boolean
    hasPrev: boolean
    currentPage: number
  }
}

const BoardPageShell = ({ posts, category, pagination }: BoardPageShellProps) => {
  return (
    <ServerBoardView
      posts={posts}
      category={category}
      pagination={pagination}
      renderAuthSection={() => <BoardUserSection />}
    />
  )
}

export default BoardPageShell
