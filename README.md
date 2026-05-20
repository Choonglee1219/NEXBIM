# OpenBIM Oracle Viewer

이 프로젝트는 **OpenBIM Components**와 **Oracle Database**를 기반으로 구축된 웹 기반 BIM(Building Information Modeling) 뷰어 및 협업 플랫폼입니다. IFC 모델의 업로드, 시각화, 속성 관리, 그리고 BCF(BIM Collaboration Format)를 통한 이슈 관리 및 간섭 체크(Clash Detection) 기능을 제공합니다.

## 🚀 주요 기능

*   **IFC & Fragment 모델 뷰어**: `.ifc` 및 `.frag` (최적화된 형상 포맷) 파일의 로드 및 3D 시각화.
*   **데이터베이스 연동**: Oracle Database를 사용하여 모델 파일(BLOB) 및 메타데이터 저장/로드.
*   **BCF 이슈 관리 (BCF Topics)**:
    *   이슈 생성, 수정, 삭제.
    *   뷰포트(카메라 위치, 선택된 객체, 색상) 저장 및 복원.
    *   BCF 파일(`.bcf`) 가져오기/내보내기 및 DB 저장.
    *   N:N 관계를 통해 하나의 BCF 이슈를 여러 IFC 모델에 연결.
*   **간섭 체크 (Clash Detection)**:
    *   **클라이언트 측 간섭 검토**: 오픈소스 프로젝트 **ClashControl.io**의 로직을 참고하여 자체 컴포넌트로 구현하였으며, 외부 서버에 의존하지 않고 브라우저 내에서 모델 간 또는 모델 자체의 간섭을 분석합니다.
    *   Web Worker를 활용하여 UI 멈춤 없는 백그라운드 연산을 수행합니다.
    *   발견된 간섭 결과를 테이블로 확인하고, 3D 뷰에서 즉시 위치를 확인하거나 BCF 이슈로 생성할 수 있습니다.
*   **프로퍼티 관리 (Properties Manager)**: IFC 객체의 속성 조회 및 수정.
*   **공간구조 트리 (Spatial Tree)**: 모델의 공간 구조(층, 실 등) 탐색.
*   **쿼리 빌더 (Query Builder)**: 조건에 맞는 객체 검색 및 강조.

## 🛠 기술 스택

### Frontend
*   **Language**: TypeScript
*   **Library**: That Open Company (OpenBIM Components)
    *   `@thatopen/components`: 코어 BIM 로직.
    *   `@thatopen/ui`: UI 컴포넌트 (Lit 기반).
    *   `@thatopen/components-front`: 프론트엔드 전용 기능.
*   **3D Engine**: Three.js
*   **Build Tool**: Vite

### Backend
*   **Runtime**: Node.js
*   **Framework**: Express.js
*   **Database Driver**: `oracledb` (Oracle Database Node.js Driver)
*   **File Handling**: Multer (메모리 스토리지 사용)

### Database
*   **DBMS**: Oracle Database

## ⚙️ 설치 및 설정 (Setup)

### 1. 데이터베이스 설정 (Oracle DB)

프로젝트 루트의 `src/SQL-worksheet.sql` 파일을 사용하여 필요한 테이블을 생성합니다.

```sql
-- 주요 테이블: ifc, frag, bcf, ifc_bcf (관계 테이블)
-- SQL-worksheet.sql의 내용을 Oracle 데이터베이스에서 실행하세요.
```

### 2. 백엔드 설정 (`src/app.ts`)

`src/app.ts` 파일에서 Oracle DB 연결 정보 및 서버 IP를 환경에 맞게 수정하세요.

### 3. 의존성 설치

```bash
npm install
```

## ▶️ 실행 방법 (Usage)

이 프로젝트는 `concurrently` 패키지를 사용하여 프론트엔드와 백엔드를 하나의 명령어로 동시에 실행합니다.

### 1. 개발 서버 실행

백엔드 서버와 프론트엔드(Vite) 개발 서버를 동시에 실행합니다.

```bash
npm run dev
```

### 2. 프로젝트 빌드

TypeScript 소스 코드를 컴파일하고 프론트엔드 리소스를 빌드합니다. 
주의: src/app.ts 등 백엔드 코드가 수정된 경우, 변경 사항을 반영하려면 다시 빌드해야 합니다.

```bash
npm run build
```

## 🔧 설정 상세 (Configuration Details)

### `vite.config.ts` (Vite 설정)
*   **API Proxy**: 개발 서버 실행 시 `/api`로 시작하는 요청을 백엔드 서버(`http://${서버IP}:3001`)로 프록시(Proxy)하여 CORS 문제를 방지합니다.
*   **Build**: `top-level-await`를 지원하도록 설정되어 있어, 비동기 모듈 로딩이 가능합니다.

### `tsconfig.json` (TypeScript 설정)
*   **Target**: `ES2022`를 타겟으로 하여 최신 ECMAScript 기능을 활용합니다.
*   **Decorators**: `experimentalDecorators` 및 `emitDecoratorMetadata`가 활성화되어 있어 데코레이터 문법을 지원합니다.

### `vite-env.d.ts`
*   Vite의 클라이언트 타입 정의(`vite/client`)를 참조하여 정적 에셋 가져오기 및 환경 변수에 대한 타입 지원을 제공합니다.

## 📂 프로젝트 구조

*   `src/`
    *   `app.ts`: 백엔드 Express 서버 및 API 엔드포인트.
    *   `main.ts`: 프론트엔드 진입점, 뷰어 초기화.
    *   `globals.ts`: 전역 상수, 아이콘, 사용자 정보 정의.
    *   `bim-components/`: 커스텀 BIM 컴포넌트 (BCF, IFC, Fragment 관리).
    *   `setup/`: 뷰어 초기화 및 설정 로직 (Finders, Templaters).
    *   `ui-components/`: 재사용 가능한 UI 컴포넌트.
    *   `ui-templates/`: UI 레이아웃 및 패널 템플릿.
    *   `markdown/`: 마크다운 처리 관련 유틸리티.
    *   `SQL-worksheet.sql`: 데이터베이스 DDL 스크립트.


Special Thanks to ThatOpen Company.