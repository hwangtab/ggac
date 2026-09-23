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
 * 서버는 이야기를 5만 자에서 **자른다**(`campaignInput.ts`의 `slice`). 저장
 * 뒤 편집기가 서버 응답을 그대로 받아들이므로, 알려 주지 않으면 마지막 문단이
 * 사라진 화면에 "저장했습니다"만 뜬다. 그래서 상한을 두 겹으로 보인다 —
 * 글자 수를 늘 적어 두고, 입력 자체도 `maxLength`로 막아 서버가 자를 일이
 * 애초에 없게 한다. 서버 쪽 상한은 건드리지 않는다.
 *
 * `editScope`가 `'none'`이면 읽기 전용이다 — `all`·`contentOnly`는 둘 다
 * 이야기를 콘텐츠 필드로 취급해 편집을 허용한다(서버 `CONTENT_ONLY_FIELDS`에
 * `story`가 포함됨).
 */
import { useTranslations } from 'next-intl'

import PostContentRenderer from '@/components/PostContentRenderer'

/** 서버(`parseCampaignPatch`의 `story`)가 자르는 길이와 같은 값이다. 여기가
 * 더 크면 잘린 줄 모르고 저장하게 되고, 더 작으면 쓸 수 있는 글을 막는다. */
const STORY_MAX_LENGTH = 50_000

export interface StoryTabProps {
  story: string
  onChange: (story: string) => void
  editScope: 'all' | 'contentOnly' | 'none'
}

export default function StoryTab({ story, onChange, editScope }: StoryTabProps) {
  const t = useTranslations('funding')
  const readOnly = editScope === 'none'
  const atLimit = story.length >= STORY_MAX_LENGTH

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <label htmlFor="story" className="mb-2 block text-sm font-medium text-gray-900">
          {t('creator.story')}
        </label>
        <textarea
          id="story"
          value={story}
          onChange={e => onChange(e.target.value.slice(0, STORY_MAX_LENGTH))}
          maxLength={STORY_MAX_LENGTH}
          disabled={readOnly}
          rows={24}
          className="w-full rounded-lg border border-gray-300 p-3 font-mono text-sm disabled:bg-gray-100 disabled:text-gray-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {t('creator.storyCount', { count: story.length, max: STORY_MAX_LENGTH })}
        </p>
        {atLimit ? (
          <p role="status" aria-live="polite" className="mt-1 text-xs font-medium text-amber-900">
            {t('creator.storyLimitReached')}
          </p>
        ) : null}
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
