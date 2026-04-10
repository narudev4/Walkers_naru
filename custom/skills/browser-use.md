# ブラウザ自動化セットアップ

トリガー: ブラウザ自動化が必要な場面で自動的に使う（HeyGen操作、Webスクレイピング等）

## 入力
$ARGUMENTS

## 目的
通常Chromeをブロックせずに、ログイン済みProfile 4（walker-s.co.jp）でヘッドレスChromeを起動し、Playwright経由でブラウザ操作を可能にする。

---

## Step 1: CDP Chrome起動

```bash
/Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh start
```

成功すると `✓ CDP ready: http://localhost:9222` が表示される。

**既に起動中の場合**: 自動でスキップされる（冪等）。

---

## Step 2: 接続テスト

```python
/Users/naru/.pyenv/versions/3.13.0/bin/python3 -c "
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp('http://localhost:9222')
        ctx = browser.contexts[0]
        page = ctx.pages[0]
        print('✓ Connected, pages:', len(ctx.pages))

asyncio.run(main())
"
```

---

## Step 3: 自動化スクリプト実行

CDP_URL は常に `http://localhost:9222` を使う。

Playwrightスクリプトのテンプレート:
```python
import asyncio
from playwright.async_api import async_playwright

CDP_URL = "http://localhost:9222"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(CDP_URL)
        ctx = browser.contexts[0]
        page = ctx.pages[0]
        
        # ここに操作を書く
        await page.goto('https://target-url.com')
        await asyncio.sleep(3)
        
asyncio.run(main())
```

Python実行: `/Users/naru/.pyenv/versions/3.13.0/bin/python3 -u script.py`

---

## Step 4: 完了後クリーンアップ

```bash
/Users/naru/Walkers_naru/05_development/scripts/chrome-cdp-launcher.sh stop
```

---

## 重要な注意事項

### やってはいけないこと
| NG | 理由 | 正しい方法 |
|----|------|-----------|
| `browser-use daemon --profile walker-s.co.jp` で通常Chrome起動中に使う | 同じuser_data_dirで競合する | `chrome-cdp-launcher.sh` を使う |
| `--headed` でブラウザを表示する | ユーザーの画面を邪魔する | ヘッドレスで実行 |
| Profile 4のuser_data_dirを直接参照する | 通常Chromeとロック競合 | コピーを使う |
| 自動化完了後にヘッドレスChromeを放置する | リソース無駄 | 必ず `stop` する |

### ロケータのコツ（HeyGen等の日本語UI）
- 全角スペースを含むテキストは**部分一致**（`text=/ファイルをアップロード/`）を使う
- 完全一致（`text=ファイルをアップロード またはここに...`）は全角/半角スペース違いで失敗する

### Chromeプロファイル情報
| ディレクトリ | 表示名 | メール |
|-------------|--------|--------|
| Profile 1 | Naru | narudev4@gmail.com |
| Profile 2 | アプリ場 | apuriba.official@gmail.com |
| Profile 4 | walker-s.co.jp | naru.hosoya@walker-s.co.jp |
