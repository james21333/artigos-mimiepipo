(function () {
  const params = new URLSearchParams(window.location.search);
  let accountName = (params.get('account') || '').trim();

  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  const gateError = document.getElementById('gate-error');
  const sessionMeta = document.getElementById('session-meta');
  const galleryStatus = document.getElementById('gallery-status');
  const galleryError = document.getElementById('gallery-error');
  const galleryGrid = document.getElementById('gallery-grid');
  const galleryEmpty = document.getElementById('gallery-empty');
  const refreshBtn = document.getElementById('refresh-btn');
  const accountTitle = document.getElementById('account-title');
  const accountSub = document.getElementById('account-sub');
  const editAccountBtn = document.getElementById('edit-account-btn');
  const editAccountForm = document.getElementById('edit-account-form');
  const editAccountName = document.getElementById('edit-account-name');
  const editAccountCancel = document.getElementById('edit-account-cancel');

  let accountsCache = [];

  function setAccountHeading(name) {
    accountTitle.textContent = name || 'Account';
    accountSub.textContent = name || 'Account';
    document.title = name ? `Content Station | ${name}` : 'Content Station | Account';
  }

  if (accountName) {
    setAccountHeading(accountName);
  }

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    const headers = { ...(options.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    opts.headers = headers;
    const res = await fetch(path, opts);
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    return { ok: res.ok, status: res.status, data };
  }

  function showGate(msg) {
    gate.hidden = false;
    app.hidden = true;
    if (msg) {
      gateError.hidden = false;
      gateError.textContent = msg;
    } else {
      gateError.hidden = true;
    }
  }

  function showApp() {
    gate.hidden = true;
    app.hidden = false;
    sessionMeta.textContent = 'Signed in';
  }

  function setError(msg) {
    if (msg) {
      galleryError.hidden = false;
      galleryError.textContent = msg;
    } else {
      galleryError.hidden = true;
      galleryError.textContent = '';
    }
  }

  function formatBytes(n) {
    if (n == null || !Number.isFinite(n)) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return '';
    }
  }

  function displayName(key) {
    const base = String(key || '').split('/').pop() || key;
    return base.replace(/\.mp4$/i, '');
  }

  function renderPostInfo(panel, info) {
    panel.innerHTML = '';
    const has =
      info &&
      (info.tiktokUrl || info.title || info.musicTitle || info.musicUrl || info.musicId);
    if (!has) {
      const empty = document.createElement('p');
      empty.className = 'muted-line';
      empty.textContent =
        'No original post info found for this video (older downloads may lack it).';
      panel.appendChild(empty);
      return;
    }

    if (info.tiktokUrl) {
      const row = document.createElement('p');
      row.className = 'post-info-row';
      const lab = document.createElement('span');
      lab.className = 'post-info-label';
      lab.textContent = 'Original post';
      row.appendChild(lab);
      row.appendChild(document.createElement('br'));
      const a = document.createElement('a');
      a.href = info.tiktokUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = info.tiktokUrl;
      row.appendChild(a);
      panel.appendChild(row);
    }

    if (info.title) {
      const row = document.createElement('p');
      row.className = 'post-info-row';
      const lab = document.createElement('span');
      lab.className = 'post-info-label';
      lab.textContent = 'Description';
      row.appendChild(lab);
      row.appendChild(document.createElement('br'));
      const body = document.createElement('span');
      body.className = 'post-info-body';
      body.textContent = info.title;
      row.appendChild(body);
      panel.appendChild(row);
    }

    if (info.musicTitle || info.musicUrl || info.musicId) {
      const row = document.createElement('p');
      row.className = 'post-info-row';
      const lab = document.createElement('span');
      lab.className = 'post-info-label';
      lab.textContent = 'Sound';
      row.appendChild(lab);
      row.appendChild(document.createElement('br'));
      const name = [info.musicTitle, info.musicAuthor ? `— ${info.musicAuthor}` : '']
        .filter(Boolean)
        .join(' ')
        .trim();
      if (info.musicUrl) {
        const a = document.createElement('a');
        a.href = info.musicUrl;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = name || 'Open sound on TikTok';
        row.appendChild(a);
      } else if (name) {
        const body = document.createElement('span');
        body.className = 'post-info-body';
        body.textContent = name;
        row.appendChild(body);
      } else if (info.musicId) {
        const body = document.createElement('span');
        body.className = 'post-info-body';
        body.textContent = `Music id ${info.musicId}`;
        row.appendChild(body);
      }
      panel.appendChild(row);
    }
  }

  async function loadAccountOptions() {
    const { ok, data } = await api('/api/contentstation/accounts?action=list');
    if (ok && data && Array.isArray(data.accounts)) {
      accountsCache = data.accounts.map((a) => a.name);
    }
  }

  async function retag(key, account) {
    const { ok, data } = await api('/api/contentstation/accounts', {
      method: 'POST',
      body: JSON.stringify({ action: 'tag', key, account: account || '' }),
    });
    if (!ok) {
      throw new Error((data && (data.message || data.error)) || 'Could not update tag.');
    }
    if (data.accounts) {
      accountsCache = data.accounts.map((a) => a.name);
    }
  }

  function renderItems(videos) {
    galleryGrid.innerHTML = '';
    const list = videos || [];
    if (!list.length) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = false;
      galleryStatus.textContent = 'Queue empty';
      return;
    }
    galleryEmpty.hidden = true;
    galleryGrid.hidden = false;
    galleryStatus.textContent = `${list.length} video${list.length === 1 ? '' : 's'}`;

    for (const obj of list) {
      const src = obj.downloadPath;
      const card = document.createElement('article');
      card.className = 'gallery-card';

      const media = document.createElement('div');
      media.className = 'gallery-media';
      const video = document.createElement('video');
      video.src = src;
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      media.appendChild(video);

      const meta = document.createElement('div');
      meta.className = 'gallery-meta';

      const title = document.createElement('p');
      title.className = 'gallery-title';
      title.textContent = displayName(obj.key);

      const info = document.createElement('p');
      info.className = 'muted-line';
      info.textContent = [formatWhen(obj.uploaded), formatBytes(obj.size)].filter(Boolean).join(' · ');

      const tagRow = document.createElement('div');
      tagRow.className = 'tag-row';
      const label = document.createElement('label');
      label.textContent = 'Account';
      const select = document.createElement('select');
      select.className = 'account-select';
      const unt = document.createElement('option');
      unt.value = '';
      unt.textContent = '— Untagged (Cleaned videos) —';
      select.appendChild(unt);
      const names = new Set(accountsCache);
      if (accountName) names.add(accountName);
      [...names]
        .sort((a, b) => {
          const sa = String(a || '');
          const sb = String(b || '');
          const ma = sa.match(/^(\d+)/);
          const mb = sb.match(/^(\d+)/);
          if (ma && mb) {
            const na = Number(ma[1]);
            const nb = Number(mb[1]);
            if (na !== nb) return na - nb;
          } else if (ma && !mb) {
            return -1;
          } else if (!ma && mb) {
            return 1;
          }
          return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
        })
        .forEach((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === accountName) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', async () => {
        select.disabled = true;
        try {
          await retag(obj.key, select.value);
          if (select.value !== accountName) {
            card.remove();
            refreshStatusCount();
          }
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
          select.value = accountName;
        } finally {
          select.disabled = false;
        }
      });
      label.appendChild(select);
      tagRow.appendChild(label);

      const postedRow = document.createElement('label');
      postedRow.className = 'check posted-check';
      const postedBox = document.createElement('input');
      postedBox.type = 'checkbox';
      postedBox.checked = Boolean(obj.posted);
      const postedText = document.createElement('span');
      postedText.textContent = 'Posted';
      postedRow.appendChild(postedBox);
      postedRow.appendChild(postedText);
      if (obj.posted) card.classList.add('is-posted');
      postedBox.addEventListener('change', async () => {
        postedBox.disabled = true;
        try {
          const { ok, data } = await api('/api/contentstation/accounts', {
            method: 'POST',
            body: JSON.stringify({
              action: 'posted',
              key: obj.key,
              posted: postedBox.checked,
            }),
          });
          if (!ok) {
            throw new Error((data && (data.message || data.error)) || 'Could not update Posted.');
          }
          card.classList.toggle('is-posted', postedBox.checked);
          refreshStatusCount();
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
          postedBox.checked = !postedBox.checked;
        } finally {
          postedBox.disabled = false;
        }
      });

      const actions = document.createElement('p');
      actions.className = 'gallery-actions';
      const dl = document.createElement('a');
      dl.className = 'btn-link';
      dl.href = `${src}${src.includes('?') ? '&' : '?'}download=1`;
      dl.textContent = 'Download';
      dl.setAttribute('download', '');
      actions.appendChild(dl);

      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'ghost btn-info';
      infoBtn.textContent = 'Info';
      actions.appendChild(infoBtn);

      const postInfo = document.createElement('div');
      postInfo.className = 'post-info-panel';
      postInfo.hidden = true;

      infoBtn.addEventListener('click', async () => {
        if (!postInfo.hidden) {
          postInfo.hidden = true;
          infoBtn.setAttribute('aria-expanded', 'false');
          return;
        }
        infoBtn.disabled = true;
        infoBtn.textContent = 'Info…';
        try {
          const { ok, data } = await api(
            `/api/contentstation/accounts?action=info&key=${encodeURIComponent(obj.key)}`,
          );
          if (!ok) {
            throw new Error((data && (data.message || data.error)) || 'Could not load info.');
          }
          renderPostInfo(postInfo, data.info || {});
          postInfo.hidden = false;
          infoBtn.setAttribute('aria-expanded', 'true');
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        } finally {
          infoBtn.disabled = false;
          infoBtn.textContent = 'Info';
        }
      });

      meta.appendChild(title);
      if (info.textContent) meta.appendChild(info);
      meta.appendChild(postedRow);
      meta.appendChild(tagRow);
      meta.appendChild(actions);
      meta.appendChild(postInfo);

      card.appendChild(media);
      card.appendChild(meta);
      galleryGrid.appendChild(card);
    }
    refreshStatusCount();
  }

  function refreshStatusCount() {
    const cards = [...galleryGrid.querySelectorAll('.gallery-card')];
    if (!cards.length) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = false;
      galleryStatus.textContent = 'Queue empty';
      return;
    }
    galleryEmpty.hidden = true;
    galleryGrid.hidden = false;
    const posted = cards.filter((c) => c.classList.contains('is-posted')).length;
    const left = cards.length - posted;
    galleryStatus.textContent = `${cards.length} video${cards.length === 1 ? '' : 's'} · ${posted} posted · ${left} left`;
  }

  async function loadGallery() {
    if (!accountName) {
      setError('Missing account name in the URL.');
      galleryStatus.textContent = 'No account';
      return;
    }
    setError('');
    galleryStatus.textContent = 'Loading…';
    refreshBtn.disabled = true;
    try {
      await loadAccountOptions();
      const { ok, data } = await api(
        `/api/contentstation/accounts?action=videos&account=${encodeURIComponent(accountName)}`,
      );
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not load videos.');
      }
      renderItems(data.videos || []);
    } catch (err) {
      galleryGrid.hidden = true;
      galleryEmpty.hidden = true;
      galleryStatus.textContent = 'Could not load';
      setError(err && err.message ? err.message : String(err));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  async function refreshSession() {
    const { ok, data } = await api('/api/contentstation/session');
    if (ok && data && data.authenticated) {
      if (window.CSAuth && !window.CSAuth.gatePage(data, 'ready-account')) return false;
      if (window.CSAuth) window.CSAuth.applyNav(data.role);
      showApp();
      return true;
    }
    showGate();
    return false;
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    gateError.hidden = true;
    const password = document.getElementById('password').value;
    const { ok, data } = await api('/api/contentstation/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (!ok) {
      showGate((data && (data.message || data.error)) || 'Login failed');
      return;
    }
    document.getElementById('password').value = '';
    const authed = await refreshSession();
    if (authed) await loadGallery();
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/contentstation/logout', { method: 'POST', body: '{}' });
    showGate();
  });

  refreshBtn.addEventListener('click', () => {
    loadGallery().catch(() => {});
  });

  function showEditForm(show) {
    if (!editAccountForm || !editAccountBtn) return;
    editAccountForm.hidden = !show;
    editAccountBtn.hidden = show;
    if (show && editAccountName) {
      editAccountName.value = accountName;
      editAccountName.focus();
      editAccountName.select();
    }
  }

  editAccountBtn?.addEventListener('click', () => {
    setError('');
    showEditForm(true);
  });

  editAccountCancel?.addEventListener('click', () => {
    setError('');
    showEditForm(false);
  });

  editAccountForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError('');
    const from = accountName;
    const to = (editAccountName?.value || '').trim();
    if (!from) {
      setError('Missing account name in the URL.');
      return;
    }
    if (!to) {
      setError('Enter an account name.');
      return;
    }
    if (to === from) {
      showEditForm(false);
      return;
    }
    const saveBtn = editAccountForm.querySelector('button[type="submit"]');
    if (saveBtn) saveBtn.disabled = true;
    if (editAccountCancel) editAccountCancel.disabled = true;
    if (editAccountName) editAccountName.disabled = true;
    try {
      const { ok, data } = await api('/api/contentstation/accounts', {
        method: 'POST',
        body: JSON.stringify({ action: 'rename', from, to }),
      });
      if (!ok) {
        throw new Error((data && (data.message || data.error)) || 'Could not rename account.');
      }
      accountName = data.to || to;
      setAccountHeading(accountName);
      const url = new URL(window.location.href);
      url.searchParams.set('account', accountName);
      window.history.replaceState({}, '', url.pathname + url.search);
      showEditForm(false);
      await loadGallery();
    } catch (err) {
      setError(err && err.message ? err.message : String(err));
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (editAccountCancel) editAccountCancel.disabled = false;
      if (editAccountName) editAccountName.disabled = false;
    }
  });

  refreshSession()
    .then((authed) => {
      if (authed) return loadGallery();
    })
    .catch(() => showGate('Could not reach the station. Try again shortly.'));
})();
