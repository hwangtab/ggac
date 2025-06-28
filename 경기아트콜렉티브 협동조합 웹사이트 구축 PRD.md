# 경기아트콜렉티브 협동조합 웹사이트 구축 최종 명세서 (v6.0)

- **문서 버전:** 6.0 (Final)
- **작성일:** 2025년 6월 11일
- **작성자:** 경기아트콜렉티브
- **문서 목적:** 본 문서는 '경기아트콜렉티브 협동조합'의 공식 웹사이트 구축을 위한 모든 기획, 디자인, 기술, 콘텐츠 정보를 담은 최종 명세서입니다. 이 문서 하나만으로 프로젝트의 비전과 요구사항을 완벽히 이해하고 실제 개발을 진행할 수 있도록 작성되었습니다.

---

## 목차

1. [**프로젝트 개요**](https://www.google.com/search?q=%231-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%EA%B0%9C%EC%9A%94)
1.1. [프로젝트 비전: 살아있는 디지털 캔버스](https://www.google.com/search?q=%2311-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%EB%B9%84%EC%A0%84-%EC%82%B4%EC%95%84%EC%9E%88%EB%8A%94-%EB%94%94%EC%A7%80%ED%84%B8-%EC%BA%94%EB%B2%84%EC%8A%A4)
1.2. [핵심 목표](https://www.google.com/search?q=%2312-%ED%95%B5%EC%8B%AC-%EB%AA%A9%ED%91%9C)
2. [**기술 아키텍처 및 워크플로우**](https://www.google.com/search?q=%232-%EA%B8%B0%EC%88%A0-%EC%95%84%ED%82%A4%ED%85%8D%EC%B2%98-%EB%B0%8F-%EC%9B%8C%ED%81%AC%ED%94%8C%EB%A1%9C%EC%9A%B0)
2.1. [핵심 원칙](https://www.google.com/search?q=%2321-%ED%95%B5%EC%8B%AC-%EC%9B%90%EC%B9%99)
2.2. [기술 스택 (Tech Stack)](https://www.google.com/search?q=%2322-%EA%B8%B0%EC%88%A0-%EC%8A%A4%ED%83%9D-tech-stack)
2.3. [데이터 관리 전략: 로컬 JSON](https://www.google.com/search?q=%2323-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EA%B4%80%EB%A6%AC-%EC%A0%84%EB%9E%B5-%EB%A1%9C%EC%BB%AC-json)
2.4. [개발 및 배포 워크플로우 (CI/CD)](https://www.google.com/search?q=%2324-%EA%B0%9C%EB%B0%9C-%EB%B0%8F-%EB%B0%B0%ED%8F%AC-%EC%9B%8C%ED%81%AC%ED%94%8C%EB%A1%9C%EC%9A%B0-cicd)
3. [**데이터 구조 및 콘텐츠 가이드**](https://www.google.com/search?q=%233-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EA%B5%AC%EC%A1%B0-%EB%B0%8F-%EC%BD%98%ED%85%90%EC%B8%A0-%EA%B0%80%EC%9D%B4%EB%93%9C)
3.1. [프로젝트 폴더 구조](https://www.google.com/search?q=%2331-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%ED%8F%B4%EB%8D%94-%EA%B5%AC%EC%A1%B0)
3.2. [JSON 데이터 스키마 정의](https://www.google.com/search?q=%2332-json-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EC%8A%A4%ED%82%A4%EB%A7%88-%EC%A0%95%EC%9D%98)
4. [**페이지별 상세 명세**](https://www.google.com/search?q=%234-%ED%8E%98%EC%9D%B4%EC%A7%80%EB%B3%84-%EC%83%81%EC%84%B8-%EB%AA%85%EC%84%B8)
4.1. [HOME (인트로 페이지)](https://www.google.com/search?q=%2341-home-%EC%9D%B8%ED%8A%B8%EB%A1%9C-%ED%8E%98%EC%9D%B4%EC%A7%80)
4.2. [ABOUT (우리의 이야기)](https://www.google.com/search?q=%2342-about-%EC%9A%B0%EB%A6%AC%EC%9D%98-%EC%9D%B4%EC%95%BC%EA%B8%B0)
4.3. [ARCHIVE (활동의 기록)](https://www.google.com/search?q=%2343-archive-%ED%99%9C%EB%8F%99%EC%9D%98-%EA%B8%B0%EB%A1%9D)
4.4. [ARTISTS (함께하는 사람들)](https://www.google.com/search?q=%2344-artists-%ED%95%A8%EA%BB%98%ED%95%98%EB%8A%94-%EC%82%AC%EB%9E%8C%EB%93%A4)
4.5. [CONNECT (소통과 참여)](https://www.google.com/search?q=%2345-connect-%EC%86%8C%ED%86%B5%EA%B3%BC-%EC%B0%B8%EC%97%AC)
5. [**개발 시작 가이드**](https://www.google.com/search?q=%235-%EA%B0%9C%EB%B0%9C-%EC%8B%9C%EC%9E%91-%EA%B0%80%EC%9D%B4%EB%93%9C)
5.1. [개발 환경 설정](https://www.google.com/search?q=%2351-%EA%B0%9C%EB%B0%9C-%ED%99%98%EA%B2%BD-%EC%84%A4%EC%A0%95)
5.2. [프로젝트 초기화](https://www.google.com/search?q=%2352-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%EC%B4%88%EA%B8%B0%ED%99%94)

---

## 1. 프로젝트 개요

### 1.1. 프로젝트 비전: 살아있는 디지털 캔버스

본 웹사이트는 단순한 정보의 집합이 아닌, 그 자체가 하나의 유기적인 예술 작품입니다. 방문자는 정적인 정보를 소비하는 대신, 조합의 철학과 아티스트의 세계관을 감각적으로 '탐험'하게 됩니다. 정형화된 기업 웹사이트의 문법을 완전히 탈피하여, 사이트의 모든 상호작용에서 창의적 영감을 얻는 것을 목표로 합니다.

**핵심 키워드:** `#실험적인` `#역동적인` `#몰입감` `#비정형` `#아티스트_중심`

### 1.2. 핵심 목표

1. **정체성 확립:** 조합의 창의적이고 수평적인 정체성을 웹사이트 경험을 통해 방문자에게 각인시킨다.
2. **아카이브 가치 제고:** 2025년부터 축적될 조합의 활동 결과물을 단순 나열이 아닌, 몰입감 있는 디지털 콘텐츠로 전시하여 예술적 가치를 높인다.
3. **커뮤니티 활성화:** 웹사이트를 통해 2026년까지 신규 조합원 문의를 현재 대비 50% 이상 증대시키고, 기존 조합원의 소속감을 고취한다.
4. **지속가능성 확보:** 서버 운영 비용과 관리 부담이 없는 서버리스 아키텍처를 구축하여 장기적으로 지속 가능한 디지털 플랫폼을 운영한다.

---

## 2. 기술 아키텍처 및 워크플로우

### 2.1. 핵심 원칙

- **서버리스 (Serverless):** 별도의 서버 운영 및 유지보수 없이 운영하여 비용과 관리 부담을 최소화합니다.
- **정적 우선 (Static First):** 모든 페이지는 사전 렌더링된 정적 파일(HTML)로 제공하여 최고의 성능과 보안을 확보합니다.
- **Git 중심 워크플로우 (Git-centric Workflow):** 코드와 콘텐츠 데이터를 모두 GitHub에서 관리하여 변경 이력을 추적하고 협업 효율을 높입니다.

### 2.2. 기술 스택 (Tech Stack)

| **구분** | **기술** | **상세 설명 및 도입 이유** |
| --- | --- | --- |
| **프레임워크** | **Next.js** | SSG(정적 사이트 생성) 기능을 통해 로컬 데이터를 빌드 시점에 HTML로 완벽하게 렌더링합니다. 이는 압도적인 로딩 속도와 보안성을 제공합니다. |
| **스타일링** | **Tailwind CSS** | 유틸리티 우선 접근법으로 신속하고 일관된 UI 개발을 지원합니다. `tailwind.config.js`를 통해 프로젝트 고유의 비정형 디자인 시스템을 정의합니다. |
| **상태 관리** | **Zustand** | 전역 오디오 플레이어, 메뉴 상태 등 최소한의 전역 상태를 매우 간결한 코드로 관리하기 위해 사용합니다. |
| **애니메이션** | **Framer Motion** | React 환경에 최적화된 라이브러리로, 본 기획안의 핵심인 복잡하고 미려한 인터랙션을 구현합니다. |
| **마크다운 렌더링** | `react-markdown` | JSON 데이터 내부에 포함된 마크다운 텍스트(소개글 등)를 HTML로 안전하게 변환하여 스타일링이 적용된 콘텐츠로 렌더링합니다. |

### 2.3. 데이터 관리 전략: 로컬 JSON

모든 콘텐츠 데이터는 외부 CMS 없이 프로젝트 내 `/data` 디렉토리의 JSON 파일들로 관리합니다.

- **장점:** 완전 무료, 외부 서비스 의존성 없음, 데이터와 코드가 함께 버전 관리됨.
- **단점:** **비개발자가 콘텐츠를 수정하기 매우 어려움.** 모든 텍스트, 이미지 변경은 개발자가 직접 파일을 수정하고 Git에 푸시해야 함. (운영 편의성을 최우선으로 고려한다면 이 부분을 Headless CMS로 전환하는 것을 재고해야 합니다.)

### 2.4. 개발 및 배포 워크플로우 (CI/CD)

콘텐츠 업데이트를 포함한 모든 변경사항은 아래의 자동화된 워크플로우를 따릅니다.

1. **로컬 개발:** 개발자는 `feature` 브랜치를 생성하여 코드 수정 또는 `/data` 폴더 내 JSON 파일 수정을 진행합니다.
2. **변경사항 푸시:** 개발이 완료되면 해당 `feature` 브랜치를 GitHub에 푸시합니다.
3. **Pull Request (PR) 생성:** `develop` 브랜치로 PR을 생성합니다.
4. **자동 프리뷰:** Vercel이 PR을 감지하고, 해당 변경사항이 적용된 **프리뷰(Preview) 사이트를 자동으로 생성**합니다.
5. **검토 및 승인:** 팀원 또는 조합 관계자는 프리뷰 URL을 통해 콘텐츠와 기능이 의도대로 반영되었는지 확인합니다.
6. **프로덕션 배포:** PR이 `main` 브랜치에 최종 병합(Merge)되면, Vercel이 이를 감지하여 **실제 운영 서버에 자동으로 배포**를 진행합니다.

---

## 3. 데이터 구조 및 콘텐츠 가이드

### 3.1. 프로젝트 폴더 구조

`.
├── /components/      # React 컴포넌트
├── /data/            # 콘텐츠 JSON 파일
│   ├── artists.json
│   ├── projects.json
│   └── global.json
├── /pages/           # Next.js 페이지 라우팅
├── /public/          # 정적 파일 (이미지 등)
│   ├── /images/
│   │   ├── /artists/
│   │   └── /projects/
│   └── favicon.ico
└── /styles/          # 전역 CSS`

### 3.2. JSON 데이터 스키마 정의

### `/data/artists.json`

아티스트 정보를 담는 배열(Array)입니다. 각 필드는 아래와 같이 정의됩니다.

- `id`: 고유 식별자 (문자열, 예: "artist-001")
- `slug`: URL 경로로 사용될 고유한 값 (문자열, 예: "kim-min-su")
- `name`: 아티스트 이름/활동명 (문자열)
- `category`: 조합원 유형 (문자열: "창작자" 또는 "기획자")
- `profileImage`: 프로필 이미지 경로 (문자열, 예: "/images/artists/kim-min-su.jpg")
- `oneLiner`: 자신을 표현하는 한 문장 (문자열)
- `bio`: 아티스트 소개 및 작업 노트 (마크다운 형식의 문자열)
- `templateType`: 상세 페이지 템플릿 유형 (문자열: "미니멀형" 또는 "콜라주형")
- `portfolioLinks`: 외부 포트폴리오 링크 배열 (객체 배열: `[{ "title": "SoundCloud", "url": "..." }]`)
- `contact`: 공개할 연락처 (문자열)

*예시:*

JSON

`[
  {
    "id": "artist-001",
    "slug": "kim-min-su",
    "name": "김민수",
    "category": "창작자",
    "profileImage": "/images/artists/kim-min-su.jpg",
    "oneLiner": "도시의 소음을 채집하여 시간의 지도를 그립니다.",
    "bio": "1988년 서울 출생. 소리와 공간의 관계를 탐구하는 사운드 아티스트.\n\n**주요 작업**\n- 《텅 빈 방》 (2024)\n- 《도시의 주파수》 (2023)",
    "templateType": "미니멀형",
    "portfolioLinks": [
      { "title": "SoundCloud", "url": "https://soundcloud.com/kms" },
      { "title": "Instagram", "url": "https://instagram.com/kms_sound" }
    ],
    "contact": "kms.sound@email.com"
  }
]`

### `/data/projects.json`

프로젝트 아카이브 정보를 담는 배열(Array)입니다.

- `id`: 고유 식별자 (문자열)
- `slug`: URL 경로 (문자열)
- `title`: 프로젝트 제목 (문자열)
- `category`: 카테고리 (문자열: "음반·음원", "공연·전시", "예술교육", "지원·용역사업")
- `publishedDate`: 발표일 (문자열, 예: "2025-05-10")
- `coverImage`: 대표 이미지 경로 (문자열)
- `description`: 상세 설명 (마크다운 형식의 문자열)
- `gallery`: 상세 페이지 이미지 갤러리 (문자열 배열)
- `videoUrl`: 관련 영상 URL (문자열)
- `artistIds`: 참여 아티스트 ID 배열 (`artists.json`의 `id`와 연결)

*예시:*

JSON

`[
  {
    "id": "project-001",
    "slug": "seoul-soundscape-2025",
    "title": "서울 사운드스케이프 2025",
    "category": "음반·음원",
    "publishedDate": "2025-05-10",
    "coverImage": "/images/projects/seoul-soundscape-cover.jpg",
    "description": "도시의 다양한 소리를 녹음하여 제작한 앰비언트 앨범입니다. 이 프로젝트는 익숙한 공간을 낯설게 듣는 경험을 통해 장소의 새로운 의미를 발견하고자 합니다. \n\n### 참여 아티스트\n- 김민수\n- 이지은",
    "gallery": [
      "/images/projects/seoul-soundscape-01.jpg",
      "/images/projects/seoul-soundscape-02.jpg"
    ],
    "videoUrl": "https://www.youtube.com/watch?v=....",
    "artistIds": ["artist-001", "artist-002"]
  }
]`

---

## 4. 페이지별 상세 명세

### 4.1. HOME (인트로 페이지)

- **Route:** `/`
- **H1:** `경계 없는 상상, 함께 만드는 울림.`
- **핵심 목표:** 방문자에게 호기심을 유발하고, 사이트의 예술적 정체성을 첫 화면에서 각인시킨다.
- **콘텐츠 & 카피:**
    - 핵심 슬로건 외 텍스트 최소화. 시각적 경험에 집중.
- **아트 디렉션 & UX/UI:**
    - PC 화면 전체를 채우는 영상 콜라주가 배경으로 자동 재생 (사운드 Mute). 영상은 아티스트의 작업 과정, 공연의 순간, 추상적인 텍스처 등을 감각적으로 교차 편집.
    - 마우스 움직임에 반응하는 미세한 파티클 효과 또는 글리치 효과 적용.
    - 스크롤 시 영상 배경이 사라지며, 하단의 콘텐츠 섹션들이 비정형 그리드 레이아웃으로 동적으로 나타남 (`Framer Motion` 활용).
- **기술 구현:**
    - **Data Fetching:** `getStaticProps`에서 `/data`의 JSON 파일들을 읽어 최신 `Project`와 `Artist` 데이터를 일부 가져와 props로 전달.
    - **Components:** `<IntroVideoBg>`, `<HomeProjectGrid>`, `<HomeArtistScroller>` 등.
    - **애니메이션:** `Framer Motion`의 `useScroll`, `useTransform` 훅을 사용하여 스크롤에 따른 정교한 시차(Parallax) 효과 구현.

### 4.2. ABOUT (우리의 이야기)

- **Route:** `/about`
- **H1:** `우리는 예술로 숨 쉬고, 협동으로 길을 냅니다.`
- **핵심 목표:** 조합의 설립 목적과 철학, 연혁을 하나의 이야기처럼 감성적으로 전달.
- **콘텐츠 & 카피:**
    - **설립 목적 (정관 제2조 기반):** "경기도의 모든 스튜디오와 무대, 작업실에서 고유한 빛을 발하는 예술가들이 있습니다. 우리는 그 빛이 외로이 흔들리지 않도록, 창작의 여정이 지치지 않도록 서로의 손을 잡습니다. 경기아트콜렉티브 협동조합은 예술 활동의 지속가능성을 함께 도모하고, 나아가 우리가 발 딛고 선 지역의 문화예술 생태계를 더욱 풍요롭게 가꾸기 위해 존재합니다. 이곳은 우리의 권익을 지키는 울타리이자, 새로운 실험을 격려하는 광장입니다."
    - **이사장 메시지 (이사장: 최희철):** "동료 예술가들에게. 안녕하세요, 경기아트콜렉티브 협동조합 이사장 최희철입니다. '혼자'라는 단어가 주는 막막함을 누구보다 잘 압니다. 우리의 만남이 그 막막함 속에 따뜻한 길 하나를 내주리라 믿습니다. 이곳에서는 당신의 성공뿐만 아니라 실패와 고민까지도 소중한 자산이 됩니다. 주저하지 말고 당신의 목소리를 들려주세요. 우리는 언제나 귀 기울일 준비가 되어있습니다."
    - **연혁:** "시간의 흔적" (2025.05.01 설립신고, 2025.05.14 법인성립)
- **아트 디렉션 & UX/UI:**
    - 수평 스크롤 UI를 적용하여 연혁 섹션을 탐험하는 경험 제공.
    - 임원 소개 시, 작업실에서 촬영한 예술적인 프로필 사진을 사용. 호버 시 사진이 흑백에서 컬러로 전환.
- **기술 구현:**
    - **Data Fetching:** `getStaticProps`로 페이지 콘텐츠를 정적 생성. `team.json`과 같은 별도 파일을 두어 임원 정보를 관리.
    - **수평 스크롤:** CSS `overflow-x: scroll`과 `scroll-snap` 속성, 또는 `Framer Motion`을 활용하여 구현.

### 4.3. ARCHIVE (활동의 기록)

- **Route:** `/archive` | `/archive/[slug]`
- **H1:** `활동의 기록, 영감의 조각들`
- **핵심 목표:** 조합의 핵심 결과물을 다각도로 감상할 수 있는 몰입형 디지털 전시 공간.
- **콘텐츠 & 카피:**
    - **인트로:** "이곳은 우리의 땀과 열정이 빚어낸 결과물들이 살아 숨 쉬는 공간입니다. 하나의 목소리가 아닌, 여러 빛깔의 목소리가 모여 만든 하모니를 감상해 보세요. 스쳐 가는 이미지, 귓가를 맴도는 멜로디 속에서 우리의 다음을 상상할 수 있을지도 모릅니다."
    - **필터:** `[ All / 음반·음원 / 공연·전시 / 예술교육 / 지원·용역사업 ]`
- **아트 디렉션 & UX/UI:**
    - 메이서너리(Masonry) 레이아웃으로 프로젝트 썸네일 배치.
    - 필터링 시, 선택되지 않은 아이템은 사라지지 않고 투명도(opacity)가 낮아지는 부드러운 애니메이션 적용 (`Framer Motion`의 `AnimatePresence` 활용).
    - 음악 프로젝트 상세 페이지: 페이지 이동과 관계없이 음악이 계속 재생되는 하단 고정형 오디오 플레이어 구현.
- **기술 구현:**
    - **Data Fetching:**
        - `/archive`: `getStaticProps`에서 `/data/projects.json` 파일 전체를 읽어와 props로 전달. `artistIds`를 이용해 `artists.json`에서 아티스트 이름을 찾아 함께 전달.
        - `/archive/[slug]`: `getStaticPaths`는 `projects.json`의 모든 `slug`를 기반으로 경로를 생성. `getStaticProps`는 `context.params.slug`를 사용해 특정 프로젝트 데이터만 필터링하여 props로 전달.
    - **Components:** `<ProjectFilter>`, `<ProjectCard>`, `<PersistentAudioPlayer>` (Zustand로 상태 관리).

### 4.4. ARTISTS (함께하는 사람들)

- **Route:** `/artists` | `/artists/[slug]`
- **H1:** `서로의 우주가 되어`
- **핵심 목표:** 각 조합원을 독립된 아티스트로서 존중하고, 방문자가 그들의 세계를 깊이 있게 탐험하도록 유도.
- **콘텐츠 & 카피:**
    - **인트로:** "경기아트콜렉티브는 독립된 예술가들의 섬이 아닌, 서로가 서로에게 영감이 되고 지지가 되어주는 연결된 우주입니다. 이곳에서 각자의 빛으로 반짝이는 우리의 동료들을 만나보세요. 그들의 작업과 고민, 그리고 꿈이 담긴 작은 세계를 여행할 수 있습니다."
    - **필터:** `[ All / 창작자 / 기획자 ]`
- **아트 디렉션 & UX/UI:**
    - 아티스트 프로필 사진들을 캔버스 위에 크고 작게 자유롭게 배치. 마우스 움직임에 따라 시차(Parallax) 효과 적용.
    - 아티스트 상세 페이지는 JSON 데이터의 `templateType` 값에 따라 `미니멀형` 또는 `콜라주형` 레이아웃으로 렌더링.
- **기술 구현:**
    - **Data Fetching:** Archive 페이지와 동일한 원리로, `/data/artists.json` 파일을 사용하여 리스트 페이지와 상세 페이지를 정적 생성.
    - **Components:** `<ArtistCanvas>`, `<ArtistDetailPage templateType={artist.templateType} />`

### 4.5. CONNECT (소통과 참여)

- **Route:** `/connect`
- **H1:** `당신의 참여로 새로운 물결이 시작됩니다.`
- **핵심 목표:** 조합의 소식을 알리고, 새로운 동료와 후원자의 참여를 외부 폼으로 자연스럽게 연결.
- **콘텐츠 & 카피:**
    - **가입 안내:** "함께 흐를까요?"
        - **자격:** "경기도에 거주하거나 활동하는 예술가, 문화예술 기획 및 제작 활동을 하는 분, 조합의 취지에 동의하고 지원하고자 하는 모든 분들을 기다립니다."
        - **약속:** "출자금: 조합원이 되기 위해 최소 1좌(10,000원) 이상의 출자가 필요합니다. 출자금은 조합의 소중한 자본금이 되며, 탈퇴 시 정관에 따라 환급됩니다." , "월 회비: 조합 운영을 위해 월 10,000원의 회비가 있습니다. (이사회 의결로 조정 가능)"
        - **CTA:** `[ 동료 되기 (신청서 작성하기) ]`
    - **후원 안내:** "예술의 씨앗에 물을 주세요"
        - **CTA:** `[ 예술 생태계 가꾸기 (후원 문의하기) ]`
- **기술 구현:**
    - **Data Fetching:** `/data/posts.json`과 `/data/global.json` 파일을 읽어와 콘텐츠를 렌더링.
    - **폼 연동:** CTA 버튼은 `<a>` 태그로 구현. `href` 속성에는 `/data/global.json`에 정의된 `joinFormUrl`, `supportFormUrl` 값을 바인딩. `target="_blank"` 속성으로 새 탭에서 열리도록 함.

---

## 5. 개발 시작 가이드

### 5.1. 개발 환경 설정

1. **계정 준비**: GitHub, Vercel, Google 계정.
2. **소프트웨어 설치**: Node.js (LTS 버전) 및 Git.

### 5.2. 프로젝트 초기화

1. **저장소 복제**: `git clone [GitHub Repository URL]`
2. **의존성 설치**: `cd [project-folder]` 후 `npm install` 또는 `yarn` 실행.
3. **데이터 디렉토리 생성**: 프로젝트 루트에 `/data` 폴더와 `/public/images` 폴더를 생성하고, 초기 JSON 파일과 이미지들을 위치시킵니다.
4. **로컬 서버 실행**: `npm run dev` 또는 `yarn dev` 명령어로 개발 서버를 시작합니다.
5. **개발 시작**: `http://localhost:3000` 에서 실시간으로 변경사항을 확인하며 개발을 진행합니다.