# 경기아트콜렉티브 협동조합 웹사이트 (gac-website)

## 프로젝트 개요

이 프로젝트는 경기아트콜렉티브 협동조합의 공식 웹사이트입니다. Next.js와
TypeScript를 기반으로 구축되었으며, Vercel을 통해 배포됩니다. 웹사이트는 조합의
활동, 소속 아티스트, 프로젝트 아카이브 등을 소개하는 역할을 합니다.

## 기술 스택

- **프레임워크:** Next.js 14
- **언어:** TypeScript
- **스타일링:** Tailwind CSS
- **상태 관리:** Zustand
- **마크다운 처리:** react-markdown
- **이미지 최적화:** sharp
- **린팅:** ESLint
- **배포:** Vercel

## 주요 파일 및 디렉토리

- **`src/app`**: 애플리케이션의 라우팅 및 핵심 UI가 정의된 곳입니다 (App
  Router).
- **`src/components`**: 재사용 가능한 React 컴포넌트들이 위치합니다.
- **`src/lib/data.ts`**: `data` 디렉토리의 JSON 파일들을 읽고 처리하는 함수가
  포함되어 있습니다.
- **`data`**: 아티스트, 프로젝트 등 웹사이트의 주요 데이터를 담고 있는 JSON
  파일들이 위치합니다.
- **`public`**: 이미지, 폰트 등 정적 에셋이 저장되어 있습니다.
- **`scripts`**: 이미지 변환 등 개발에 필요한 유틸리티 스크립트가 있습니다.
- **`next.config.js`**: Next.js 관련 설정 파일입니다.
- **`tailwind.config.js`**: Tailwind CSS 설정 파일입니다.

## 주요 명령어

- **`npm run dev`**: 개발 서버를 실행합니다.
- **`npm run build`**: 프로덕션용으로 애플리케이션을 빌드합니다.
- **`npm run start`**: 빌드된 애플리케이션을 실행합니다.
- **`npm run lint`**: ESLint를 사용하여 코드 스타일을 검사하고 수정합니다.

## 현재 개발 현황

- **조합원 가입 및 인증 시스템 안정화**: Supabase를 이용한 조합원 가입, 인증,
  정보 관리 기능 구현을 완료하고 안정화했습니다.
  - 신규 회원 가입 시 `auth.users`와 `public.member_profiles` 테이블 간의 데이터
    동기화 문제를 해결했습니다.
  - 순환 종속성 및 권한 문제를 해결하기 위해 RLS(Row Level Security) 정책을
    재정비하여 보안을 강화했습니다.
  - 현재 조합원 가입부터 관리자 승인, 게시판 활동까지의 핵심 기능이 정상적으로
    작동합니다.

## 개발 컨벤션

- **데이터 관리**: 모든 주요 데이터는 `data/*.json` 파일에 정의하고,
  `src/lib/data.ts`를 통해 불러와 사용합니다.
- **이미지**: `public/images`에 이미지를 저장하며, `scripts/convert-images.js`를
  사용하여 WebP로 변환 및 최적화하는 것을 권장합니다.
- **컴포넌트**: 재사용 가능한 UI 요소는 `src/components` 디렉토리 내에
  모듈화하여 작성합니다.
