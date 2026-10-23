# Listening Pro

Listening Pro は GitHub Pages で動作する静的な PWA です。ログインは ID のみを前提にしており、ユーザー一覧は `data/users.csv` から読み込みます。  

- ルール: `A2` 以降に ID、`B2` 以降に Credits、`C2` 以降に Plan を置く
- `D` 以降はメモ列として無視
- `Plan` が `Pro` の場合は無制限の扱いとなります
- 端末の native TTS (`speechSynthesis`) を使うため、外部 API や有料課金は不要です

## デプロイ手順

1. このリポジトリを GitHub に push する
2. GitHub の `Settings` → `Pages` に移動
3. `Deploy from a branch` を選択
4. `Branch: main`, `Folder: / (root)` を選択
5. 保存後、数分で `https://<user>.github.io/Listening-Pro/` が有効になる

## CSV の編集

`data/users.csv` の例:

```csv
ID,Credits,Plan,Notes
admin123,15,Free,Desk Demo
pro-user,0,Pro,Premium Demo
demo-user,10,Free,Sample User
```

- `ID` はログイン識別子
- `Credits` は残り回数
- `Plan` は `Free` / `Pro` のみを想定
- `D` 列以降は無視されます

## ローカル実行

```bash
python3 -m http.server 8000
```

その後、ブラウザで `http://localhost:8000` を開く

## 補足

- 本アプリは Apple の Safari と一般的なブラウザで動くよう設計
- speechSynthesis は端末に依存せず無料・無制限で動作
- iPhone Safari で必ずユーザー操作後に TTS を開始する設計
