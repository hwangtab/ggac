'use client'

import React from 'react'
import { generatePageNumbers } from '@/utils/pagination'

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  totalCount: number
  pageSize: number
  onPageChange: (page: number) => void
  loading?: boolean
  className?: string
}

const PaginationControls: React.FC<PaginationControlsProps> = ({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  loading = false,
  className = '',
}) => {
  if (totalPages <= 1) {
    return null
  }

  const pageNumbers = generatePageNumbers(currentPage, totalPages, 5)
  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalCount)

  const handlePageClick = (page: number | '...') => {
    if (page !== '...' && page !== currentPage && !loading) {
      onPageChange(page)
    }
  }

  const handlePrevious = () => {
    if (currentPage > 1 && !loading) {
      onPageChange(currentPage - 1)
    }
  }

  const handleNext = () => {
    if (currentPage < totalPages && !loading) {
      onPageChange(currentPage + 1)
    }
  }

  return (
    <div className={`flex flex-col items-center space-y-4 ${className}`}>
      {/* 페이지 정보 표시 */}
      <div className="text-sm text-gray-600">
        전체 <span className="font-semibold text-gray-900">{totalCount.toLocaleString()}</span>개
        게시글
        {totalCount > 0 && (
          <>
            {' | '}
            <span className="font-semibold text-gray-900">{startItem}</span>-
            <span className="font-semibold text-gray-900">{endItem}</span>개 표시
            {' | '}
            <span className="font-semibold text-primary-600">{currentPage}</span>/
            <span className="font-semibold text-gray-900">{totalPages}</span> 페이지
          </>
        )}
      </div>

      {/* 페이지네이션 컨트롤 */}
      <nav aria-label="페이지네이션" role="navigation">
        <div className="flex items-center space-x-1">
          {/* 이전 페이지 버튼 */}
          <button
            onClick={handlePrevious}
            disabled={currentPage === 1 || loading}
            aria-label="이전 페이지"
            className={`
              px-3 py-2 text-sm font-medium rounded-lg transition-colors duration-200
              ${
                currentPage === 1 || loading
                  ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                  : 'text-gray-700 bg-white hover:bg-gray-50 hover:text-primary-600 border border-gray-300'
              }
            `}
          >
            <span className="hidden sm:inline">이전</span>
            <span className="sm:hidden">‹</span>
          </button>

          {/* 페이지 번호들 */}
          <div className="hidden sm:flex items-center space-x-1">
            {pageNumbers.map((page, index) =>
              page === '...' ? (
                <span key={`ellipsis-${index}`} className="px-3 py-2 text-sm text-gray-400">
                  ...
                </span>
              ) : (
                <button
                  key={page}
                  onClick={() => handlePageClick(page)}
                  disabled={loading}
                  className={`
                  px-3 py-2 text-sm font-medium rounded-lg transition-colors duration-200
                  ${
                    page === currentPage
                      ? 'bg-primary-600 text-white cursor-default'
                      : loading
                        ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                        : 'text-gray-700 bg-white hover:bg-gray-50 hover:text-primary-600 border border-gray-300'
                  }
                `}
                  aria-label={`${page}페이지로 이동`}
                  aria-current={page === currentPage ? 'page' : undefined}
                >
                  {page}
                </button>
              )
            )}
          </div>

          {/* 모바일용 간단한 페이지 표시 */}
          <div className="sm:hidden flex items-center px-3 py-2 text-sm text-gray-600 bg-gray-50 rounded-lg">
            {currentPage} / {totalPages}
          </div>

          {/* 다음 페이지 버튼 */}
          <button
            onClick={handleNext}
            disabled={currentPage === totalPages || loading}
            aria-label="다음 페이지"
            className={`
            px-3 py-2 text-sm font-medium rounded-lg transition-colors duration-200
            ${
              currentPage === totalPages || loading
                ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                : 'text-gray-700 bg-white hover:bg-gray-50 hover:text-primary-600 border border-gray-300'
            }
          `}
          >
            <span className="hidden sm:inline">다음</span>
            <span className="sm:hidden">›</span>
          </button>
        </div>
      </nav>

      {/* 모바일용 더 보기 버튼 (옵션) */}
      {currentPage < totalPages && (
        <div className="sm:hidden">
          <button
            onClick={handleNext}
            disabled={loading}
            aria-label="더 많은 게시글 보기"
            className={`
              px-6 py-3 text-sm font-medium rounded-lg transition-colors duration-200 w-full
              ${
                loading
                  ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
                  : 'text-white bg-primary-600 hover:bg-primary-700'
              }
            `}
          >
            {loading ? '로딩 중...' : '더 보기'}
          </button>
        </div>
      )}

      {/* 로딩 상태 표시 */}
      {loading && (
        <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
          <div className="animate-spin h-4 w-4 border-2 border-primary-600 border-t-transparent rounded-full"></div>
          <span>로딩 중...</span>
        </div>
      )}
    </div>
  )
}

export default PaginationControls
