/**
 * Shared account + default-character UI for Remix 2 V2 pages.
 * Expects existing page markup ids when present; creates the top-right rail if missing.
 */
(function (global) {
  function compareAccountNames(a, b) {
    const sa = String(a || '');
    const sb = String(b || '');
    const ma = sa.match(/^(\d+)/);
    const mb = sb.match(/^(\d+)/);
    if (ma && mb) {
      const na = Number(ma[1]);
      const nb = Number(mb[1]);
      if (na !== nb) return na - nb;
    } else if (ma && !mb) return -1;
    else if (!ma && mb) return 1;
    return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
  }

  function accountSlug(name) {
    return String(name || '')
      .trim()
      .replace(/[\/\\]/g, '-')
      .replace(/[^a-zA-Z0-9._\-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'account';
  }

  function mediaUrl(key, publicBaseUrl) {
    if (!key) return '';
    const base = String(publicBaseUrl || '').replace(/\/$/, '');
    if (base) return `${base}/${key}`;
    return `/api/contentstation/media?action=get&key=${encodeURIComponent(key)}`;
  }

  function finalKey(jobId) {
    return `character-remix-2-og/${jobId}/final.mp4`;
  }

  /**
   * @param {object} opts
   * @param {(path:string, opts?:object) => Promise<{ok:boolean,data:any}>} opts.api
   * @param {() => string} [opts.getPublicBaseUrl]
   * @param {(account:string, detail:object|null) => void} [opts.onAccountChange]
   * @param {(msg:string) => void} [opts.onError]
   */
  function createController(opts) {
    const api = opts.api;
    const getPublicBaseUrl = opts.getPublicBaseUrl || (() => '');
    const onAccountChange = opts.onAccountChange || (() => {});
    const onError = opts.onError || (() => {});

    /** @type {any[]} */
    let accounts = [];
    /** @type {Record<string, any>} */
    let charactersByAccount = {};
    /** @type {{ label: string, voiceId: string | null }[]} */
    let voiceCatalog = [];
    let selectedAccount = '';
    /** Active character key for the next remake (may be default or history pick). */
    let selectedCharacterKey = '';
    let fileOverride = false;

    const els = {
      rail: document.getElementById('account-character-rail'),
      railList: document.getElementById('account-character-rail-list'),
      railEmpty: document.getElementById('account-character-rail-empty'),
      select: document.getElementById('account-select'),
      createForm: document.getElementById('create-account-form'),
      newName: document.getElementById('new-account-name'),
      accountError: document.getElementById('account-error'),
      historyWrap: document.getElementById('character-history-wrap'),
      historySelect: document.getElementById('character-history-select'),
      setDefaultBtn: document.getElementById('set-character-default-btn'),
      saveBtn: document.getElementById('save-character-btn'),
      saveStatus: document.getElementById('save-character-status'),
      characterPreview: document.getElementById('character-preview'),
      characterPreviewWrap: document.getElementById('character-preview-wrap'),
      characterFile: document.getElementById('character-file'),
      characterHint: document.getElementById('character-account-hint'),
      voiceLockWrap: document.getElementById('voice-lock-wrap'),
      voiceLockEnabled: document.getElementById('voice-lock-enabled'),
      voiceLockSelect: document.getElementById('voice-lock-select'),
      voiceLockStatus: document.getElementById('voice-lock-status'),
      voiceCatalogWrap: document.getElementById('voice-catalog-wrap'),
      voiceCatalogInputs: document.getElementById('voice-catalog-inputs'),
      voiceCatalogSave: document.getElementById('voice-catalog-save-btn'),
      voiceCatalogPull: document.getElementById('voice-catalog-pull-btn'),
      voiceCatalogStatus: document.getElementById('voice-catalog-status'),
    };

    function setAccountError(msg) {
      if (!els.accountError) return;
      if (msg) {
        els.accountError.hidden = false;
        els.accountError.textContent = msg;
      } else {
        els.accountError.hidden = true;
        els.accountError.textContent = '';
      }
      if (msg) onError(msg);
    }

    function selected() {
      return selectedAccount;
    }

    function characterKey() {
      return selectedCharacterKey;
    }

    function voiceId() {
      const detail = selectedAccount ? charactersByAccount[selectedAccount] : null;
      if (detail && detail.voiceLocked === false) return '';
      return (detail && detail.voiceId) || '';
    }

    function voiceLabel() {
      const detail = selectedAccount ? charactersByAccount[selectedAccount] : null;
      if (detail && detail.voiceLocked === false) return '';
      return (detail && detail.voiceLabel) || '';
    }

    function isVoiceLockEnabled() {
      const detail = selectedAccount ? charactersByAccount[selectedAccount] : null;
      if (!detail) return true;
      return detail.voiceLocked !== false;
    }

    function ensureAccountRail() {
      if (document.getElementById('account-character-rail')) {
        els.rail = document.getElementById('account-character-rail');
        els.railList = document.getElementById('account-character-rail-list');
        els.railEmpty = document.getElementById('account-character-rail-empty');
        return;
      }
      const app = document.getElementById('app');
      if (!app) return;
      const aside = document.createElement('aside');
      aside.id = 'account-character-rail';
      aside.className = 'account-character-rail';
      aside.hidden = true;
      aside.setAttribute('aria-label', 'Accounts and characters');
      aside.innerHTML = `
        <h2 class="account-character-rail-title">Accounts</h2>
        <ul id="account-character-rail-list" class="account-character-rail-list"></ul>
        <p id="account-character-rail-empty" class="muted-line" hidden>No accounts yet.</p>
        <p class="muted-line">Tap to select · 🎙 = voice lock</p>`;
      const hero = app.querySelector('.hero-flow');
      if (hero) app.insertBefore(aside, hero);
      else app.appendChild(aside);
      els.rail = aside;
      els.railList = document.getElementById('account-character-rail-list');
      els.railEmpty = document.getElementById('account-character-rail-empty');
    }

    function refreshCharacterEls() {
      els.historyWrap = document.getElementById('character-history-wrap');
      els.historySelect = document.getElementById('character-history-select');
      els.setDefaultBtn = document.getElementById('set-character-default-btn');
      els.saveBtn = document.getElementById('save-character-btn');
      els.saveStatus = document.getElementById('save-character-status');
      els.characterPreview = document.getElementById('character-preview');
      els.characterPreviewWrap = document.getElementById('character-preview-wrap');
      els.characterFile = document.getElementById('character-file');
      els.characterHint = document.getElementById('character-account-hint');
    }

    function ensureCharacterLockUi() {
      const picker = document.getElementById('account-picker');
      if (picker && !document.getElementById('character-file')) {
        const wrap = document.createElement('div');
        wrap.id = 'character-lock-wrap';
        wrap.className = 'character-lock-wrap';
        wrap.innerHTML = `
          <label for="character-file">Locked character image</label>
          <p class="muted-line">Saved to this Ready account. Johnny / Autogenerate use it as identity lock.</p>
          <input id="character-file" type="file" accept="image/png,image/jpeg,image/webp,image/*">
          <div id="character-preview-wrap" class="character-preview-wrap" hidden>
            <img id="character-preview" alt="Locked character" class="character-preview">
          </div>
          <p id="character-account-hint" class="muted-line"></p>
          <div class="row">
            <button type="button" id="save-character-btn" disabled>Save character to this account</button>
          </div>
          <p id="save-character-status" class="muted-line" hidden></p>
          <div id="character-history-wrap" class="character-history-wrap" hidden>
            <label for="character-history-select">Previously used for this account</label>
            <div class="row">
              <select id="character-history-select" class="account-select">
                <option value="">— Saved characters —</option>
              </select>
              <button type="button" id="set-character-default-btn" class="ghost" hidden>Set as default</button>
            </div>
          </div>`;
        const voice = document.getElementById('voice-lock-wrap');
        if (voice) picker.insertBefore(wrap, voice);
        else picker.appendChild(wrap);
      }
      refreshCharacterEls();
    }

    function ensureVoiceLockUi() {
      const picker = document.getElementById('account-picker');
      if (!picker || document.getElementById('voice-lock-wrap')) return;

      const wrap = document.createElement('div');
      wrap.id = 'voice-lock-wrap';
      wrap.className = 'voice-lock-wrap';
      wrap.innerHTML = `
        <p class="muted-line">Pick a team voice for this account. When checked, Grok gets <code>voice_id</code> on every scene.</p>
        <div class="row account-select-row voice-lock-row">
          <label class="check voice-lock-check" for="voice-lock-enabled">
            <input id="voice-lock-enabled" type="checkbox" checked disabled>
            <span>Voice lock</span>
          </label>
          <select id="voice-lock-select" class="account-select" disabled>
            <option value="">— Pick voice —</option>
          </select>
        </div>
        <p id="voice-lock-status" class="muted-line" hidden></p>
        <details id="voice-catalog-wrap" class="voice-catalog-wrap">
          <summary>Team voice catalog (Grok / xAI Voice IDs)</summary>
          <p class="muted-line">Import pulls built-in Grok voices + any custom clones on the same Grok/xAI auth Johnny uses. Slots <strong>1</strong> / <strong>2</strong> stay reserved for your clones — paste Voice ID if Import leaves them blank.</p>
          <div id="voice-catalog-inputs" class="voice-catalog-grid"></div>
          <div class="row">
            <button type="button" id="voice-catalog-pull-btn" class="ghost">Import from Grok / xAI</button>
            <button type="button" id="voice-catalog-save-btn" class="ghost">Save catalog</button>
          </div>
          <p id="voice-catalog-status" class="muted-line" hidden></p>
        </details>`;
      picker.appendChild(wrap);

      els.voiceLockWrap = wrap;
      els.voiceLockEnabled = document.getElementById('voice-lock-enabled');
      els.voiceLockSelect = document.getElementById('voice-lock-select');
      els.voiceLockStatus = document.getElementById('voice-lock-status');
      els.voiceCatalogWrap = document.getElementById('voice-catalog-wrap');
      els.voiceCatalogInputs = document.getElementById('voice-catalog-inputs');
      els.voiceCatalogSave = document.getElementById('voice-catalog-save-btn');
      els.voiceCatalogPull = document.getElementById('voice-catalog-pull-btn');
      els.voiceCatalogStatus = document.getElementById('voice-catalog-status');

      els.voiceLockEnabled?.addEventListener('change', () => {
        syncVoiceLockFromUi().catch((err) => {
          setAccountError(err?.message || String(err));
        });
      });
      els.voiceLockSelect?.addEventListener('change', () => {
        syncVoiceLockFromUi().catch((err) => {
          setAccountError(err?.message || String(err));
        });
      });
      els.voiceCatalogSave?.addEventListener('click', () => {
        saveVoiceCatalog().catch((err) => {
          setAccountError(err?.message || String(err));
        });
      });
      els.voiceCatalogPull?.addEventListener('click', () => {
        pullVoiceCatalogFromXai().catch((err) => {
          setAccountError(err?.message || String(err));
        });
      });
    }

    function renderVoiceCatalogInputs() {
      if (!els.voiceCatalogInputs) return;
      els.voiceCatalogInputs.innerHTML = '';
      const rows = voiceCatalog.length ? voiceCatalog : [{ label: '1', voiceId: '' }, { label: '2', voiceId: '' }];
      for (const row of rows.slice(0, 30)) {
        const field = document.createElement('label');
        field.className = 'voice-catalog-field';
        field.innerHTML = `<span class="voice-catalog-label">${row.label}</span>`;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'voice-catalog-id';
        input.dataset.label = row.label;
        input.placeholder = 'voice_id';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = row.voiceId || '';
        field.appendChild(input);
        els.voiceCatalogInputs.appendChild(field);
      }
    }

    function fillVoiceLockSelect() {
      if (!els.voiceLockSelect) return;
      const detail = selectedAccount ? charactersByAccount[selectedAccount] : null;
      const current = detail?.voiceLabel || '';
      els.voiceLockSelect.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— Pick voice —';
      els.voiceLockSelect.appendChild(none);
      const customs = voiceCatalog.filter((v) => v.source === 'custom' || (!v.source && v.label));
      const builtIns = voiceCatalog.filter((v) => v.source === 'built_in');
      if (customs.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'Custom voices';
        for (const v of customs) {
          if (!v.label) continue;
          const opt = document.createElement('option');
          opt.value = v.label;
          opt.textContent = v.label + (v.voiceId ? '' : ' (no id)');
          opt.disabled = !v.voiceId;
          grp.appendChild(opt);
        }
        els.voiceLockSelect.appendChild(grp);
      }
      if (builtIns.length) {
        const grp = document.createElement('optgroup');
        grp.label = 'Built-in voices';
        for (const v of builtIns) {
          if (!v.label) continue;
          const opt = document.createElement('option');
          opt.value = v.label;
          opt.textContent = v.label + (v.gender ? ` (${v.gender})` : '');
          opt.disabled = !v.voiceId;
          grp.appendChild(opt);
        }
        els.voiceLockSelect.appendChild(grp);
      }
      const pick =
        current && voiceCatalog.some((v) => v.label === current)
          ? current
          : voiceCatalog.find((v) => v.voiceId)?.label || '';
      els.voiceLockSelect.value = pick;
      const canEdit = Boolean(selectedAccount);
      const locked = detail ? detail.voiceLocked !== false : true;
      if (els.voiceLockEnabled) {
        els.voiceLockEnabled.checked = locked;
        els.voiceLockEnabled.disabled = !canEdit;
      }
      if (els.voiceLockSelect) {
        els.voiceLockSelect.disabled = !canEdit || !locked;
      }
    }

    function setVoiceLockStatus(msg) {
      if (!els.voiceLockStatus) return;
      if (msg) {
        els.voiceLockStatus.hidden = false;
        els.voiceLockStatus.textContent = msg;
      } else {
        els.voiceLockStatus.hidden = true;
        els.voiceLockStatus.textContent = '';
      }
    }

    function setVoiceCatalogStatus(msg) {
      if (!els.voiceCatalogStatus) return;
      if (msg) {
        els.voiceCatalogStatus.hidden = false;
        els.voiceCatalogStatus.textContent = msg;
      } else {
        els.voiceCatalogStatus.hidden = true;
        els.voiceCatalogStatus.textContent = '';
      }
    }

    async function loadVoiceCatalog() {
      const { ok, data } = await api('/api/contentstation/accounts?action=voice-catalog');
      voiceCatalog = ok && Array.isArray(data?.voices) ? data.voices : [];
      renderVoiceCatalogInputs();
      fillVoiceLockSelect();
    }

    async function pullVoiceCatalogFromXai() {
      if (els.voiceCatalogPull) els.voiceCatalogPull.disabled = true;
      setVoiceCatalogStatus('Importing from xAI team…');
      try {
        const { ok, data } = await api('/api/contentstation/accounts', {
          method: 'POST',
          body: JSON.stringify({ action: 'pull-xai-voices' }),
        });
        if (!ok) {
          throw new Error((data && (data.message || data.error)) || 'Could not import from xAI.');
        }
        voiceCatalog = data.voices || [];
        renderVoiceCatalogInputs();
        fillVoiceLockSelect();
        renderRail();
        const customN = data.customCount ?? data.customTotal;
        const builtN = data.builtInCount;
        const extra =
          customN != null || builtN != null
            ? ` (custom ${customN ?? '?'}/${data.customCap ?? 30}, built-in ${builtN ?? '?'})`
            : '';
        setVoiceCatalogStatus(
          `Imported ${data.imported ?? data.xaiCount ?? voiceCatalog.length} voice(s) from Grok/xAI${extra}.`,
        );
        setAccountError('');
      } finally {
        if (els.voiceCatalogPull) els.voiceCatalogPull.disabled = false;
      }
    }

    async function saveVoiceCatalog() {
      const inputs = els.voiceCatalogInputs?.querySelectorAll('.voice-catalog-id') || [];
      const voices = [];
      for (const input of inputs) {
        const label = String(input.dataset.label || '').trim();
        const voiceIdVal = String(input.value || '').trim().toLowerCase();
        if (!label) continue;
        voices.push({ label, voiceId: voiceIdVal || null });
      }
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'set-voice-catalog', voices }),
      });
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not save voice catalog.');
      }
      voiceCatalog = data.voices || voices;
      renderVoiceCatalogInputs();
      fillVoiceLockSelect();
      renderRail();
      setVoiceCatalogStatus(`Saved ${voiceCatalog.length} catalog voice(s).`);
    }

    async function syncVoiceLockFromUi() {
      if (!selectedAccount) {
        setAccountError('Pick an account first.');
        return null;
      }
      const locked = Boolean(els.voiceLockEnabled?.checked);
      const label = els.voiceLockSelect?.value || '';
      if (locked && !label) {
        setVoiceLockStatus('Pick voice 1 or 2 (save catalog first if empty).');
        return null;
      }
      return persistAccountVoice({ locked, label: locked ? label : undefined });
    }

    async function persistAccountVoice({ locked, label } = {}) {
      if (!selectedAccount) {
        setAccountError('Pick an account first.');
        return null;
      }
      const voiceLocked = locked !== undefined ? locked : Boolean(els.voiceLockEnabled?.checked);
      const voiceLabel = label !== undefined ? label : els.voiceLockSelect?.value || '';
      const body = {
        action: 'set-voice',
        account: selectedAccount,
        voiceLocked,
      };
      if (voiceLocked) body.voiceLabel = voiceLabel;
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not update voice lock.');
      }
      if (data.accounts) accounts = data.accounts;
      charactersByAccount[selectedAccount] = data;
      fillVoiceLockSelect();
      renderRail();
      setVoiceLockStatus(
        voiceLocked
          ? `Voice lock on · ${data.voiceLabel || voiceLabel || '?'} (${data.voiceId || '?'})`
          : `Voice lock off for ${selectedAccount} (assignment kept).`,
      );
      setAccountError('');
      return data;
    }

    function renderVoiceBadge(btn, accountName) {
      if (!btn || !accountName) return;
      const detail = charactersByAccount[accountName] || {};
      const acct = accounts.find((a) => (a.name || a) === accountName);
      const vLabel = detail.voiceLabel || acct?.voiceLabel || '';
      const vId = detail.voiceId || acct?.voiceId || '';
      const locked = detail.voiceLocked !== false && acct?.voiceLocked !== false;
      let badge = btn.querySelector('.account-voice-badge');
      if (!vId || !locked) {
        badge?.remove();
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'account-voice-badge';
        badge.title = `Voice lock: ${vLabel || vId}`;
        btn.appendChild(badge);
      }
      badge.textContent = vLabel ? `🎙 ${vLabel}` : '🎙';
    }

    function hasCharacter() {
      return Boolean(selectedCharacterKey) || Boolean(els.characterFile?.files?.[0]);
    }

    function showCharacterPreview(url) {
      if (!els.characterPreview || !els.characterPreviewWrap) return;
      if (!url) {
        els.characterPreviewWrap.hidden = true;
        els.characterPreview.removeAttribute('src');
        return;
      }
      els.characterPreview.src = url;
      els.characterPreviewWrap.hidden = false;
    }

    function setSaveStatus(msg) {
      if (!els.saveStatus) return;
      if (msg) {
        els.saveStatus.hidden = false;
        els.saveStatus.textContent = msg;
      } else {
        els.saveStatus.hidden = true;
        els.saveStatus.textContent = '';
      }
    }

    function syncSaveButton() {
      if (!els.saveBtn) return;
      const hasFile = Boolean(els.characterFile?.files?.[0]);
      els.saveBtn.disabled = !selectedAccount || (!hasFile && !selectedCharacterKey);
    }

    function updateCharacterHint() {
      if (els.characterHint) {
        if (!selectedAccount) {
          els.characterHint.textContent =
            'Pick a Ready For Upload account, choose an image, then Save character to this account — no remix needed.';
        } else if (els.characterFile?.files?.[0]) {
          els.characterHint.textContent = `New image selected for ${selectedAccount}. Click Save character to this account (does not start a remix).`;
        } else if (selectedCharacterKey) {
          els.characterHint.textContent = `${selectedAccount} already has a saved character. Upload a new image and Save to replace it.`;
        } else {
          els.characterHint.textContent = `${selectedAccount} has no saved character yet — choose an image and click Save character to this account.`;
        }
      }
      syncSaveButton();
    }

    function fillHistorySelect() {
      if (!els.historyWrap || !els.historySelect) return;
      const detail = charactersByAccount[selectedAccount];
      const history = (detail && detail.history) || [];
      els.historySelect.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = history.length ? '— Saved characters —' : '— No saved characters —';
      els.historySelect.appendChild(none);
      for (const h of history) {
        if (!h?.key) continue;
        const opt = document.createElement('option');
        opt.value = h.key;
        const short = h.key.split('/').pop() || h.key;
        opt.textContent = short.length > 36 ? `${short.slice(0, 34)}…` : short;
        els.historySelect.appendChild(opt);
      }
      if (selectedCharacterKey && history.some((h) => h.key === selectedCharacterKey)) {
        els.historySelect.value = selectedCharacterKey;
      }
      els.historyWrap.hidden = !selectedAccount;
      if (els.setDefaultBtn) {
        els.setDefaultBtn.hidden = !selectedAccount || !selectedCharacterKey;
      }
    }

    function applyAccountCharacter(account) {
      selectedAccount = account || '';
      fileOverride = false;
      if (els.characterFile) els.characterFile.value = '';
      const detail = account ? charactersByAccount[account] : null;
      selectedCharacterKey = (detail && detail.defaultKey) || '';
      const url =
        (detail && (detail.publicUrl || detail.downloadPath)) ||
        (selectedCharacterKey ? mediaUrl(selectedCharacterKey, getPublicBaseUrl()) : '');
      showCharacterPreview(url);
      fillHistorySelect();
      setSaveStatus('');
      updateCharacterHint();
      fillVoiceLockSelect();
      setVoiceLockStatus('');
      renderRail();
      if (els.select && els.select.value !== selectedAccount) {
        els.select.value = selectedAccount;
      }
      onAccountChange(selectedAccount, detail || null);
    }

    function fillAccountSelect() {
      if (!els.select) return;
      const current = selectedAccount;
      const names = accounts
        .map((a) => (typeof a === 'string' ? a : a.name))
        .filter(Boolean)
        .sort(compareAccountNames);
      els.select.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— No account (tag later) —';
      els.select.appendChild(none);
      for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        els.select.appendChild(opt);
      }
      if (current && names.includes(current)) els.select.value = current;
      else els.select.value = '';
    }

    function renderRail() {
      if (!els.rail || !els.railList) return;
      els.rail.hidden = false;
      els.railList.innerHTML = '';
      if (!accounts.length) {
        if (els.railEmpty) els.railEmpty.hidden = false;
        return;
      }
      if (els.railEmpty) els.railEmpty.hidden = true;
      const sorted = [...accounts].sort((a, b) =>
        compareAccountNames(a?.name || a, b?.name || b),
      );
      for (const a of sorted) {
        const name = typeof a === 'string' ? a : a.name;
        if (!name) continue;
        const detail = charactersByAccount[name] || {
          defaultKey: a.characterKey,
          publicUrl: a.characterUrl,
          downloadPath: a.characterDownloadPath,
        };
        const thumb =
          detail.publicUrl ||
          detail.downloadPath ||
          (detail.defaultKey ? mediaUrl(detail.defaultKey, getPublicBaseUrl()) : '');
        const li = document.createElement('li');
        li.className = 'account-character-item';
        if (name === selectedAccount) li.classList.add('is-selected');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'account-character-btn';
        btn.setAttribute('aria-pressed', name === selectedAccount ? 'true' : 'false');
        if (thumb) {
          const img = document.createElement('img');
          img.src = thumb;
          img.alt = '';
          img.className = 'account-character-thumb';
          btn.appendChild(img);
        } else {
          const ph = document.createElement('span');
          ph.className = 'account-character-placeholder';
          ph.textContent = '—';
          btn.appendChild(ph);
        }
        const meta = document.createElement('span');
        meta.className = 'account-character-meta';
        const nameEl = document.createElement('span');
        nameEl.className = 'account-character-name';
        nameEl.textContent = name;
        const countEl = document.createElement('span');
        countEl.className = 'account-character-count';
        const n = typeof a === 'object' && a ? Number(a.count) || 0 : 0;
        countEl.textContent = n === 1 ? '1 ready' : `${n} ready`;
        meta.appendChild(nameEl);
        meta.appendChild(countEl);
        btn.appendChild(meta);
        renderVoiceBadge(btn, name);
        btn.addEventListener('click', () => {
          applyAccountCharacter(name === selectedAccount ? '' : name);
        });
        li.appendChild(btn);
        els.railList.appendChild(li);
      }
    }

    async function refreshCharacters() {
      const { ok, data } = await api('/api/contentstation/accounts?action=characters');
      charactersByAccount = ok && data?.characters ? data.characters : {};
      // Merge list summaries when characters endpoint sparse
      for (const a of accounts) {
        const name = a?.name || a;
        if (!name) continue;
        if (!charactersByAccount[name] && a.characterKey) {
          charactersByAccount[name] = {
            account: name,
            defaultKey: a.characterKey,
            publicUrl: a.characterUrl,
            downloadPath: a.characterDownloadPath,
            voiceId: a.voiceId || null,
            voiceLabel: a.voiceLabel || null,
            voiceLocked: a.voiceLocked !== false,
            history: a.characterKey
              ? [{ key: a.characterKey, publicUrl: a.characterUrl, downloadPath: a.characterDownloadPath }]
              : [],
          };
        }
      }
    }

    async function loadAccounts(prefer) {
      ensureAccountRail();
      ensureCharacterLockUi();
      ensureVoiceLockUi();
      const { ok, data } = await api('/api/contentstation/accounts?action=list');
      if (!ok) {
        setAccountError((data && (data.message || data.error)) || 'Could not load accounts.');
        return [];
      }
      accounts = data.accounts || [];
      await Promise.all([refreshCharacters().catch(() => {}), loadVoiceCatalog().catch(() => {})]);
      fillAccountSelect();
      const want =
        prefer != null
          ? prefer
          : selectedAccount && accounts.some((a) => (a.name || a) === selectedAccount)
            ? selectedAccount
            : '';
      applyAccountCharacter(want || '');
      setAccountError('');
      return accounts;
    }

    async function createAccount(nameRaw) {
      const name = String(nameRaw || '').trim();
      if (!name) {
        setAccountError('Enter an account name.');
        return null;
      }
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', name }),
      });
      if (!ok) {
        setAccountError((data && (data.message || data.error)) || 'Could not create account.');
        return null;
      }
      accounts = data.accounts || accounts;
      await refreshCharacters().catch(() => {});
      fillAccountSelect();
      applyAccountCharacter(data.name || name);
      setAccountError('');
      return data.name || name;
    }

    async function persistCharacterDefault(key) {
      if (!selectedAccount || !key) return null;
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'set-character', account: selectedAccount, key }),
      });
      if (!ok) {
        setAccountError((data && (data.message || data.error)) || 'Could not save character.');
        return null;
      }
      if (data.accounts) accounts = data.accounts;
      charactersByAccount[selectedAccount] = data;
      selectedCharacterKey = data.defaultKey || key;
      fileOverride = false;
      if (els.characterFile) els.characterFile.value = '';
      const url = data.publicUrl || data.downloadPath || mediaUrl(selectedCharacterKey, getPublicBaseUrl());
      showCharacterPreview(url);
      fillHistorySelect();
      renderRail();
      updateCharacterHint();
      setAccountError('');
      setSaveStatus(`Saved character for ${selectedAccount}.`);
      return data;
    }

    async function uploadCharacterFile(file) {
      const prefix = selectedAccount
        ? `account-characters/${accountSlug(selectedAccount)}/`
        : 'characters/';
      const form = new FormData();
      form.append('file', file, file.name || 'image.png');
      form.append('prefix', prefix);
      const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: form });
      if (!ok || !data?.object?.key) {
        throw new Error(data?.message || data?.error || 'Character upload failed.');
      }
      return data.object.key;
    }

    async function saveCharacterToAccount() {
      if (!selectedAccount) {
        setAccountError('Pick an account first.');
        return null;
      }
      const file = els.characterFile?.files?.[0];
      let key = selectedCharacterKey;
      if (els.saveBtn) els.saveBtn.disabled = true;
      setSaveStatus(file ? 'Uploading character…' : 'Saving character…');
      try {
        if (file) key = await uploadCharacterFile(file);
        if (!key) {
          setAccountError('Choose a character image to save.');
          setSaveStatus('');
          return null;
        }
        return await persistCharacterDefault(key);
      } catch (err) {
        setAccountError(err?.message || String(err));
        setSaveStatus('');
        return null;
      } finally {
        syncSaveButton();
      }
    }

    /**
     * Resolve character key for job create: upload new file if present, else use selected key.
     * When an account is selected and a new file is uploaded, save it as that account’s default.
     */
    async function resolveCharacterKeyForCreate(uploadImage) {
      const file = els.characterFile?.files?.[0];
      if (file) {
        const prefix = selectedAccount
          ? `account-characters/${accountSlug(selectedAccount)}/`
          : 'characters/';
        const key = await uploadImage(file, prefix);
        if (selectedAccount) {
          await persistCharacterDefault(key);
        } else {
          selectedCharacterKey = key;
          fileOverride = true;
        }
        return key;
      }
      if (selectedCharacterKey) return selectedCharacterKey;
      throw new Error('Choose a character image (or select an account with a saved character).');
    }

    async function tagFinalForAccount(jobId, account) {
      const acct = account || selectedAccount;
      if (!jobId || !acct) return { ok: false, skipped: true };
      const key = finalKey(jobId);
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'tag', key, account: acct }),
      });
      return { ok, data, key, account: acct };
    }

    function bind() {
      ensureCharacterLockUi();
      ensureVoiceLockUi();
      els.select?.addEventListener('change', () => {
        applyAccountCharacter(els.select.value || '');
      });
      els.createForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        await createAccount(els.newName?.value);
        if (els.newName) els.newName.value = '';
      });
      els.characterFile?.addEventListener('change', () => {
        const f = els.characterFile.files?.[0];
        if (!f) {
          updateCharacterHint();
          return;
        }
        fileOverride = true;
        showCharacterPreview(URL.createObjectURL(f));
        updateCharacterHint();
        setSaveStatus('');
        if (els.historySelect) els.historySelect.value = '';
      });
      els.historySelect?.addEventListener('change', () => {
        const key = els.historySelect.value || '';
        if (!key) return;
        fileOverride = false;
        if (els.characterFile) els.characterFile.value = '';
        selectedCharacterKey = key;
        showCharacterPreview(mediaUrl(key, getPublicBaseUrl()));
        updateCharacterHint();
        if (els.setDefaultBtn) els.setDefaultBtn.hidden = !selectedAccount;
      });
      els.setDefaultBtn?.addEventListener('click', async () => {
        if (!selectedCharacterKey) return;
        await persistCharacterDefault(selectedCharacterKey);
      });
      els.saveBtn?.addEventListener('click', () => {
        saveCharacterToAccount().catch((err) => {
          setAccountError(err?.message || String(err));
        });
      });
    }

    bind();

    return {
      loadAccounts,
      selected,
      characterKey,
      voiceId,
      voiceLabel,
      isVoiceLockEnabled,
      hasCharacter,
      resolveCharacterKeyForCreate,
      persistCharacterDefault,
      saveCharacterToAccount,
      tagFinalForAccount,
      finalKey,
      mediaUrl: (key) => mediaUrl(key, getPublicBaseUrl()),
      applyAccountCharacter,
      refresh: () => loadAccounts(selectedAccount),
      getVoiceCatalog: () => voiceCatalog.slice(),
    };
  }

  async function lockCharacterImage(api, account, file, { key } = {}) {
    const name = String(account || '').trim();
    if (!name) throw new Error('Pick an account first.');
    let nextKey = key || '';
    if (file) {
      const prefix = `account-characters/${accountSlug(name)}/`;
      const form = new FormData();
      form.append('file', file, file.name || 'image.png');
      form.append('prefix', prefix);
      const { ok, data } = await api('/api/contentstation/media', { method: 'POST', body: form });
      if (!ok || !data?.object?.key) {
        throw new Error((data && (data.message || data.error)) || 'Character upload failed.');
      }
      nextKey = data.object.key;
    }
    if (!nextKey) throw new Error('Choose a character image to save.');
    const { ok, data } = await api('/api/contentstation/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'set-character', account: name, key: nextKey }),
    });
    if (!ok) {
      throw new Error((data && (data.message || data.error)) || 'Could not save character.');
    }
    return data;
  }

  global.CSRemix2Accounts = {
    createController,
    lockCharacterImage,
    compareAccountNames,
    accountSlug,
    mediaUrl,
    finalKey,
  };
})(window);
