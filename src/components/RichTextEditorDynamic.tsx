'use client'

/**
 * RichTextEditor를 SSR 없이 lazy 로딩하는 공통 wrapper.
 * 여러 곳에서 동일한 dynamic import 코드가 중복되지 않도록 한 곳으로 통합한다.
 */

import dynamic from 'next/dynamic'

const RichTextEditorDynamic = dynamic(() => import('./RichTextEditor'), {
  ssr: false,
  loading: () => <div className="h-96 bg-gray-100 rounded-lg animate-pulse" />,
})

export default RichTextEditorDynamic
