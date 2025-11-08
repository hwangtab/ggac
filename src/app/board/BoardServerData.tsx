import BoardClient from './BoardClient'
import { fetchBoardPosts } from '@/lib/server/board'

export const revalidate = 60

interface BoardServerDataProps {
  category?: string
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
    <BoardClient
      key={`${category}-${initialData.currentPage}`}
      initialData={initialData}
      category={category}
      page={initialData.currentPage}
    />
  )
}

export default BoardServerData
