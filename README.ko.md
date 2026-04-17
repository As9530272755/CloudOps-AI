<p align="center">
  <a href="./README.md">中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a>
</p>

# CloudOps Platform v2.0

> Kubernetes 기반의 클라우드 네이티브 지능형 운영 관리 플랫폼으로, 원스톱 컨테이너 운영 및 AI 어시스턴트 솔루션을 제공합니다.

[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Gin](https://img.shields.io/badge/Gin-1.9+-008ECF?logo=go)](https://gin-gonic.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D?logo=redis)](https://redis.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 프로젝트 소개

CloudOps Platform은 멀티 클러스터 Kubernetes 환경을 위한 클라우드 네이티브 운영 관리 플랫폼입니다. 클러스터 관리, 리소스 순회 검사, 네트워크 추적, 데이터 대시보드, Web 터미널, AI 지능형 Q&A 기능을 통합하여 기업의 K8s 운영 복잡도를 낮추고 장애排查 효율성을 향상시킵니다.

### 핵심 기능

- **멀티 클러스터 관리**: 20개 이상의 K8s 클러스터를 통합 관리. Kubeconfig / Token 이중 인증 방식 지원
- **리소스 파노라마 뷰**: 노드, Pod, Deployment, Service, Ingress, Storage, RBAC 등의 리소스를 원스톱으로 관리
- **순회 검사 센터**: 자동화된 순회 검사 작업 스케줄링. 보고서 생성 및 AI 심층 분석 지원
- **네트워크 추적**: eBPF/Flannel 기반 트래픽 토폴로지 시각화. tcpdump 패킷 캡처 및 AI 진단 지원
- **AI 지능형 어시스턴트**: OpenClaw / Ollama 멀티 모델 플랫폼과 연동. SSE 스트리밍 대화, Markdown 실시간 렌더링, 이미지 인식, 멀티 세션 지속성, 원클릭 맨 아래로 스크롤 지원. `react-virtuoso` 가상 스크롤로 긴 대화의 성능을 최적화
- **로그 관리**: 클러스터당 멀티 백엔드 아키텍처(ES / OpenSearch / Loki 동시 연결 지원). 시나리오 기반 로그 검색(Ingress / CoreDNS / LB / 전체 로그) 지원. 키워드 하이라이트, 레벨 통계, 시간 분포 차트, AI 지능형 분석 제공
- **글로벌 리소스 검색**: 크로스 클러스터 K8s 리소스 실시간 퍼지 검색. 리소스 유형, 클러스터, Namespace, 레이블로 다차원 필터링 지원. 결과에 레이블 표시
- **시스템 커스터마이제이션**: 시스템 설정에서 플랫폼 이름, 설명, Logo를 동적으로 변경 가능. 저장 후 전 사이트 핫 리로드 활성화
- **Web 터미널**: 브라우저 내에서 Pod 컨테이너 터미널에 직접 접속
- **멀티 테넌트 분리**: RBAC 기반의 사용자·역할·권한 시스템. 테넌트 수준의 리소스 분리 지원

---

## 기술 스택

| 레이어 | 기술 선택 | 버전 |
|------|----------|------|
| 백엔드 | Golang + Gin | 1.21+ |
| 프론트엔드 | React + Vite + TypeScript | 18.x |
| UI 컴포넌트 라이브러리 | Material-UI (MUI) | 5.x |
| 상태 관리 | TanStack Query | 5.x |
| K8s 클라이언트 | client-go / informer | latest |
| 데이터베이스 | PostgreSQL / SQLite | 15+ |
| 캐시 | Redis | 7+ |
| AI 플랫폼 | OpenClaw / Ollama | OpenAI-compatible |

---

## 디렉터리 구조

```
cloudops-v2/
├── cmd/server/              # Go 백엔드 진입점
├── internal/
│   ├── api/handlers/        # HTTP 핸들러 레이어
│   ├── api/middleware/      # JWT 인증 등 미들웨어
│   ├── api/routes.go        # 라우트 등록
│   ├── model/               # GORM 데이터 모델
│   ├── pkg/
│   │   ├── ai/              # AI 공급자 추상화(OpenClaw / Ollama)
│   │   ├── auth/            # JWT 인증
│   │   ├── config/          # Viper 설정 관리
│   │   ├── crypto/          # AES-256 암호화
│   │   ├── database/        # GORM 초기화 및 마이그레이션
│   │   ├── k8s/             # K8s 클라이언트 래퍼
│   │   └── redis/           # Redis 클라이언트 래퍼
│   └── service/             # 비즈니스 로직 레이어
├── frontend/                # React 프론트엔드 프로젝트
│   ├── src/pages/           # 페이지 컴포넌트
│   ├── src/components/      # 공통 컴포넌트
│   └── src/lib/             # API 요청 래퍼
├── ai-service/              # Python AI 서비스(확장 예약)
├── config/
│   └── config.yaml          # 메인 설정 파일
├── data/                    # 런타임 데이터(AI 설정 등)
├── docs/                    # 프로젝트 문서
├── docker/                  # Docker 빌드 스크립트
├── k8s/                     # Kubernetes 배포 매니페스트
└── scripts/                 # O&M 스크립트
```

---

## 빠른 시작

### 1. 환경 요구사항

- Go 1.21+
- Node.js 18+
- PostgreSQL 15+（개발 모드에서는 SQLite로 대체 가능）
- Redis 7+（선택 사항；AI 작업 폧링에 필요）

### 2. 클론 및 초기화

```bash
git clone https://github.com/As9530272755/CloudOps-AI.git
cd CloudOps-AI
```

### 3. 백엔드 시작

```bash
# Go 종속성 설치
go mod download

# 빌드
go build -o cloudops-backend ./cmd/server

# 시작（기본적으로 config/config.yaml 읽기）
./cloudops-backend
```

백엔드는 `http://0.0.0.0:9000` 에서 대기합니다

### 4. 프론트엔드 시작

```bash
cd frontend
npm install

# 개발 모드
npm run dev

# 프로덕션 프리뷰
npm run build
npm run preview
```

프론트엔드 기본 접속 주소：`http://0.0.0.0:18000`

### 5. 기본 계정

| 사용자명 | 비밀번호 |
|--------|------|
| admin  | admin |

---

## 주요 기능 스크린샷(준비 중)

- 대시보드
- 클러스터 관리
- AI 어시스턴트（Markdown 렌더링 + 이미지 업로드）
- 로그 분석
- 네트워크 추적 토폴로지

---

## 문서 안내

| 문서 | 설명 |
|------|------|
| [docs/installation.md](docs/installation.md) | 완전한 설치 및 배포 가이드 |
| [docs/architecture.md](docs/architecture.md) | 시스템 아키텍처 및 기술 선정 |
| [docs/api.md](docs/api.md) | RESTful API 문서 |
| [docs/ai-integration.md](docs/ai-integration.md) | AI 플랫폼 연동 및 설정 안내 |
| [docs/quickstart.md](docs/quickstart.md) | 5분 퀵스타트 가이드 |

---

## 기여 및 피드백

Issue 및 PR 제출을 환영합니다. 질문이 있으시면 프로젝트 메인테이너에게 문의해 주세요.

## 라이선스

[MIT](LICENSE)
