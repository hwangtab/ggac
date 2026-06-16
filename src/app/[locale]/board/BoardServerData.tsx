import { fetchBoardPosts } from '@/lib/server/board'
import BoardPageShell from '@/components/board/BoardPageShell'
import type { BoardCategory } from '@/constants/categories'

export const revalidate = 60

interface BoardServerDataProps {
  category?: BoardCategory
  page?: number
  pageSize?: number
}

const BoardServerData = async ({
  category = '전체',
  page = 1,
  pageSize = 15,
}: BoardServerDataProps) => {
  const initialData = await fetchBoardPosts({ category, page, pageSize })

  return (
    <BoardPageShell
      posts={initialData.posts}
      category={category}
      pagination={{
        hasNext: initialData.hasNext,
        hasPrev: initialData.hasPrev,
        currentPage: initialData.currentPage,
      }}
    />
  )
}

export default BoardServerData
