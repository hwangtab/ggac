/**
 * 이사회 업무툴 색 토큰 — 원본(kosmart-work) globals.css `@theme inline`의 v3 짝.
 * 값은 `src/work/styles.css`가 `[data-work-app]` 범위에서 CSS 변수(포스터 팔레트 hex·rgba)로 정한다.
 * `bg-primary/10` 같은 불투명도 수식을 살리려고 color-mix로 감싼다(<alpha-value>를 Tailwind가 채운다).
 * 공개 사이트는 이 이름(bg-background·text-muted-foreground·bg-primary(숫자 없음) …)을 하나도 쓰지 않는다.
 */
const wc = name => `color-mix(in oklch, var(--${name}) calc(<alpha-value> * 100%), transparent)`
const workColors = {
  background: wc('background'),
  foreground: wc('foreground'),
  card: { DEFAULT: wc('card'), foreground: wc('card-foreground') },
  popover: { DEFAULT: wc('popover'), foreground: wc('popover-foreground') },
  primary: { DEFAULT: wc('primary'), foreground: wc('primary-foreground') },
  secondary: { DEFAULT: wc('secondary'), foreground: wc('secondary-foreground') },
  muted: { DEFAULT: wc('muted'), foreground: wc('muted-foreground') },
  accent: { DEFAULT: wc('accent'), foreground: wc('accent-foreground') },
  destructive: { DEFAULT: wc('destructive') },
  border: wc('border'),
  input: wc('input'),
  ring: wc('ring'),
  sidebar: {
    DEFAULT: wc('sidebar'),
    foreground: wc('sidebar-foreground'),
    primary: wc('sidebar-primary'),
    'primary-foreground': wc('sidebar-primary-foreground'),
    accent: wc('sidebar-accent'),
    'accent-foreground': wc('sidebar-accent-foreground'),
    border: wc('sidebar-border'),
    ring: wc('sidebar-ring'),
  },
  // 일반 안 읽음 = 굵은 글자(`text-unread`) + 작은 앰버 점(`bg-unread-dot`) — 03-통합-재설계 §8-4
  unread: { DEFAULT: wc('unread'), dot: wc('unread-dot') },
  mention: {
    DEFAULT: wc('mention'),
    solid: wc('mention-solid'),
    'solid-foreground': wc('mention-solid-foreground'),
  },
  online: wc('online'),
  highlight: { DEFAULT: wc('highlight'), foreground: wc('highlight-foreground') },
}

/**
 * 원본이 쓰던 v4 전용 변형을 v3에 다시 정의한다.
 * - `pointer-coarse:` — 원본 globals.css의 터치 변형
 * - `data-open:` 등 — shadcn `tailwind.css`의 `@custom-variant`(data-state 와 불리언 data 속성 둘 다 받는다)
 */
const workVariants = function ({ addVariant }) {
  addVariant('pointer-coarse', '@media (pointer: coarse)')
  const either = (state, attr) => [
    `&:where([data-state="${state}"])`,
    `&:where([data-${attr}]:not([data-${attr}="false"]))`,
  ]
  addVariant('data-open', either('open', 'open'))
  addVariant('data-closed', either('closed', 'closed'))
  addVariant('data-checked', either('checked', 'checked'))
  addVariant('data-unchecked', either('unchecked', 'unchecked'))
  addVariant('data-active', either('active', 'active'))
  addVariant('data-selected', '&:where([data-selected="true"])')
  addVariant('data-disabled', [
    '&:where([data-disabled="true"])',
    '&:where([data-disabled]:not([data-disabled="false"]))',
  ])
  addVariant('data-horizontal', '&:where([data-orientation="horizontal"])')
  addVariant('data-vertical', '&:where([data-orientation="vertical"])')
}

/**
 * 원본 tw-animate-css(v4)의 열고 닫는 애니메이션(`animate-in fade-in-0 zoom-in-95 slide-in-from-top-2` …)의 v3 짝.
 * v3용 `tailwindcss-animate`를 쓰지 않는 이유: 그 플러그인은 `duration-*`·`ease-*`에 animation 속성을 덧붙이고
 * `paused`·`running`·`animate-in`을 전역 클래스로 만든다 — 공개 사이트에 이미 그런 문자열이 있어 동작이 바뀐다.
 * 그래서 업무툴 전용 `wa-` 접두사로 따로 둔다. 키프레임은 `src/work/styles.css`(`wa-enter`·`wa-exit`).
 * port-from-kosmart.mjs가 `animate-in` → `wa-in`, `fade-in-0` → `wa-fade-in-0`처럼 바꾼다.
 */
const workAnimations = function ({ addUtilities, matchUtilities, theme }) {
  addUtilities({
    '.wa-in': {
      animationName: 'wa-enter',
      animationDuration: '150ms',
      '--tw-enter-opacity': 'initial',
      '--tw-enter-scale': 'initial',
      '--tw-enter-translate-x': 'initial',
      '--tw-enter-translate-y': 'initial',
    },
    '.wa-out': {
      animationName: 'wa-exit',
      animationDuration: '150ms',
      '--tw-exit-opacity': 'initial',
      '--tw-exit-scale': 'initial',
      '--tw-exit-translate-x': 'initial',
      '--tw-exit-translate-y': 'initial',
    },
  })
  const neg = v => (String(v).startsWith('-') ? String(v).slice(1) : `-${v}`)
  matchUtilities(
    {
      'wa-fade-in': v => ({ '--tw-enter-opacity': v }),
      'wa-fade-out': v => ({ '--tw-exit-opacity': v }),
    },
    { values: theme('opacity') }
  )
  matchUtilities(
    {
      'wa-zoom-in': v => ({ '--tw-enter-scale': v }),
      'wa-zoom-out': v => ({ '--tw-exit-scale': v }),
    },
    { values: theme('scale') }
  )
  matchUtilities(
    {
      'wa-slide-in-from-top': v => ({ '--tw-enter-translate-y': neg(v) }),
      'wa-slide-in-from-bottom': v => ({ '--tw-enter-translate-y': v }),
      'wa-slide-in-from-left': v => ({ '--tw-enter-translate-x': neg(v) }),
      'wa-slide-in-from-right': v => ({ '--tw-enter-translate-x': v }),
      'wa-slide-out-to-top': v => ({ '--tw-exit-translate-y': neg(v) }),
      'wa-slide-out-to-bottom': v => ({ '--tw-exit-translate-y': v }),
      'wa-slide-out-to-left': v => ({ '--tw-exit-translate-x': neg(v) }),
      'wa-slide-out-to-right': v => ({ '--tw-exit-translate-x': v }),
    },
    { values: theme('translate') }
  )
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // 이사회 업무툴(kosmart-work 이식) — docs/board-work/01-설계.md §9
    './src/work/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // 업무툴은 포스터 다크 한 벌만 쓴다(src/work/styles.css) — 테마 전환이 없으므로 `dark:` 변형은 **절대 켜지지
  // 않게** 둔다. 이 키를 지우면 v3 기본값 'media'가 되어 OS 다크에서 업무툴에 남은 `dark:` 클래스가 다시 켜진다.
  // `data-work-dark-disabled` 속성을 다는 요소는 없다. 공개 사이트는 `dark:`를 0건 쓴다.
  darkMode: ['selector', '[data-work-dark-disabled]'],
  theme: {
    extend: {
      colors: {
        ...workColors,
        primary: {
          ...workColors.primary,
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        accent: {
          ...workColors.accent,
          50: '#fef7ee',
          100: '#fdedd3',
          200: '#fbd9a5',
          300: '#f8bf6d',
          400: '#f59e33',
          500: '#f3850b',
          600: '#e46f06',
          700: '#bd5608',
          800: '#97450e',
          900: '#7c3a0f',
        },
      },
      // Tailwind 기본 보더색은 gray-200이라 색 지정 없는 `border` 클래스가
      // 다크 배경 위에서 밝은 회색 선으로 남는다. 헤어라인으로 바꾼다.
      borderColor: {
        DEFAULT: 'rgba(255, 255, 255, 0.15)',
      },
      // 업무툴 반경(원본 @theme의 --radius 배수 — --radius가 포스터 2px라 1.2~5.2px). ggac 전역 rounded-lg 등과
      // 섞이지 않게 `w-` 접두사 —
      // 옮길 때 port-from-kosmart.mjs가 rounded-lg → rounded-w-lg로 바꾼다.
      borderRadius: {
        'w-sm': 'calc(var(--radius) * 0.6)',
        'w-md': 'calc(var(--radius) * 0.8)',
        'w-lg': 'var(--radius)',
        'w-xl': 'calc(var(--radius) * 1.4)',
        'w-2xl': 'calc(var(--radius) * 1.8)',
        'w-3xl': 'calc(var(--radius) * 2.2)',
        'w-4xl': 'calc(var(--radius) * 2.6)',
      },
      // 업무툴 레이아웃 폭(원본 브리프 §5)
      spacing: {
        rail: '64px',
        sidebar: '260px',
        panel: '360px',
      },
      fontFamily: {
        heading: ['var(--font-pretendard)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-pretendard)', 'system-ui', 'sans-serif'],
        post: ['var(--font-pretendard-black)', 'sans-serif'],
        serif: ['var(--font-pretendard-black)', 'serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.5s ease-out',
        float: 'float 6s ease-in-out infinite',
        // 0~8% 구간 opacity 0으로 고정해 ~150ms 이내 빠른 라우트에서는 사실상 깜빡이지 않음
        'brand-loader': 'brandLoader 1.8s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        brandLoader: {
          '0%, 8%': { opacity: '0', transform: 'scale(0.96)' },
          '25%': { opacity: '1', transform: 'scale(1)' },
          '60%': { opacity: '0.55', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      wordBreak: {
        'break-words': 'break-word',
      },
      overflowWrap: {
        'break-words': 'break-word',
      },
      // @tailwindcss/typography는 기본 동작이 충분하다고 판단해 대부분의 커스텀을
      // 제거. 브랜드 아이덴티티(헤딩/strong/em 색상)만 색 오버라이드로 유지하고
      // 나머지(margin, fontSize, list-style, fontFamily 등)는 플러그인 기본값.
      // word-break: keep-all 등 한글 처리는 globals.css :where(body) layer가 담당.
      typography: {
        DEFAULT: {
          css: {
            maxWidth: 'none',
            'h1, h2': { color: '#075985' },
            h1: { color: '#1e3a8a' },
            h3: { color: '#0369a1' },
            h4: { color: '#0369a1' },
            strong: { color: '#075985' },
            em: { color: '#bd5608' },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    // 업무툴용: 컨테이너 쿼리(@lg: 등), 원본 변형(pointer-coarse·shadcn data-*), 열고 닫는 애니메이션(wa-*)
    require('@tailwindcss/container-queries'),
    workVariants,
    workAnimations,
    function ({ addUtilities }) {
      const newUtilities = {
        // 카드 공통 스타일
        '.tw-card-base': {
          '@apply bg-white rounded-2xl shadow-lg overflow-hidden': {},
        },
        '.tw-card-hover': {
          '@apply hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2': {},
        },

        // 버튼 공통 스타일
        '.tw-btn-primary': {
          '@apply bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg font-medium transition-colors duration-200':
            {},
        },
        '.tw-btn-secondary': {
          '@apply bg-gray-100 text-gray-700 hover:bg-gray-200 px-4 py-2 rounded-lg font-medium transition-colors duration-200':
            {},
        },
        '.tw-btn-accent': {
          '@apply bg-accent-500 text-white hover:bg-accent-600 px-4 py-2 rounded-full font-medium transition-colors duration-200':
            {},
        },

        // 카테고리 배지 스타일
        '.tw-badge-primary': {
          '@apply inline-block px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full':
            {},
        },
        '.tw-badge-secondary': {
          '@apply inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full':
            {},
        },
        '.tw-badge-accent': {
          '@apply inline-block px-3 py-1 bg-accent-100 text-accent-700 text-sm font-medium rounded-full':
            {},
        },

        // 텍스트 공통 스타일
        '.tw-heading-primary': {
          '@apply text-4xl md:text-5xl lg:text-6xl font-serif font-bold text-gray-900': {},
        },
        '.tw-heading-secondary': {
          '@apply text-2xl md:text-3xl lg:text-4xl font-serif font-semibold text-primary-800': {},
        },
        '.tw-heading-tertiary': {
          '@apply text-xl md:text-2xl font-serif font-semibold text-primary-700': {},
        },
        '.tw-heading-quaternary': {
          '@apply text-lg font-serif font-medium text-primary-600': {},
        },
        '.tw-text-body': {
          '@apply text-base md:text-lg leading-relaxed': {},
        },

        // 컨테이너 스타일
        '.tw-container-custom': {
          '@apply max-w-7xl mx-auto px-4 sm:px-6 lg:px-8': {},
        },

        // 그리드 공통 패턴
        '.tw-grid-cards': {
          '@apply grid sm:grid-cols-2 lg:grid-cols-3 gap-8': {},
        },
        '.tw-grid-artists': {
          '@apply grid sm:grid-cols-2 lg:grid-cols-3 gap-12': {},
        },

        // 이미지 오버레이
        '.tw-image-overlay': {
          '@apply absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300':
            {},
        },

        // 로딩 상태
        '.tw-loading-skeleton': {
          '@apply animate-pulse bg-gray-200 rounded': {},
        },

        // 폼 스타일
        '.tw-form-input': {
          '@apply block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm':
            {},
        },
        '.tw-form-textarea': {
          '@apply tw-form-input': {},
        },
        '.tw-form-select': {
          '@apply block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 pr-8 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm':
            {},
        },
      }

      addUtilities(newUtilities)
    },
  ],
}
