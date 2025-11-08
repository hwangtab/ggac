export const generatePageNumbers = (
  currentPage: number,
  totalPages: number,
  maxVisible: number = 5
): (number | '...')[] => {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const pages: (number | '...')[] = []
  const halfVisible = Math.floor(maxVisible / 2)

  if (currentPage <= halfVisible + 1) {
    for (let i = 1; i <= maxVisible - 1; i++) {
      pages.push(i)
    }
    pages.push('...')
    pages.push(totalPages)
  } else if (currentPage >= totalPages - halfVisible) {
    pages.push(1)
    pages.push('...')
    for (let i = totalPages - maxVisible + 2; i <= totalPages; i++) {
      pages.push(i)
    }
  } else {
    pages.push(1)
    pages.push('...')
    for (let i = currentPage - halfVisible + 1; i <= currentPage + halfVisible - 1; i++) {
      pages.push(i)
    }
    pages.push('...')
    pages.push(totalPages)
  }

  return pages
}
