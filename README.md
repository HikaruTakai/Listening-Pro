# Listening Pro

Listening Pro は GitHub Pages で公開する静的 PWA です。バックエンド不要・外部 API 依存なし・ブラウザの `speechSynthesis` を利用して音声を再生します。

このリポジトリは、GitHub Pages にそのままデプロイできる最終公開版を想定しています。ユーザー認証は `data/users.csv` の ID 照合方式で行い、サーバー処理は不要です。

## 主要仕様

- GitHub Pages で動作する静的サイト
- ログインは ID のみで管理
- `data/users.csv` からユーザー情報を読み込み
- `Plan` が `Pro` / `Plus` / `Premium` / `VIP` なら無制限扱い
- TTS は端末の `speechSynthesis` を使う
- iPhone Safari でもユーザー操作後に再生を開始する設計

## ルール

- `ID` 列に ID を置く
- `Credits` 列に残数を置く
- `Plan` 列に `Free` / `Pro` などのプラン名を置く
- `D` 列以降はメモ列として無視

## CSV 例

```csv
ID,Credits,Plan
admin123,15,Free
demo-user,10,Free
pro-user,0,Pro
```

## GitHub Pages へのデプロイ

1. このリポジトリを GitHub に push する
2. GitHub の `Settings` → `Pages` に移動する
3. `Deploy from a branch` を選択する
4. `Branch: main`、`Folder: / (root)` を選択する
5. 保存後、数分で公開 URL が有効になる

公開 URL の形式は次のとおりです。

```text
https://<username>.github.io/Listening-Pro/
```

## ローカル実行

```bash
python3 -m http.server 8000
```

その後、ブラウザで `http://localhost:8000` を開いて動作確認できます。

## ディレクトリ構成

```text
Listening-Pro/
├─ index.html
├─ app.js
├─ styles.css
├─ sw.js
├─ manifest.webmanifest
├─ data/
│  └─ users.csv
├─ assets/
│  └─ favicon/
├─ README.md
└─ LICENSE
```

## 補足

- このアプリは GitHub Pages 向けに設計されています。
- バックエンドやサーバー側スクリプトは不要です。
- 外部 API なしで動作するため、公開設定がシンプルです。
- Safari ではユーザー操作後に音声再生が始まるようにしているため、ボタン操作が必須です。

