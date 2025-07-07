'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface UsePaginationProps {
  initialPage?: number;
  pageSize?: number;
  totalCount?: number;
}

interface PaginationState {
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  startItem: number;
  endItem: number;
}

interface PaginationActions {
  goToPage: (page: number) => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  setTotalCount: (count: number) => void;
  updateUrlParams: (page: number, category?: string) => void;
}

export const usePagination = ({
  initialPage = 1,
  pageSize = 10,
  totalCount = 0,
}: UsePaginationProps = {}): [PaginationState, PaginationActions] => {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // URL에서 페이지 번호 읽기
  const urlPage = parseInt(searchParams.get('page') || '1');
  const [currentPage, setCurrentPage] = useState(Math.max(1, urlPage || initialPage));
  const [totalCountState, setTotalCountState] = useState(totalCount);

  // 계산된 값들
  const state = useMemo((): PaginationState => {
    const totalPages = Math.max(1, Math.ceil(totalCountState / pageSize));
    const safePage = Math.min(Math.max(1, currentPage), totalPages);
    
    return {
      currentPage: safePage,
      pageSize,
      totalCount: totalCountState,
      totalPages,
      hasNextPage: safePage < totalPages,
      hasPrevPage: safePage > 1,
      startItem: (safePage - 1) * pageSize + 1,
      endItem: Math.min(safePage * pageSize, totalCountState),
    };
  }, [currentPage, pageSize, totalCountState]);

  // URL 파라미터 업데이트
  const updateUrlParams = useCallback((page: number, category?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (page === 1) {
      params.delete('page');
    } else {
      params.set('page', page.toString());
    }
    
    if (category && category !== '전체') {
      params.set('category', category);
    } else if (category === '전체') {
      params.delete('category');
    }

    const queryString = params.toString();
    const newUrl = queryString ? `/board?${queryString}` : '/board';
    
    router.push(newUrl, { scroll: false });
  }, [router, searchParams]);

  // 액션들
  const actions: PaginationActions = {
    goToPage: useCallback((page: number) => {
      const safePage = Math.min(Math.max(1, page), state.totalPages);
      setCurrentPage(safePage);
      updateUrlParams(safePage, searchParams.get('category') || undefined);
    }, [state.totalPages, updateUrlParams, searchParams]),

    goToNextPage: useCallback(() => {
      if (state.hasNextPage) {
        const nextPage = state.currentPage + 1;
        setCurrentPage(nextPage);
        updateUrlParams(nextPage, searchParams.get('category') || undefined);
      }
    }, [state.hasNextPage, state.currentPage, updateUrlParams, searchParams]),

    goToPrevPage: useCallback(() => {
      if (state.hasPrevPage) {
        const prevPage = state.currentPage - 1;
        setCurrentPage(prevPage);
        updateUrlParams(prevPage, searchParams.get('category') || undefined);
      }
    }, [state.hasPrevPage, state.currentPage, updateUrlParams, searchParams]),

    setTotalCount: useCallback((count: number) => {
      setTotalCountState(count);
    }, []),

    updateUrlParams,
  };

  return [state, actions];
};

// 페이지 번호 배열 생성 유틸리티
export const generatePageNumbers = (currentPage: number, totalPages: number, maxVisible: number = 5): (number | '...')[] => {
  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: (number | '...')[] = [];
  const halfVisible = Math.floor(maxVisible / 2);

  if (currentPage <= halfVisible + 1) {
    // 시작 부분
    for (let i = 1; i <= maxVisible - 1; i++) {
      pages.push(i);
    }
    pages.push('...');
    pages.push(totalPages);
  } else if (currentPage >= totalPages - halfVisible) {
    // 끝 부분
    pages.push(1);
    pages.push('...');
    for (let i = totalPages - maxVisible + 2; i <= totalPages; i++) {
      pages.push(i);
    }
  } else {
    // 중간 부분
    pages.push(1);
    pages.push('...');
    for (let i = currentPage - halfVisible + 1; i <= currentPage + halfVisible - 1; i++) {
      pages.push(i);
    }
    pages.push('...');
    pages.push(totalPages);
  }

  return pages;
};