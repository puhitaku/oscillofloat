# 000-first のプラン（質問への回答反映済み）

2026-10-26。`000-first.md` を読んで立てたプランに、質問への回答を反映したもの。
実装の正は `README.md`（仕様・API）と `AGENTS.md`（ルール）で、本書は経緯の記録。

## 質問と回答

| 質問 | 回答 |
| --- | --- |
| 管理者の初回ログインと Passkey 登録 | 仮パスワード方式。招待メールの仮パスワードで `/admin` にサインインし、必須のパスワード変更はフロントが長いランダム値を自動生成して済ませ、そのまま Passkey 登録へ進む。以後は Passkey のみ。 |
| ACM 証明書の DNS 検証レコード | CloudFormation（us-east-1 の証明書スタック）に HostedZoneId を渡し、検証用 CNAME を自動作成させる。A レコード本体は awscli。 |
| 描画キャンバスの形 | 内部データは 1:1（[-1, 1] の正方形）で汎用性を確保。Admin がアスペクト比を設定でき、既定は 5:4。フロントはアス比に応じた上下の keep-out 帯を避けて描かせる。oscilloshape は受け取ったデータの幅を自分の表示幅に等倍スケールするだけ。 |
| 送信成功後のキャンバス | 残す。 |

## 構成

- リージョンは ap-northeast-1、CloudFront 1 配信にオリジン 2 つ。既定は S3（Vue SPA、OAC で非公開）、`/ws` と `/api/*` は EC2（HTTP、8080、SG は CloudFront のマネージドプレフィックスリストのみ許可）。
- EC2 は t4g.nano + Elastic IP、Amazon Linux 2023 arm64。Go は pure Go（SQLite は modernc）で linux/arm64 にクロスビルドし、S3 経由で配布、SSM で更新と操作。SSH 鍵は使わない。
- SQLite は Litestream が監督し、awscli で事前作成した S3 バケットへ複製。起動時にレプリカから復元。
- ACM 証明書は us-east-1 の別スタック。
- DNS、DB バケット、Cognito 管理者ユーザー、ビルドのデプロイは `scripts/*.sh`（awscli）。デプロイ固有の値は `deploy.env`（git 管理外）とスタックパラメータに切り出す。
- フロントは Cognito の ID 群やアス比を `GET /api/config` から実行時に取得する。
- 月額はおおよそ $8（t4g.nano、IPv4、EBS、CloudFront と Cognito は無料枠内）。

## API

- `/ws` は読み取り専用で Origin 制限なし。サーバー→ `added`（絵本体つき）、`removed`（ID のみ）、`list`・`drawings`（応答）、`error`。クライアント→ `list`、`get {ids}`。CloudFront のアイドル切断対策で 20 秒ごとに ping。
- 変更系は REST: `POST /api/drawings`、`DELETE /api/drawings`（`X-Session-Id` で自分の分）、`GET/DELETE /api/admin/drawings`、`PUT /api/admin/settings`（Cognito ID トークンを Bearer で検証）。
- セッション ID はブラウザが生成して localStorage に保持。アップロードは点数・パス数・座標範囲を検証し、IP ごとにレート制限。

## フロント

- Vue 3 + Pinia + Tailwind + vue-router + Playwright。ダーク固定、黒と無彩色にオシロの緑をアクセント、ツールバーはピクトグラム。
- `/`: 正方形キャンバスに keep-out 帯を表示し、ストロークは帯の内側にクランプ。消しゴムは円と線分の交差でストロークを切断。Undo/Redo はストローク配列のスナップショット。`beforeunload` 警告。送信は確認モーダル。`100dvh` + `overflow: hidden` + `touch-action: none` で画面は動かない。
- `/float`: Canvas 2D、黒背景。プリセット（oscilloshape の circle / smiley / イ を埋め込み）と WS 経由の全絵が、フェードイン + ease-out 拡大で出現し、等速直線移動と回転で漂い、フェードアウト + ease-in 縮小で消える。削除通知はフラグを立て、次の一覧変更時や参照時に除去。
- `/admin`: Cognito Passkey ログイン（aws-amplify）、サムネイル一覧と複数選択削除、アスペクト比の設定。

## oscilloshape 側

- 「Oscillofloat」セクションを追加。WS URL 入力（localStorage に保存、既定は空）と接続/切断。`added` の絵を幅基準で valid area に等倍スケールして loop 表示。接続直後は最新の 1 枚を表示。アニメーションやスライドショーはしない。

## 進め方

1. Fable が仕様（README）、AGENTS.md、型定義、フロントの骨組みを書く。
2. Opus の subagent を並列で走らせる: Go バックエンド / 描画ページ / float ページ / admin ページ / IaC とスクリプト / oscilloshape 連携。
3. `make test` を通し、デプロイして実機確認、初回コミット。
