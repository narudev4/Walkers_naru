/**
 * WalkersGUI — サーバーレス双方向GUIコアシステム
 *
 * Claude Code が生成するHTMLにインラインで埋め込まれる。
 * ブラウザ上でのデータ編集 → ファイルシステムへの書き戻しを担う。
 *
 * 保存方式（3段階フォールバック）:
 *  1. File System Access API（Chrome/Edge）→ 直接ファイル書き込み
 *  2. ダウンロード（全ブラウザ）→ JSONファイルをダウンロード
 *  3. クリップボード（最終手段）→ JSONをコピー、CLIにペースト
 */
class WalkersGUI {
  constructor(stateFileId, initialState = {}) {
    this.stateFileId = stateFileId;
    this.fileHandle = null;
    this.state = {
      _meta: {
        version: '1.0',
        source: `${stateFileId}.html`,
        generatedAt: new Date().toISOString(),
        savedAt: null,
        savedVia: null,
        stateFileId: stateFileId,
      },
      data: {},
      changes: [],
      ...initialState,
    };
    this.hasFileSystemAccess = 'showSaveFilePicker' in window;
    this.saveCount = 0;
    this._dirty = false;
    this._initUI();
  }

  // --- 変更追跡 ---

  recordChange(path, oldValue, newValue) {
    if (oldValue === newValue) return;
    this.state.changes.push({
      path,
      oldValue,
      newValue,
      changedAt: new Date().toISOString(),
    });
    this._dirty = true;
    this._updateStatus('未保存の変更あり', 'warning');
  }

  updateData(path, value) {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let obj = this.state.data;
    const oldValue = keys.reduce((o, k) => (o ? o[k] : undefined), this.state.data);
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.recordChange(path, oldValue, value);
  }

  // --- 保存メソッド ---

  async save() {
    if (this.hasFileSystemAccess) {
      const ok = await this._saveViaFileSystemAccess();
      if (ok) return;
    }
    this._showFallbackModal();
  }

  async _saveViaFileSystemAccess() {
    try {
      if (!this.fileHandle) {
        this.fileHandle = await window.showSaveFilePicker({
          suggestedName: `${this.stateFileId}.state.json`,
          types: [{
            description: 'JSON State File',
            accept: { 'application/json': ['.json'] },
          }],
        });
      }
      const writable = await this.fileHandle.createWritable();
      this._stampMeta('fileSystemAccess');
      await writable.write(JSON.stringify(this.state, null, 2));
      await writable.close();
      this.saveCount++;
      this._dirty = false;
      this._updateStatus(`保存完了 (${this._timeStr()})`, 'success');
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
      console.error('File System Access failed:', e);
      return false;
    }
  }

  _saveViaDownload() {
    this._stampMeta('download');
    const blob = new Blob(
      [JSON.stringify(this.state, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.stateFileId}.state.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.saveCount++;
    this._dirty = false;
    this._updateStatus('ダウンロード完了 — output/gui/state/ に移動してください', 'success');
    this._closeFallbackModal();
  }

  async _saveViaClipboard() {
    this._stampMeta('clipboard');
    const json = JSON.stringify(this.state, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.saveCount++;
      this._dirty = false;
      this._updateStatus('クリップボードにコピー完了 — Claude Code にペーストしてください', 'success');
    } catch (e) {
      // clipboard API blocked on file://, show textarea fallback
      this._showCopyTextarea(json);
      this._updateStatus('下のテキストを選択してコピーしてください', 'warning');
    }
    this._closeFallbackModal();
  }

  _stampMeta(via) {
    this.state._meta.savedAt = new Date().toISOString();
    this.state._meta.savedVia = via;
  }

  // --- UI管理 ---

  _initUI() {
    // 保存バー（ページ上部に固定）
    const bar = document.createElement('div');
    bar.id = 'walkers-gui-bar';
    bar.innerHTML = `
      <div class="wg-bar-inner">
        <div class="wg-bar-left">
          <span class="wg-logo">W</span>
          <span class="wg-title" id="wg-page-title"></span>
        </div>
        <div class="wg-bar-right">
          <span id="wg-status" class="wg-status"></span>
          <button id="wg-save-btn" class="wg-btn" onclick="window._wgui.save()">保存</button>
        </div>
      </div>
    `;
    document.body.prepend(bar);

    // フォールバックモーダル
    const modal = document.createElement('div');
    modal.id = 'wg-fallback-modal';
    modal.className = 'wg-modal-overlay';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="wg-modal">
        <h3>保存方法を選択</h3>
        <p class="wg-modal-desc">ブラウザがFile System Access APIに対応していないため、別の方法で保存します。</p>
        <div class="wg-modal-actions">
          <button class="wg-btn wg-btn-primary" onclick="window._wgui._saveViaDownload()">
            ダウンロードで保存
          </button>
          <button class="wg-btn" onclick="window._wgui._saveViaClipboard()">
            クリップボードにコピー
          </button>
        </div>
        <button class="wg-modal-close" onclick="window._wgui._closeFallbackModal()">×</button>
      </div>
    `;
    document.body.appendChild(modal);

    // コピー用テキストエリア（clipboard API失敗時）
    const ta = document.createElement('div');
    ta.id = 'wg-copy-area';
    ta.style.display = 'none';
    ta.innerHTML = `
      <div class="wg-copy-container">
        <p>以下のJSONをコピーして Claude Code にペーストしてください:</p>
        <textarea id="wg-copy-textarea" rows="10" readonly></textarea>
        <button class="wg-btn" onclick="document.getElementById('wg-copy-area').style.display='none'">閉じる</button>
      </div>
    `;
    document.body.appendChild(ta);

    // グローバル参照
    window._wgui = this;
  }

  _updateStatus(text, type = 'info') {
    const el = document.getElementById('wg-status');
    if (!el) return;
    el.textContent = text;
    el.className = `wg-status wg-status-${type}`;
  }

  _showFallbackModal() {
    const modal = document.getElementById('wg-fallback-modal');
    if (modal) modal.style.display = 'flex';
  }

  _closeFallbackModal() {
    const modal = document.getElementById('wg-fallback-modal');
    if (modal) modal.style.display = 'none';
  }

  _showCopyTextarea(json) {
    const area = document.getElementById('wg-copy-area');
    const ta = document.getElementById('wg-copy-textarea');
    if (area && ta) {
      ta.value = json;
      area.style.display = 'block';
      ta.select();
    }
  }

  _timeStr() {
    return new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }

  // --- ヘルパー: 編集可能要素の生成 ---

  createEditableField(tag, value, dataPath, opts = {}) {
    const el = document.createElement(tag === 'textarea' ? 'textarea' : 'div');
    if (tag !== 'textarea') el.contentEditable = 'true';
    el.className = `wg-editable ${opts.className || ''}`;
    el.textContent = value || '';
    if (opts.placeholder) el.dataset.placeholder = opts.placeholder;

    let original = value || '';
    el.addEventListener('focus', () => { original = el.textContent; });
    el.addEventListener('blur', () => {
      const newVal = el.textContent.trim();
      if (newVal !== original) {
        this.updateData(dataPath, newVal);
        if (opts.onChanged) opts.onChanged(newVal);
      }
    });
    return el;
  }

  createSelect(options, currentValue, dataPath, opts = {}) {
    const sel = document.createElement('select');
    sel.className = `wg-select ${opts.className || ''}`;
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = typeof opt === 'string' ? opt : opt.value;
      o.textContent = typeof opt === 'string' ? opt : opt.label;
      if (o.value === currentValue) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      this.updateData(dataPath, sel.value);
      if (opts.onChanged) opts.onChanged(sel.value);
    });
    return sel;
  }

  createCheckbox(checked, dataPath, label = '', opts = {}) {
    const wrapper = document.createElement('label');
    wrapper.className = `wg-checkbox ${opts.className || ''}`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.addEventListener('change', () => {
      this.updateData(dataPath, cb.checked);
      if (opts.onChanged) opts.onChanged(cb.checked);
    });
    wrapper.appendChild(cb);
    if (label) {
      const span = document.createElement('span');
      span.textContent = label;
      wrapper.appendChild(span);
    }
    return wrapper;
  }
}
