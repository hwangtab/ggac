'use client'

import React from 'react'
import { FiTrash2, FiPlus } from 'react-icons/fi'
import type { SortCondition, FieldDefinition } from '@/types'

interface SortConditionEditorProps {
  sorts: SortCondition[]
  fields: FieldDefinition[]
  onAdd: () => void
  onUpdate: (index: number, updates: Partial<SortCondition>) => void
  onRemove: (index: number) => void
}

export const SortConditionEditor: React.FC<SortConditionEditorProps> = ({
  sorts,
  fields,
  onAdd,
  onUpdate,
  onRemove
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-900">정렬 조건</h4>
        <button
          onClick={onAdd}
          className="flex items-center px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
        >
          <FiPlus className="w-4 h-4 mr-1" />
          정렬 추가
        </button>
      </div>

      {sorts.length === 0 ? (
        <div className="text-center py-4 text-gray-500 text-sm">
          정렬 조건이 없습니다.
        </div>
      ) : (
        <div className="space-y-2">
          {sorts.map((sort, index) => (
            <div key={index} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
              {/* 우선순위 */}
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-sm font-medium">
                {index + 1}
              </div>

              {/* 필드 선택 */}
              <div className="flex-1">
                <select
                  value={sort.field}
                  onChange={(e) => onUpdate(index, { field: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {fields.map(field => (
                    <option key={field.name} value={field.name}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 방향 선택 */}
              <div className="flex-1">
                <select
                  value={sort.direction}
                  onChange={(e) => onUpdate(index, { direction: e.target.value as 'asc' | 'desc' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="desc">내림차순 (높은 값부터)</option>
                  <option value="asc">오름차순 (낮은 값부터)</option>
                </select>
              </div>

              {/* 삭제 버튼 */}
              <button
                onClick={() => onRemove(index)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="정렬 조건 삭제"
              >
                <FiTrash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {sorts.length > 1 && (
        <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
          <strong>정렬 우선순위:</strong> 위에서부터 차례대로 적용됩니다. 
          첫 번째 조건이 같은 경우 두 번째 조건으로 정렬됩니다.
        </div>
      )}
    </div>
  )
}