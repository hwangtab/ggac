### 웹 프론트엔드 코드 리뷰 보고서

이 문서는 웹사이트의 폰트, CSS, WYSIWYG 에디터, 마크다운 렌더링 관련 코드의
문제점을 분석하고 개선 방안을 제안합니다.

**요약:** 현재 코드베이스는 기능적으로 동작하지만, 여러 영역에서 코드 중복과
임시방편적인 해결책이 발견되었습니다. 이로 인해 유지보수성이 저하되고 잠재적인
버그 발생 가능성이 있습니다. 핵심 개선 사항은 **스타일 소스를 일원화**하고
**불안정한 초기화 로직을 개선**하는 것입니다.

---

### 1. 폰트 (Fonts)

- **현황:**
  - **Gmarket Sans:** `next/font/local`을 통해 효율적으로 로드되며,
    `tailwind.config.js`에 CSS 변수(`--font-gmarket-sans`)로 잘 통합되어
    있습니다.
  - **PeoplefirstFightingTTF:** `src/app/globals.css`의 `@font-face` 규칙을 통해
    전역으로 로드됩니다. 이 폰트는 `tailwind.config.js`의 `typography` 설정에서
    헤딩(`h1`, `h2` 등) 스타일에 사용됩니다.

- **문제점:**
  - **일관성 부족:** 두 가지 다른 방식(`next/font`와 전역 CSS)으로 폰트를
    로드하고 있어 일관성이 부족합니다. `next/font`는 폰트 파일을 자동으로
    최적화하고 CLS(Cumulative Layout Shift)를 방지하는 등 성능상 이점이
    있습니다.

- **개선 제안:**
  - **폰트 로딩 방식 일원화:** `PeoplefirstFightingTTF` 폰트도
    `next/font/local`을 사용하여 로드하도록 변경하는 것을 권장합니다.

    ```tsx
    // 예시: src/app/layout.tsx 또는 관련 컴포넌트
    import localFont from 'next/font/local'

    const gmarketSans = localFont({ ... });
    const peoplefirstFighting = localFont({
      src: '../../public/fonts/PeoplefirstFightingTTF.ttf',
      variable: '--font-peoplefirst-fighting',
      display: 'swap',
    });

    // tailwind.config.js 에서는 'var(--font-peoplefirst-fighting)'를 사용
    ```

---

### 2. CSS 및 스타일링

- **현황:**
  - 스타일링의 핵심은 Tailwind CSS이며, `@tailwindcss/typography` 플러그인을
    사용하여 컨텐츠(마크다운, WYSIWYG 결과물) 스타일을 관리합니다.

- **문제점:**
  - **스타일 정의 중복:** `tailwind.config.js`의 `typography` 설정과
    `src/styles/editor-content.css` 파일의 내용이 거의 동일하게 중복되어
    있습니다.
    - 이는 Quill 에디터 내부 스타일(`.editor-content`)과 마크다운 렌더링
      결과물(`.prose`)의 스타일을 일치시키기 위한 시도로 보이지만, 유지보수성을
      심각하게 저해합니다.
    - 스타일 변경 시 두 곳을 모두 수정해야 하며, 이로 인해 불일치가 발생하기
      쉽습니다.

- **개선 제안:**
  - **스타일 소스 일원화:** `editor-content.css`를 삭제하고, Quill 에디터가
    `@tailwindcss/typography`의 `prose` 클래스를 직접 사용하도록 리팩토링합니다.
    - `QuillEditor.tsx`에서 `editorRoot.classList.add('editor-content')` 대신
      `editorRoot.classList.add('prose', 'max-w-none')`을 사용하도록 수정합니다.
    - 이렇게 하면 `tailwind.config.js`의 `typography` 설정 하나로 모든 컨텐츠
      스타일을 중앙에서 관리할 수 있습니다.

---

### 3. WYSIWYG 에디터 (Quill)

- **현황:**
  - `react-quill-new` 라이브러리를 `next/dynamic`을 통해 비동기적으로 로드하여
    사용합니다.
  - 이미지 업로드 및 삽입 기능이 커스텀 핸들러로 구현되어 있습니다.

- **문제점:**
  - **임시방편적인(Hacky) 코드:**
    1.  `useEffect`와 `requestAnimationFrame`을 사용하여 에디터의 DOM이 렌더링될
        때까지 기다린 후 CSS 클래스를 주입하는 방식은 불안정하며, 에디터 로딩
        속도나 환경에 따라 실패할 수 있습니다.
    2.  `waitForQuillEditor` 함수에서 `sleep`과 `while` 루프를 사용하여 에디터
        인스턴스를 기다리는 것 또한 타이밍 문제에 의존하는 임시방편적인
        해결책입니다.
  - **로직과 뷰의 강한 결합:** 이미지 업로드와 관련된 모든 로직(파일 검증, API
    호출, 상태 관리)이 `QuillEditor.tsx` 컴포넌트 내에 있어 재사용이 어렵고
    컴포넌트가 비대합니다.

- **개선 제안:**
  - **안정적인 초기화 로직:** `react-quill` 라이브러리가 제공하는 콜백 함수(예:
    `onEditor`)를 사용하여 에디터 인스턴스가 준비되었을 때 스타일 클래스를
    적용하는 것이 더 안정적입니다. (라이브러리 문서 확인 필요)
  - **로직 분리:** 이미지 업로드 로직을 별도의 커스텀 훅(예:
    `useImageUpload`)이나 서비스 모듈(`src/lib/media.ts`)로 분리하여 컴포넌트의
    책임을 줄이고 테스트 용이성을 높입니다.

---

### 4. 마크다운 렌더링

- **현황:**
  - 마크다운 렌더링을 위한 특정 컴포넌트는 아직 확인되지 않았지만, 렌더링된
    HTML은 `@tailwindcss/typography` 플러그인에 의해 `prose` 클래스로 스타일링될
    것으로 예상됩니다.

- **문제점:**
  - 위에서 언급했듯이, `prose` 스타일과 `editor-content` 스타일이 중복 정의되어
    있어, 마크다운 렌더링 결과물과 Quill 에디터에서 보이는 모습이 미세하게
    달라질 가능성이 있습니다.

- **개선 제안:**
  - CSS 스타일 소스를 일원화하면 이 문제가 자연스럽게 해결됩니다. 마크다운
    렌더링 컨테이너에 `prose` 클래스를 적용하여 `tailwind.config.js`에서 정의된
    단일 스타일 소스를 따르도록 합니다.
