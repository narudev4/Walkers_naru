# HeyGen自動化 チェックシート駆動方式 設計

## 基本方針

**各ステップの後に「検証」を入れ、期待値と一致しなければリトライ or スクリーンショット保存して次のアプローチを試す。**

```
操作 → 検証 → OK? → 次のステップ
              → NG? → 代替手段 → 再検証 → OK/NG記録
```

## チェックシート（シーンごと）

### Phase A: シーン移動
| # | 操作 | 検証方法 | 期待値 | 代替手段 |
|---|------|----------|--------|----------|
| A1 | 左パネルでシーンNのスクリプト行をクリック | キャンバス上の要素を取得（data-element-id） | 要素が2個以上存在 | スクロール→リトライ |
| A2 | — | スクリーンショット撮影 | 視覚確認用に保存 | — |

### Phase B: 音声アップロード
| # | 操作 | 検証方法 | 期待値 | 代替手段 |
|---|------|----------|--------|----------|
| B1 | 「音声をアップロード」ボタンクリック | ボタンのvisible状態 | visible=true | dismiss_modals→リトライ |
| B2 | FileChooser経由でWAVセット | FileChooser発火 | ファイルセット成功 | input[type=file]直接クリック |
| B3 | 「音声を追加」クリック | ボタンがhiddenになる | hidden（30秒以内） | Escape→B1からリトライ |
| B4 | — | **音声波形の存在確認**（DOM検査） | 波形要素あり | — |

### Phase C: アバターリサイズ
| # | 操作 | 検証方法 | 期待値 | 代替手段 |
|---|------|----------|--------|----------|
| C1 | アバタークリック→SEハンドル確認 | .moveable-se存在 | ハンドル検出 | safe_click_point調整→リトライ |
| C2 | SEドラッグでリサイズ | float精度でHeyGenサイズ計算 | floor(w/cw*1920)==200 | **C3へ** |
| C3 | **プロパティパネルから数値読み取り** | JS: 右パネルのinput/span検査 | 200×200 | **C4へ** |
| C4 | **Shift+ドラッグ / ArrowKey+Shift** | HeyGenがサポートしていれば | サイズ変化 | **C5へ** |
| C5 | **±1pxずつSEドラッグを繰り返す** | 毎回HeyGenサイズを計算 | ==200になるまで | 最大20回 |

### Phase D: アバター位置
| # | 操作 | 検証方法 | 期待値 | 代替手段 |
|---|------|----------|--------|----------|
| D1 | ドラッグで右上角へ移動 | get_error() | err_x==0, err_y==0 | ArrowKeyループ |
| D2 | ArrowKey微調整 | get_error() | 誤差0 | 最大50回 |
| D3 | — | **最終スクリーンショット** | 視覚確認用に保存 | — |

## サイズ200問題の新アプローチ

### 方法1: プロパティパネル入力（最有力）
HeyGenのアバター選択時、右パネルにサイズ入力欄がある可能性。
→ DOMを調査して、input[type=number] や contenteditable な要素を探す。
→ 直接 "200" を入力できれば最も確実。

**調査用JS:**
```javascript
// アバター選択状態で実行
const rightPanel = [...document.querySelectorAll("*")].filter(el => {
  const r = el.getBoundingClientRect();
  return r.x > 700 && r.width > 100 && r.width < 400;
});
const inputs = rightPanel.filter(el =>
  el.tagName === "INPUT" || el.getAttribute("contenteditable") === "true"
);
inputs.map(el => ({
  tag: el.tagName,
  type: el.type,
  value: el.value || el.textContent,
  x: el.getBoundingClientRect().x,
  y: el.getBoundingClientRect().y
}));
```

### 方法2: 二分探索ドラッグ
1. まず大きめにリサイズ（HeyGen=210程度）
2. 1pxずつSEハンドルを左上に戻す
3. 毎回HeyGenサイズを計算
4. 200になった瞬間に停止

**利点**: サブピクセル精度が不要。整数px単位のドラッグで十分。
**注意**: HeyGenの最小リサイズ刻みが何pxかを事前に測定する。

### 方法3: HeyGen API直接操作
ネットワークリクエストを監視し、シーン保存時のAPIペイロードを特定。
avatarのwidth/heightを直接200に書き換えてPOST。
→ 最も確実だが、API仕様の調査が必要。

## スクリーンショット検証の組み込み

```python
async def verify_with_screenshot(page, scene_num, step_name):
    """各ステップ後にスクリーンショットを撮って保存"""
    ss_dir = f"{BASE_DIR}/{SLUG}/verify"
    os.makedirs(ss_dir, exist_ok=True)
    path = f"{ss_dir}/scene{scene_num:02d}_{step_name}.png"
    await page.screenshot(path=path)
    return path
```

## JSON進捗ファイルの拡張

```json
{
  "scenes": {
    "10": {
      "audio": {"status": "ok", "file": "scene10_xxx.wav", "verified": true},
      "resize": {"status": "ok", "heygen_size": 200, "method": "property_input"},
      "position": {"status": "ok", "err_x": 0, "err_y": 0},
      "screenshot": "verify/scene10_final.png"
    }
  }
}
```

## 実装優先順

1. **プロパティパネル調査**（アバター選択時のDOM検査）→ 入力できれば即解決
2. **二分探索ドラッグ**（プロパティ入力が無理な場合のフォールバック）
3. **スクリーンショット検証の組み込み**（全ステップで実施）
4. **進捗JSONの詳細化**（ステップ単位の記録）
