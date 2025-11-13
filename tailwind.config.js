/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
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
      fontFamily: {
        sans: ['var(--font-gmarket-sans)', 'system-ui', 'sans-serif'],
        post: ['PeoplefirstFightingTTF', 'sans-serif'],
        serif: ['PeoplefirstFightingTTF', 'serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.5s ease-out',
        float: 'float 6s ease-in-out infinite',
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
      },
      wordBreak: {
        'break-words': 'break-word',
      },
      overflowWrap: {
        'break-words': 'break-word',
      },
      typography: {
        DEFAULT: {
          css: {
            color: '#1f2937',
            maxWidth: 'none',
            // 한글 친화적 설정
            'h1, h2, h3, h4, h5, h6, p, li, td, th': {
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              hyphens: 'none',
            },
            // 헤딩 스타일 - font-post 사용
            h1: {
              color: '#1e3a8a',
              fontFamily: 'PeoplefirstFightingTTF, serif',
              fontWeight: '700',
              fontSize: '2.25rem',
              marginTop: '3rem',
              marginBottom: '1.5rem',
              paddingBottom: '0.75rem',
              borderBottom: '2px solid #bae6fd',
            },
            'h1:first-child': {
              marginTop: '0',
            },
            h2: {
              color: '#075985',
              fontFamily: 'PeoplefirstFightingTTF, serif',
              fontWeight: '600',
              fontSize: '1.875rem',
              marginTop: '2.5rem',
              marginBottom: '1.25rem',
              paddingBottom: '0.5rem',
              borderBottom: '1px solid #bae6fd',
            },
            'h2:first-child': {
              marginTop: '0',
            },
            h3: {
              color: '#0369a1',
              fontFamily: 'PeoplefirstFightingTTF, serif',
              fontWeight: '600',
              fontSize: '1.5rem',
              marginTop: '2rem',
              marginBottom: '1rem',
              paddingBottom: '0.5rem',
              borderBottom: '1px solid #bae6fd',
            },
            'h3:first-child': {
              marginTop: '0',
            },
            h4: {
              color: '#0369a1',
              fontFamily: 'PeoplefirstFightingTTF, serif',
              fontWeight: '600',
              fontSize: '1.25rem',
              marginTop: '1.5rem',
              marginBottom: '0.75rem',
            },
            // 본문 텍스트
            p: {
              color: '#374151',
              lineHeight: '1.65',
            },
            // Quill이 생성하는 <p><br></p> 형태의 빈 줄도 여백 제거
            'p:has(> br:only-child)': {
              marginBottom: '0',
              lineHeight: '0.5rem',
            },
            // 리스트 스타일
            ul: {
              color: '#374151',
              marginTop: '2rem',
              marginBottom: '1.5rem',
              marginLeft: '1rem',
              textAlign: 'left',
            },
            'ul > li': {
              position: 'relative',
              paddingLeft: '1rem',
              marginBottom: '0.5rem',
              textAlign: 'left',
            },
            'ul > li::before': {
              content: '"•"',
              position: 'absolute',
              left: '0',
              color: '#0284c7',
              fontWeight: '600',
            },
            // strong, em 스타일
            strong: {
              color: '#075985',
              fontWeight: '600',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              whiteSpace: 'normal',
            },
            'li strong': {
              color: '#075985',
              fontWeight: '600',
              display: 'inline',
              marginTop: '0',
              marginBottom: '0',
            },
            // p > strong:only-child - 일반 strong과 동일하게 처리
            'p > strong:only-child': {
              display: 'inline',
              fontFamily: "var(--font-gmarket-sans), 'system-ui', sans-serif",
              fontWeight: '600',
              color: '#075985',
            },
            em: {
              color: '#bd5608',
              fontStyle: 'italic',
            },
            // 링크 스타일
            a: {
              color: '#0284c7',
              textDecoration: 'underline',
              textUnderlineOffset: '0.2em',
              textDecorationThickness: '1px',
              '&:hover': {
                color: '#0369a1',
                textUnderlineOffset: '0.25em',
                textDecorationThickness: '1.5px',
              },
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    function ({ addUtilities }) {
      const newUtilities = {
        // 카드 공통 스타일
        '.tw-card-base': {
          '@apply bg-white rounded-2xl shadow-lg overflow-hidden': {},
        },
        '.tw-card-hover': {
          '@apply hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2': {},
        },
        '.tw-card-interactive': {
          '@apply cursor-pointer group': {},
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
          '@apply block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm':
            {},
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
