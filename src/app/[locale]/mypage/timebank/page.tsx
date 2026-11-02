import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import MypageLayout from '../components/MypageLayout'
import TimebankGate from '@/components/timebank/TimebankGate'
import {
  TIMEBANK_KIND_STYLES,
  TIMEBANK_STATUS_STYLES,
  formatTimebankDate,
} from '@/components/timebank/timebankFormat'
import { resolveTimebankViewer } from '@/lib/server/timebankPage'
import { listTimebankListings, listVolunteeredTasks } from '@/db/queries/timebankBoard'
import { createLogger } from '@/utils/logger'
import MyTimebank from './MyTimebank'
import ProfilePanel from './ProfilePanel'

// 회원 본인의 화면이다 — 공용 캐시에 남지 않게 정적화하지 않는다. 마이페이지
// 허브(`../page.tsx`)는 정적으로 남고, 그 카드(`TimebankSummaryCard`)는 클라이언트 섬이다.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = createLogger('mypageTimebank')

/** "내 글" 영역에 싣는 글 수. 전체는 게시판의 "내 글" 필터로 간다. */
const MY_POSTS_LIMIT = 10

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'timebank' })
  return { title: t('my.title'), robots: { index: false, follow: false } }
}

/**
 * 내 타임 관리(스펙 §8) — 잔액, 확인 대기, 기록하기, 되돌리기, 내역(채널·월 필터·월
 * 합계·CSV), 내 글, 프로필, 동의. 교환권·교환소·장터 시간 거래(1-B)는 아직 없다.
 *
 * 진입 판정은 게시판과 같은 `resolveTimebankViewer`다(비로그인 → 로그인, 미승인 →
 * 게이트). 읽기는 꺼짐·미동의여도 열고, 쓰기 단추만 참여 자격(`access === 'ok'`)에
 * 따른다. 미동의·구판이면 게이트 배너가 이용규칙 전문과 동의 단추를 함께 그린다.
 */
export default async function MyTimebankPage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('timebank')

  const viewer = await resolveTimebankViewer(locale, '/mypage/timebank')
  if (viewer.kind !== 'member') return <TimebankGate state="unapproved" />

  const canWrite = viewer.access === 'ok'

  let myPosts: Awaited<ReturnType<typeof listTimebankListings>>['rows'] = []
  let volunteered: Awaited<ReturnType<typeof listVolunteeredTasks>> = []
  try {
    ;[{ rows: myPosts }, volunteered] = await Promise.all([
      listTimebankListings({ authorId: viewer.userId, offset: 0, limit: MY_POSTS_LIMIT }),
      listVolunteeredTasks(viewer.userId, MY_POSTS_LIMIT),
    ])
  } catch (error) {
    log.error('내 타임뱅크 글 조회 실패', { error: (error as Error)?.message })
  }

  const needsAgreement = viewer.agreedVersion !== viewer.termsVersion

  return (
    <MypageLayout title={t('my.title')} description={t('my.description')}>
      {viewer.access !== 'ok' && (
        <TimebankGate
          state={viewer.access}
          variant="banner"
          termsVersion={viewer.termsVersion}
          agreedVersion={viewer.agreedVersion}
          showAgreement
        />
      )}

      <MyTimebank canWrite={canWrite} />

      <section aria-labelledby="tb-posts-heading" className="mt-10" data-testid="timebank-my-posts">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="tb-posts-heading" className="text-lg font-semibold text-gray-900">
            {t('my.posts.heading')}
          </h2>
          <div className="flex gap-3 text-sm">
            <Link
              href={{ pathname: '/board/timebank', query: { mine: '1' } }}
              className="text-primary-600 hover:underline"
            >
              {t('my.posts.viewAll')}
            </Link>
            {canWrite && (
              <Link href="/board/timebank/new" className="text-primary-600 hover:underline">
                {t('write')}
              </Link>
            )}
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700">{t('my.posts.mine')}</h3>
            {myPosts.length === 0 ? (
              <p className="text-sm text-gray-500">{t('my.posts.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {myPosts.map(post => (
                  <li key={post.id}>
                    <Link
                      href={`/board/timebank/${post.id}`}
                      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 p-3 text-sm hover:border-primary-300"
                    >
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${TIMEBANK_KIND_STYLES[post.kind]}`}
                      >
                        {t(`kind.${post.kind}`)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${TIMEBANK_STATUS_STYLES[post.status]}`}
                      >
                        {t(`status.${post.status}`)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-800">{post.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-gray-700">{t('my.posts.volunteered')}</h3>
            {volunteered.length === 0 ? (
              <p className="text-sm text-gray-500">{t('my.posts.emptyVolunteered')}</p>
            ) : (
              <ul className="space-y-2">
                {volunteered.map(task => (
                  <li key={task.id}>
                    <Link
                      href={`/board/timebank/${task.id}`}
                      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 p-3 text-sm hover:border-primary-300"
                    >
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${TIMEBANK_STATUS_STYLES[task.status]}`}
                      >
                        {t(`status.${task.status}`)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-800">{task.title}</span>
                      {task.task_date && (
                        <span className="text-xs text-gray-500">{task.task_date}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className="mt-10">
        <ProfilePanel canEdit={canWrite} />
      </div>

      <section
        aria-labelledby="tb-agreement-heading"
        className="mt-10"
        data-testid="timebank-agreement"
      >
        <h2 id="tb-agreement-heading" className="mb-2 text-lg font-semibold text-gray-900">
          {t('my.agreement.heading')}
        </h2>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-gray-500">{t('my.agreement.current')}</dt>
          <dd className="text-gray-900">{viewer.termsVersion}</dd>
          <dt className="text-gray-500">{t('my.agreement.agreed')}</dt>
          <dd className="text-gray-900">
            {viewer.agreedVersion
              ? t('my.agreement.agreedValue', {
                  version: viewer.agreedVersion,
                  date: formatTimebankDate(viewer.agreedAt),
                })
              : t('my.agreement.none')}
          </dd>
        </dl>
        {needsAgreement && (
          <p className="mt-2 text-sm text-amber-800">
            {viewer.access === 'not_agreed' || viewer.access === 'terms_outdated'
              ? t('my.agreement.needsAgreement')
              : t('my.agreement.unavailable')}
          </p>
        )}
      </section>
    </MypageLayout>
  )
}
