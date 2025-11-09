import ServerBoardView from './ServerBoardView'
import type { BoardInitialPost } from '@/lib/server/board'
import dynamic from 'next/dynamic'

const BoardUserSection = dynamic(() => import('./BoardUserSection'), {
  ssr: false,
  loading: () => null,
})

interface BoardPageShellProps {
  posts: BoardInitialPost[]
  category: string
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
