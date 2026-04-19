<p align="center">
  <a href="./README.md">中文</a> |
  <a href="./README.en.md">English</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a>
</p>

# CloudOps Platform v2.0

> Kubernetes ベースのクラウドネイティブインテリジェント運用管理プラットフォーム。コンテナ運用と AI アシスタントをワンストップで提供するソリューションです。

[![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?logo=go)](https://golang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Gin](https://img.shields.io/badge/Gin-1.9+-008ECF?logo=go)](https://gin-gonic.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15+-4169E1?logo=postgresql)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7+-DC382D?logo=redis)](https://redis.io)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## プロジェクト概要

CloudOps Platform は、マルチクラスタ Kubernetes 環境向けのクラウドネイティブ運用管理プラットフォームです。クラスタ管理、リソース巡回検査、ネットワークトレーシング、データダッシュボード、Web ターミナル、および AI スマート Q&A 機能を統合し、企業の K8s 運用複雑度を低減し、障害排查効率を向上させます。

### 主な機能

- **マルチクラスタ管理**：20 以上の K8s クラスタを統合管理。Kubeconfig / Token デュアル認証方式をサポート
- **リソースパノラマビュー**：ノード、Pod、Deployment、Service、Ingress、Storage、RBAC などのリソースをワンストップで管理
- **巡回検査センター**：自動化された巡回検査タスクのスケジューリング。レポート生成と AI 深層分析をサポート
- **ネットワークトレーシング**：eBPF/Flannel ベースのトラフィックトポロジ可視化。tcpdump パケットキャプチャと AI 診断をサポート
- **AI インテリジェントアシスタント**：OpenClaw / Ollama マルチモデルプラットフォームと連携。SSE ストリーミング対話、Markdown リアルタイムレンダリング、画像認識、マルチセッション永続化、ワンクリック最下部スクロールをサポート。`react-virtuoso` 仮想スクロールで長対話のパフォーマンスを最適化
- **ログ管理**：クラスタあたりマルチバックエンドアーキテクチャ（ES / OpenSearch / Loki の同時接続をサポート）。シナリオベースのログ検索（Ingress / CoreDNS / LB / 全ログ）をサポート。キーワードハイライト、レベル統計、時間分布グラフ、および AI インテリジェント分析を提供
- **グローバルリソース検索**：クロスクラスタの K8s リソースリアルタイムあいまい検索。リソースタイプ、クラスタ、Namespace、ラベルによる多次元フィルタリングをサポート。結果にラベルを表示
- **システムカスタマイゼーション**：システム設定でプラットフォーム名、説明、Logo を動的に変更可能。保存後、サイト全体でホットリロードが有効化
- **Web ターミナル**：ブラウザ内から Pod コンテナターミナルに直接アクセス
- **マルチテナント分離**：RBAC ベースのユーザ・ロール・権限システム。テナントレベルのリソース分離をサポート

---

## 技術スタック

| 層 | 技術選定 | バージョン |
|------|----------|------|
| バックエンド | Golang + Gin | 1.21+ |
| フロントエンド | React + Vite + TypeScript | 18.x |
| UI コンポーネントライブラリ | Material-UI (MUI) | 5.x |
| 状態管理 | TanStack Query | 5.x |
| K8s クライアント | client-go / informer | latest |
| データベース | PostgreSQL | 15+ |
| キャッシュ | Redis | 7+ |
| AI プラットフォーム | OpenClaw / Ollama | OpenAI-compatible |

---

## ディレクトリ構成

```
cloudops-v2/
├── cmd/server/              # Go バックエンドエントリポイント
├── internal/
│   ├── api/handlers/        # HTTP ハンドラ層
│   ├── api/middleware/      # JWT 認証などのミドルウェア
│   ├── api/routes.go        # ルート登録
│   ├── model/               # GORM データモデル
│   ├── pkg/
│   │   ├── ai/              # AI プロバイダ抽象化（OpenClaw / Ollama）
│   │   ├── auth/            # JWT 認証
│   │   ├── config/          # Viper 設定管理
│   │   ├── crypto/          # AES-256 暗号化
│   │   ├── database/        # GORM 初期化とマイグレーション
│   │   ├── k8s/             # K8s クライアントラッパー
│   │   └── redis/           # Redis クライアントラッパー
│   └── service/             # ビジネスロジック層
├── frontend/                # React フロントエンドプロジェクト
│   ├── src/pages/           # ページコンポーネント
│   ├── src/components/      # 共通コンポーネント
│   └── src/lib/             # API リクエストラッパー
├── ai-service/              # Python AI サービス（拡張予約）
├── config/
│   └── config.yaml          # メイン設定ファイル
├── data/                    # ランタイムデータ（AI 設定など）
├── docs/                    # プロジェクトドキュメント
├── docker/                  # Docker ビルドスクリプト
├── k8s/                     # Kubernetes デプロイメントマニフェスト
└── scripts/                 # O&M スクリプト
```

---

## クイックスタート

### 1. 動作環境

- Go 1.21+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+（オプション；AI タスクポーリングに必要）

### 2. クローンと初期化

```bash
git clone https://github.com/As9530272755/CloudOps-AI.git
cd CloudOps-AI
```

### 3. バックエンドの起動

```bash
# Go 依存関係のインストール
go mod download

# ビルド
go build -o cloudops-backend ./cmd/server

# 起動（デフォルトで config/config.yaml を読み込み）
./cloudops-backend
```

バックエンドは `http://0.0.0.0:9000` で待ち受けます

### 4. フロントエンドの起動

```bash
cd frontend
npm install

# 開発モード
npm run dev

# プロダクションプレビュー
npm run build
npm run preview
```

フロントエンドのデフォルトアクセス先：`http://0.0.0.0:18000`

### 5. デフォルトアカウント

| ユーザ名 | パスワード |
|--------|------|
| admin  | admin |

---

## 主要機能のスクリーンショット（準備中）

- ダッシュボード
- クラスタ管理
- AI アシスタント（Markdown レンダリング + 画像アップロード）
- ログ分析
- ネットワークトレーシングトポロジ

---

## ドキュメント

| ドキュメント | 説明 |
|------|------|
| [docs/installation.md](docs/installation.md) | 完全なインストールとデプロイガイド |
| [docs/architecture.md](docs/architecture.md) | システムアーキテクチャと技術選定 |
| [docs/api.md](docs/api.md) | RESTful API ドキュメント |
| [docs/ai-integration.md](docs/ai-integration.md) | AI プラットフォーム連携と設定説明 |
| [docs/quickstart.md](docs/quickstart.md) | 5 分間クイックスタートガイド |

---

## コントリビューションとフィードバック

Issue や PR の提出を歓迎します。ご質問があれば、プロジェクトメンテナーまでお問い合わせください。

## ライセンス

[MIT](LICENSE)
