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
        }
      },
      fontFamily: {
        sans: ['var(--font-pretendard)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-noto-serif-kr)', 'serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'float': 'float 6s ease-in-out infinite',
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
        }
      },
      wordBreak: {
        'break-words': 'break-word'
      },
      overflowWrap: {
        'break-words': 'break-word'
      }
    },
  },
  plugins: [
    function({ addUtilities }) {
      const newUtilities = {
        // 카드 공통 스타일
        '.card-base': {
          '@apply bg-white rounded-2xl shadow-lg overflow-hidden': {},
        },
        '.card-hover': {
          '@apply hover:shadow-xl transition-all duration-300 transform hover:-translate-y-2': {},
        },
        '.card-interactive': {
          '@apply cursor-pointer group': {},
        },
        
        // 버튼 공통 스타일
        '.btn-primary': {
          '@apply bg-primary-600 text-white hover:bg-primary-700 px-4 py-2 rounded-lg font-medium transition-colors duration-200': {},
        },
        '.btn-secondary': {
          '@apply bg-gray-100 text-gray-700 hover:bg-gray-200 px-4 py-2 rounded-lg font-medium transition-colors duration-200': {},
        },
        '.btn-accent': {
          '@apply bg-accent-500 text-white hover:bg-accent-600 px-4 py-2 rounded-full font-medium transition-colors duration-200': {},
        },
        
        // 카테고리 배지 스타일
        '.badge-primary': {
          '@apply inline-block px-3 py-1 bg-primary-100 text-primary-700 text-sm font-medium rounded-full': {},
        },
        '.badge-secondary': {
          '@apply inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full': {},
        },
        '.badge-accent': {
          '@apply inline-block px-3 py-1 bg-accent-100 text-accent-700 text-sm font-medium rounded-full': {},
        },
        
        // 텍스트 공통 스타일
        '.heading-primary': {
          '@apply text-4xl md:text-5xl lg:text-6xl font-serif font-bold': {},
        },
        '.heading-secondary': {
          '@apply text-2xl md:text-3xl lg:text-4xl font-serif font-semibold': {},
        },
        '.text-body': {
          '@apply text-base md:text-lg leading-relaxed': {},
        },
        
        // 컨테이너 스타일
        '.container-custom': {
          '@apply max-w-7xl mx-auto px-4 sm:px-6 lg:px-8': {},
        },
        
        // 그리드 공통 패턴
        '.grid-cards': {
          '@apply grid sm:grid-cols-2 lg:grid-cols-3 gap-8': {},
        },
        '.grid-artists': {
          '@apply grid sm:grid-cols-2 lg:grid-cols-3 gap-12': {},
        },
        
        // 이미지 오버레이
        '.image-overlay': {
          '@apply absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors duration-300': {},
        },
        
        // 로딩 상태
        '.loading-skeleton': {
          '@apply animate-pulse bg-gray-200 rounded': {},
        },
        
        // 폼 스타일
        '.form-input': {
          '@apply block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm': {},
        },
        '.form-textarea': {
          '@apply block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm': {},
        },
        '.form-select': {
          '@apply block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 pr-8 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm': {},
        }
      }
      
      addUtilities(newUtilities)
    }
  ],
}
