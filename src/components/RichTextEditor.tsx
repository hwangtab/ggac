'use client';

import React from 'react';
import { QuillEditor } from './QuillEditor';

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  disabled?: boolean;
  height?: number;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = (props) => {
  console.log('[RichTextEditor] QuillEditor로 전환됨');
  
  return <QuillEditor {...props} />;
};

export default RichTextEditor;