'use client'

import { useState, useCallback } from 'react'
import type { 
  FilterGroup, 
  FilterCondition, 
  SortCondition, 
  AdvancedSearchQuery,
  FieldDefinition 
} from '@/types'

interface UseAdvancedFilterProps {
  fields: FieldDefinition[]
  initialFilters?: FilterGroup
  initialSorts?: SortCondition[]
  onChange: (query: AdvancedSearchQuery) => void
}

export const useAdvancedFilter = ({
  fields,
  initialFilters,
  initialSorts = [],
  onChange
}: UseAdvancedFilterProps) => {
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(
    initialFilters || { operator: 'AND', conditions: [], groups: [] }
  )
  const [sorts, setSorts] = useState<SortCondition[]>(initialSorts)

  // 변경 사항 전파
  const emitChange = useCallback((newGroup: FilterGroup, newSorts: SortCondition[]) => {
    onChange({
      filters: newGroup,
      sorts: newSorts
    })
  }, [onChange])

  // 활성 필터 존재 여부 확인
  const hasActiveFilters = useCallback((group: FilterGroup): boolean => {
    const hasConditions = group.conditions && group.conditions.length > 0 && 
      group.conditions.some(c => c.value !== '' && c.value !== null)
    
    const hasNestedFilters = group.groups && group.groups.length > 0 && 
      group.groups.some(g => hasActiveFilters(g))
    
    return Boolean(hasConditions || hasNestedFilters)
  }, [])

  // 필터 조건 추가
  const addCondition = useCallback((group: FilterGroup, groupPath: number[] = []) => {
    const newCondition: FilterCondition = {
      field: fields[0]?.name || '',
      operator: fields[0]?.defaultOperator || 'equals',
      value: '',
      type: fields[0]?.type || 'string'
    }

    const updatedGroup = { ...group }
    let targetGroup = updatedGroup

    // 중첩 그룹 경로 탐색
    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    targetGroup.conditions = [...(targetGroup.conditions || []), newCondition]
    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [fields, sorts, emitChange])

  // 필터 그룹 추가
  const addGroup = useCallback((parentGroup: FilterGroup, groupPath: number[] = []) => {
    const newGroup: FilterGroup = {
      operator: 'AND',
      conditions: [],
      groups: []
    }

    const updatedGroup = { ...parentGroup }
    let targetGroup = updatedGroup

    // 중첩 그룹 경로 탐색
    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    targetGroup.groups = [...(targetGroup.groups || []), newGroup]
    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [sorts, emitChange])

  // 조건 업데이트
  const updateCondition = useCallback((
    conditionIndex: number, 
    updates: Partial<FilterCondition>,
    groupPath: number[] = []
  ) => {
    const updatedGroup = { ...filterGroup }
    let targetGroup = updatedGroup

    // 중첩 그룹 경로 탐색
    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    if (targetGroup.conditions && targetGroup.conditions[conditionIndex]) {
      const currentCondition = targetGroup.conditions[conditionIndex]
      
      // 필드가 변경된 경우 연산자와 값 초기화
      if (updates.field && updates.field !== currentCondition.field) {
        const fieldDef = fields.find(f => f.name === updates.field)
        updates.operator = fieldDef?.defaultOperator || 'equals'
        updates.type = fieldDef?.type || 'string'
        updates.value = ''
      }

      targetGroup.conditions[conditionIndex] = {
        ...currentCondition,
        ...updates
      }
    }

    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [filterGroup, fields, sorts, emitChange])

  // 조건 삭제
  const removeCondition = useCallback((conditionIndex: number, groupPath: number[] = []) => {
    const updatedGroup = { ...filterGroup }
    let targetGroup = updatedGroup

    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    if (targetGroup.conditions) {
      targetGroup.conditions = targetGroup.conditions.filter((_, index) => index !== conditionIndex)
    }

    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [filterGroup, sorts, emitChange])

  // 그룹 삭제
  const removeGroup = useCallback((groupIndex: number, groupPath: number[] = []) => {
    const updatedGroup = { ...filterGroup }
    let targetGroup = updatedGroup

    for (const index of groupPath.slice(0, -1)) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    if (targetGroup.groups) {
      targetGroup.groups = targetGroup.groups.filter((_, index) => index !== groupIndex)
    }

    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [filterGroup, sorts, emitChange])

  // 그룹 연산자 업데이트
  const updateGroupOperator = useCallback((operator: 'AND' | 'OR', groupPath: number[] = []) => {
    const updatedGroup = { ...filterGroup }
    let targetGroup = updatedGroup

    for (const index of groupPath) {
      if (targetGroup.groups && targetGroup.groups[index]) {
        targetGroup = targetGroup.groups[index]
      }
    }

    targetGroup.operator = operator
    setFilterGroup(updatedGroup)
    emitChange(updatedGroup, sorts)
  }, [filterGroup, sorts, emitChange])

  // 정렬 추가
  const addSort = useCallback(() => {
    const newSort: SortCondition = {
      field: fields[0]?.name || '',
      direction: 'desc'
    }
    const newSorts = [...sorts, newSort]
    setSorts(newSorts)
    emitChange(filterGroup, newSorts)
  }, [fields, sorts, filterGroup, emitChange])

  // 정렬 업데이트
  const updateSort = useCallback((index: number, updates: Partial<SortCondition>) => {
    const newSorts = sorts.map((sort, i) => 
      i === index ? { ...sort, ...updates } : sort
    )
    setSorts(newSorts)
    emitChange(filterGroup, newSorts)
  }, [sorts, filterGroup, emitChange])

  // 정렬 삭제
  const removeSort = useCallback((index: number) => {
    const newSorts = sorts.filter((_, i) => i !== index)
    setSorts(newSorts)
    emitChange(filterGroup, newSorts)
  }, [sorts, filterGroup, emitChange])

  // 전체 초기화
  const resetFilters = useCallback(() => {
    const emptyGroup: FilterGroup = { operator: 'AND', conditions: [], groups: [] }
    setFilterGroup(emptyGroup)
    setSorts([])
    emitChange(emptyGroup, [])
  }, [emitChange])

  // 프리셋 로드
  const loadPreset = useCallback((preset: { filters: FilterGroup; sorts: SortCondition[] }) => {
    setFilterGroup(preset.filters)
    setSorts(preset.sorts)
    emitChange(preset.filters, preset.sorts)
  }, [emitChange])

  return {
    // State
    filterGroup,
    sorts,
    
    // Actions
    addCondition,
    addGroup,
    updateCondition,
    removeCondition,
    removeGroup,
    updateGroupOperator,
    addSort,
    updateSort,
    removeSort,
    resetFilters,
    loadPreset,
    
    // Utils
    hasActiveFilters: hasActiveFilters(filterGroup)
  }
}