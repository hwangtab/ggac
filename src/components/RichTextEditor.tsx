'use client'

import React from 'react'
import { QuillEditor } from './QuillEditor'

interface RichTextEditorProps {
  value: string
  onChange: (content: string) => void
  placeholder?: string
  disabled?: boolean
  height?: number
}

export const RichTextEditor: React.FC<RichTextEditorProps> = React.memo(props => {
  // console.log('[RichTextEditor] QuillEditor로 전환됨'); // 로그 제거로 콘솔 스팸 방지

  return <QuillEditor {...props} />
})

RichTextEditor.displayName = 'RichTextEditor'

export default RichTextEditor
