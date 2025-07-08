'use client'

import { useMemo } from 'react'

/**
 * 필터링 가능한 아이템의 기본 인터페이스
 * 카테고리가 단일 문자열 또는 배열일 수 있음 (아티스트의 경우)
 */
interface FilterableItem {
  category: string | string[]
}

/**
 * 필터링 옵션 인터페이스
 */
interface FilterOptions {
  /** 전체 선택을 나타내는 라벨 (기본값: 'All') */
  allLabel?: string
  /** 대소문자 구분 없이 필터링할지 여부 (기본값: false) */
  caseInsensitive?: boolean
}

/**
 * 범용 필터링 훅
 * 
 * @template T - 필터링할 아이템의 타입
 * @param items - 필터링할 아이템 배열
 * @param selectedCategory - 선택된 카테고리
 * @param options - 필터링 옵션
 * @returns 필터링된 아이템 배열
 * 
 * @example
 * // 기본 사용법 (프로젝트 필터링)
 * const filteredProjects = useFilter(projects, selectedCategory, { allLabel: 'All' })
 * 
 * @example  
 * // 다중 카테고리 지원 (아티스트 필터링)
 * const filteredArtists = useFilter(artists, selectedCategory, { allLabel: 'All' })
 * 
 * @example
 * // 게시판 필터링 (한글 전체 라벨)
 * const filteredPosts = useFilter(posts, selectedCategory, { allLabel: '전체' })
 */
export const useFilter = <T extends FilterableItem>(
  items: T[],
  selectedCategory: string,
  options: FilterOptions = {}
): T[] => {
  const { allLabel = 'All', caseInsensitive = false } = options

  return useMemo(() => {
    // 전체 선택인 경우 모든 아이템 반환
    if (selectedCategory === allLabel) {
      return items
    }

    // 필터링 로직
    return items.filter(item => {
      const { category } = item
      
      // 카테고리가 배열인 경우 (아티스트의 다중 카테고리)
      if (Array.isArray(category)) {
        return caseInsensitive
          ? category.some(cat => cat.toLowerCase() === selectedCategory.toLowerCase())
          : category.includes(selectedCategory)
      }
      
      // 카테고리가 단일 문자열인 경우 (프로젝트, 게시판)
      return caseInsensitive
        ? category.toLowerCase() === selectedCategory.toLowerCase()
        : category === selectedCategory
    })
  }, [items, selectedCategory, allLabel, caseInsensitive])
}

/**
 * 클라이언트 사이드 필터링 전용 훅 (명확성을 위한 별칭)
 * 서버사이드 필터링과 구분하기 위해 제공
 */
export const useClientFilter = useFilter

/**
 * 카테고리 카운트를 포함한 필터링 정보 반환 훅
 * 
 * @template T - 필터링할 아이템의 타입
 * @param items - 필터링할 아이템 배열
 * @param categories - 전체 카테고리 배열
 * @param selectedCategory - 선택된 카테고리
 * @param options - 필터링 옵션
 * @returns 필터링된 아이템과 카테고리별 카운트 정보
 */
export const useFilterWithCounts = <T extends FilterableItem>(
  items: T[],
  categories: readonly string[],
  selectedCategory: string,
  options: FilterOptions = {}
) => {
  const { allLabel = 'All' } = options
  
  const filteredItems = useFilter(items, selectedCategory, options)
  
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    
    // 전체 개수 계산
    counts[allLabel] = items.length
    
    // 각 카테고리별 개수 계산
    categories.slice(1).forEach(category => { // allLabel 제외
      counts[category] = items.filter(item => {
        if (Array.isArray(item.category)) {
          return item.category.includes(category)
        }
        return item.category === category
      }).length
    })
    
    return counts
  }, [items, categories, allLabel])
  
  return {
    filteredItems,
    categoryCounts,
    totalCount: items.length,
    filteredCount: filteredItems.length
  }
}