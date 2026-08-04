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
      characterPreview: document.getElementById('character-preview'),
      characterPreviewWrap: document.getElementById('character-preview-wrap'),
      characterFile: document.getElementById('character-file'),
      characterHint: document.getElementById('character-account-hint'),
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

    function updateCharacterHint() {
      if (!els.characterHint) return;
      if (!selectedAccount) {
        els.characterHint.textContent =
          'Optional: pick a Ready For Upload account to use its saved character and auto-tag the final.';
        return;
      }
      if (selectedCharacterKey) {
        els.characterHint.textContent = fileOverride
          ? `Using a new upload for ${selectedAccount} (will become that account’s default).`
          : `Using ${selectedAccount}’s saved character. Upload a new image to replace the default.`;
      } else {
        els.characterHint.textContent = `${selectedAccount} has no saved character yet — upload one (it becomes the default).`;
      }
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
      updateCharacterHint();
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
            history: a.characterKey
              ? [{ key: a.characterKey, publicUrl: a.characterUrl, downloadPath: a.characterDownloadPath }]
              : [],
          };
        }
      }
    }

    async function loadAccounts(prefer) {
      const { ok, data } = await api('/api/contentstation/accounts?action=list');
      if (!ok) {
        setAccountError((data && (data.message || data.error)) || 'Could not load accounts.');
        return [];
      }
      accounts = data.accounts || [];
      await refreshCharacters().catch(() => {});
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
      fillHistorySelect();
      renderRail();
      updateCharacterHint();
      setAccountError('');
      return data;
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
        if (!f) return;
        fileOverride = true;
        selectedCharacterKey = '';
        showCharacterPreview(URL.createObjectURL(f));
        updateCharacterHint();
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
    }

    bind();

    return {
      loadAccounts,
      selected,
      characterKey,
      hasCharacter,
      resolveCharacterKeyForCreate,
      persistCharacterDefault,
      tagFinalForAccount,
      finalKey,
      mediaUrl: (key) => mediaUrl(key, getPublicBaseUrl()),
      applyAccountCharacter,
      refresh: () => loadAccounts(selectedAccount),
    };
  }

  global.CSRemix2Accounts = {
    createController,
    compareAccountNames,
    accountSlug,
    mediaUrl,
    finalKey,
  };
})(window);
