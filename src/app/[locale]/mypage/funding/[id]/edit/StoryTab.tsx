'use client'

/**
 * 스토리 탭 — 마크다운 편집과 실시간 미리보기.
 *
 * 이야기는 마크다운으로 저장된다. 공개 상세(`src/app/[locale]/funding/[slug]/page.tsx`)가
 * `<PostContentRenderer content={campaign.story} contentFormat="markdown" />`로
 * 그리므로, 미리보기도 **같은 컴포넌트를 같은 방식으로** 호출한다 — 여기서
 * 다르게 보이면 공개 화면에서도 다르게 보인다는 뜻이다. HTML 에디터(Quill 등)를
 * 붙이지 않는다 — 저장 형식이 마크다운이 아니게 되면 공개 화면에 원문이
 * 그대로 노출된다. sanitize는 `PostContentRenderer`/`sanitizePostHtml`이
 * 전담한다 — 여기서 별도 sanitizer를 들이지 않는다(jsdom 계열 sanitizer는
 * 과거 SSR을 깬 전력이 있다).
 *
 * 껍데기(`page.tsx`)가 `story` 상태를 소유하고 여기 내려보낸다 — 이 탭은
 * 언마운트되지 않고 `hidden`으로만 감춰지므로(탭 전환 시 입력 보존), 값은
 * 항상 props로 받고 변경은 `onChange`로만 올린다(제어 컴포넌트).
 *
 * `editScope`가 `'none'`이면 읽기 전용이다 — `all`·`contentOnly`는 둘 다
 * 이야기를 콘텐츠 필드로 취급해 편집을 허용한다(서버 `CONTENT_ONLY_FIELDS`에
 * `story`가 포함됨).
 */
import { useTranslations } from 'next-intl'

import PostContentRenderer from '@/components/PostContentRenderer'

export interface StoryTabProps {
  story: string
  onChange: (story: string) => void
  editScope: 'all' | 'contentOnly' | 'none'
}

export default function StoryTab({ story, onChange, editScope }: StoryTabProps) {
  const t = useTranslations('funding')
  const readOnly = editScope === 'none'

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <label htmlFor="story" className="mb-2 block text-sm font-medium text-gray-900">
          {t('creator.story')}
        </label>
        <textarea
          id="story"
          value={story}
          onChange={e => onChange(e.target.value)}
          disabled={readOnly}
          rows={24}
          className="w-full rounded-lg border border-gray-300 p-3 font-mono text-sm disabled:bg-gray-100 disabled:text-gray-500"
        />
        <p className="mt-1 text-xs text-gray-500">{t('creator.storyHelp')}</p>
      </div>

      <div>
        <p className="mb-2 block text-sm font-medium text-gray-900">{t('creator.preview')}</p>
        {/* 공개 화면과 같은 렌더러·같은 props다 — 여기서 다르게 보이면 공개
            화면에서도 다르게 보인다. */}
        <div className="min-h-[24rem] rounded-xl border border-gray-200 bg-white p-6">
          {story.trim() === '' ? (
            <p className="text-sm text-gray-500">{t('creator.previewEmpty')}</p>
          ) : (
            <PostContentRenderer content={story} contentFormat="markdown" />
          )}
        </div>
      </div>
    </div>
  )
}
