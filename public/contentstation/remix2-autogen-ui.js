/**
 * Shared Autogenerate UI (URL list leftovers + multi-account queue).
 * Same package as V2 / Music-Only pages — pass buildCreateBody for the variant.
 */
(function () {
  const MAX_URLS = 20;
  const FEATURED_ACCOUNT_RE = /^(1|2|3|6|7|8|10)(\D|$)/;

  function createController(opts) {
    const api = opts.api;
    const getListId = typeof opts.getListId === 'function' ? opts.getListId : () => 'glp-1';
    const buildCreateBody =
      typeof opts.buildCreateBody === 'function' ? opts.buildCreateBody : () => ({});
    const onJobsStarted = typeof opts.onJobsStarted === 'function' ? opts.onJobsStarted : null;
    const setStatus = typeof opts.setStatus === 'function' ? opts.setStatus : () => {};
    const setError = typeof opts.setError === 'function' ? opts.setError : () => {};
    const getTitle = typeof opts.getTitle === 'function' ? opts.getTitle : () => 'Autogenerate';
    const tiktokUrls = opts.tiktokUrlsEl || document.getElementById('tiktok-urls');
    const runBtn = opts.runBtn || document.getElementById('run-btn');
    const onBusy = typeof opts.onBusy === 'function' ? opts.onBusy : null;

    const autogenRandomEl = document.getElementById('autogen-random');
    const autogenListEl = document.getElementById('autogen-account-list');
    const autogenEmptyEl = document.getElementById('autogen-empty');
    const autogenSummaryEl = document.getElementById('autogen-summary');
    const autogenBtn = document.getElementById('autogen-btn');
    const autogenPasteBtn = document.getElementById('autogen-paste-btn');
    const autogenSelectAllBtn = document.getElementById('autogen-select-all');
    const autogenSelectNoneBtn = document.getElementById('autogen-select-none');
    const autogenPasteSummaryEl = document.getElementById('autogen-paste-summary');
    const dupBanner = document.getElementById('remix-dup-banner');
    const urlCountEl = document.getElementById('url-count');

    if (!autogenBtn && !autogenPasteBtn) return null;

    /** @type {any[]} */
    let sourcePool = [];
    const autogenChecked = new Set();
    /** @type {Set<string>} */
    const leftoverChecked = new Set();
    let submitting = false;

    function leftoverKey(account, url) {
      return `${account}\t${url}`;
    }

    function accountNum(name) {
      const m = String(name || '').match(/^(\d+)/);
      return m ? Number(m[1]) : 999;
    }

    function isFeaturedAccount(name) {
      return FEATURED_ACCOUNT_RE.test(String(name || '').trim());
    }

    function poolFor(account) {
      return sourcePool.find((p) => p.account === account) || null;
    }

    function parseUrls(raw) {
      return String(raw || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    }

    function selectedAutogenAccounts() {
      return sourcePool.filter((p) => autogenChecked.has(p.account));
    }

    function plannedAutogenJobs() {
      const random = Boolean(autogenRandomEl?.checked);
      const jobs = [];
      const blocked = [];
      for (const p of selectedAutogenAccounts()) {
        if (!p.characterKey) {
          blocked.push(`${p.account} — no character image`);
          continue;
        }
        if (random) {
          if (!p.leftover?.length) {
            blocked.push(`${p.account} — no leftovers`);
            continue;
          }
          jobs.push({
            account: p.account,
            characterKey: p.characterKey,
            voiceId: p.voiceId || null,
            voiceLabel: p.voiceLabel || null,
            pick: 'random',
            leftover: p.leftover,
          });
          continue;
        }
        const picked = (p.leftover || []).filter((item) =>
          leftoverChecked.has(leftoverKey(p.account, item.url)),
        );
        if (!picked.length) {
          blocked.push(`${p.account} — pick at least one leftover URL`);
          continue;
        }
        for (const item of picked) {
          jobs.push({
            account: p.account,
            characterKey: p.characterKey,
            voiceId: p.voiceId || null,
            voiceLabel: p.voiceLabel || null,
            url: item.url,
          });
        }
      }
      return { jobs, blocked, random };
    }

    function plannedPasteJobs() {
      const urls = parseUrls(tiktokUrls?.value);
      const jobs = [];
      const blocked = [];
      if (!urls.length) return { jobs, blocked: ['Paste TikTok URLs below'], urls };
      if (urls.length > MAX_URLS) return { jobs, blocked: [`Max ${MAX_URLS} TikTok links`], urls };
      const selected = selectedAutogenAccounts();
      if (!selected.length) return { jobs, blocked: ['Select one or more accounts above'], urls };
      for (const p of selected) {
        if (!p.characterKey) {
          blocked.push(`${p.account} — no character image`);
          continue;
        }
        for (const url of urls) {
          jobs.push({ account: p.account, characterKey: p.characterKey, voiceId: p.voiceId || null, voiceLabel: p.voiceLabel || null, url });
        }
      }
      return { jobs, blocked, urls };
    }

    function updateUrlCount() {
      if (!urlCountEl) return;
      const n = parseUrls(tiktokUrls?.value).length;
      urlCountEl.textContent = `${n} / ${MAX_URLS} links`;
    }

    function updateAutogenSummary() {
      const { jobs, blocked, random } = plannedAutogenJobs();
      const accounts = new Set(jobs.map((j) => j.account)).size;
      let text = '';
      if (jobs.length) {
        text = random
          ? `Will queue ${jobs.length} random leftover${jobs.length === 1 ? '' : 's'} · ${accounts} account${accounts === 1 ? '' : 's'}`
          : `Will queue ${jobs.length} selected leftover${jobs.length === 1 ? '' : 's'} · ${accounts} account${accounts === 1 ? '' : 's'}`;
      } else if (selectedAutogenAccounts().length) {
        text = blocked[0] || 'Nothing to queue — check leftovers and character images.';
      } else {
        text = 'Check one or more accounts above, or Select all.';
      }
      if (autogenSummaryEl) autogenSummaryEl.textContent = text;
      if (autogenBtn) autogenBtn.disabled = submitting || !jobs.length;
      const paste = plannedPasteJobs();
      const pasteAccounts = new Set(paste.jobs.map((j) => j.account)).size;
      if (autogenPasteSummaryEl) {
        autogenPasteSummaryEl.textContent = paste.jobs.length
          ? `Will queue ${paste.jobs.length} remake${paste.jobs.length === 1 ? '' : 's'} · ${paste.urls.length} URL${paste.urls.length === 1 ? '' : 's'} × ${pasteAccounts} account${pasteAccounts === 1 ? '' : 's'}`
          : paste.blocked[0] || 'Paste URLs and select accounts.';
      }
      if (autogenPasteBtn) autogenPasteBtn.disabled = submitting || !paste.jobs.length;
      updateUrlCount();
    }

    function selectAllAutogenAccounts() {
      for (const p of sourcePool) {
        if (p.characterKey) autogenChecked.add(p.account);
      }
      renderAutogen();
    }

    function selectNoneAutogenAccounts() {
      autogenChecked.clear();
      leftoverChecked.clear();
      renderAutogen();
    }

    function renderAutogen() {
      if (!autogenListEl) return;
      autogenListEl.innerHTML = '';
      const random = Boolean(autogenRandomEl?.checked);
      if (autogenEmptyEl) autogenEmptyEl.hidden = sourcePool.length > 0;
      const featured = sourcePool.filter((p) => isFeaturedAccount(p.account));
      const rest = sourcePool.filter((p) => !isFeaturedAccount(p.account));
      const groups = [
        { label: 'Accounts 1, 2, 3, 6, 7, 8, 10', rows: featured },
        { label: 'Other accounts', rows: rest },
      ];
      for (const group of groups) {
        if (!group.rows.length) continue;
        const heading = document.createElement('li');
        heading.className = 'autogen-group-label';
        heading.style.listStyle = 'none';
        heading.textContent = group.label;
        autogenListEl.appendChild(heading);
        for (const p of group.rows) {
          const li = document.createElement('li');
          const blocked = !p.characterKey;
          li.className = 'autogen-account-row' + (blocked ? ' is-blocked' : '');
          const id = `autogen-acc-${accountNum(p.account)}-${encodeURIComponent(p.account).slice(0, 40)}`;
          const check = document.createElement('input');
          check.type = 'checkbox';
          check.id = id;
          check.checked = autogenChecked.has(p.account);
          check.disabled = blocked;
          check.addEventListener('change', () => {
            if (check.checked) autogenChecked.add(p.account);
            else autogenChecked.delete(p.account);
            renderAutogen();
          });
          let thumb;
          if (p.characterUrl) {
            thumb = document.createElement('img');
            thumb.className = 'autogen-thumb';
            thumb.alt = '';
            thumb.src = p.characterUrl;
          } else {
            thumb = document.createElement('div');
            thumb.className = 'autogen-thumb is-empty';
            thumb.textContent = 'No img';
          }
          const meta = document.createElement('div');
          meta.className = 'autogen-account-meta';
          const nameEl = document.createElement('strong');
          nameEl.textContent = p.account;
          const sub = document.createElement('span');
          sub.textContent = blocked
            ? 'Save a character for this account before autogenerate'
            : `${p.leftoverCount} leftover · ${p.remixedCount} already remixed · ${p.poolCount} on list${p.voiceLocked && p.voiceId ? ` · voice ${p.voiceLabel || p.voiceId}` : ''}`;
          meta.appendChild(nameEl);
          meta.appendChild(sub);
          const count = document.createElement('span');
          count.className = 'autogen-count' + (p.leftoverCount ? '' : ' is-zero');
          count.textContent = p.leftoverCount ? `${p.leftoverCount} left` : '0 left';
          li.appendChild(check);
          li.appendChild(thumb);
          li.appendChild(meta);
          li.appendChild(count);
          if (!random && check.checked && p.leftover?.length && p.characterKey) {
            const wrap = document.createElement('div');
            wrap.className = 'autogen-leftovers';
            for (const item of p.leftover) {
              const lab = document.createElement('label');
              const cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.checked = leftoverChecked.has(leftoverKey(p.account, item.url));
              cb.addEventListener('change', () => {
                const k = leftoverKey(p.account, item.url);
                if (cb.checked) leftoverChecked.add(k);
                else leftoverChecked.delete(k);
                updateAutogenSummary();
              });
              const u = document.createElement('span');
              u.textContent = item.url;
              lab.appendChild(cb);
              lab.appendChild(u);
              wrap.appendChild(lab);
            }
            li.appendChild(wrap);
          }
          autogenListEl.appendChild(li);
        }
      }
      updateAutogenSummary();
    }

    async function loadSourcePool() {
      const listId = encodeURIComponent(getListId());
      const { ok, data } = await api(
        `/api/contentstation/character-remix-2-og?action=source-pool&listId=${listId}`,
      );
      sourcePool = ok && Array.isArray(data?.accounts) ? data.accounts : [];
      const titleEl = document.getElementById('autogen-title');
      if (titleEl && data?.listName) {
        titleEl.textContent = `Autogenerate from ${data.listName}`;
      }
      renderAutogen();
      return sourcePool;
    }

    function pickRandom(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    function isReplaceableCreateFailure(data) {
      const err = String(data?.error || '');
      return (
        err === 'file_too_large' ||
        err === 'source_is_speech' ||
        err === 'too_many_scenes' ||
        err === 'resolve_rejected' ||
        err === 'resolve_rate_limited' ||
        err === 'tiktok_download_failed'
      );
    }

    function formatCreateFailure(data, status) {
      const detail =
        (typeof data?.detail === 'string' && data.detail.trim()) ||
        (typeof data?.message === 'string' && data.message.trim()) ||
        '';
      const err = String(data?.error || '');
      if (err === 'file_too_large') {
        return detail ? `Too large (${detail})` : 'Too large (over 40MB)';
      }
      if (err === 'source_is_speech') {
        return 'Spoken dialogue — moved to GLP-1 Speech audio list';
      }
      if (err === 'too_many_scenes') {
        const n = Number(data?.shotCount);
        const max = Number(data?.maxScenes) || 6;
        if (Number.isFinite(n) && n > 0) return `${n} scenes (max ${max}) — removed + blocklisted`;
        return `Too many scenes (max ${max}) — removed + blocklisted`;
      }
      if (detail) return detail;
      if (err) return err;
      if (status) return `Create failed (HTTP ${status})`;
      return 'Create failed';
    }

    function nextLeftoverUrl(leftover, exclude) {
      const pool = (leftover || []).filter((item) => item?.url && !exclude.has(item.url));
      return pickRandom(pool)?.url || null;
    }

    function setDupBanner(skipped, account) {
      if (!dupBanner) return;
      if (!skipped.length) {
        dupBanner.hidden = true;
        dupBanner.innerHTML = '';
        return;
      }
      const title = document.createElement('p');
      title.className = 'duplicate-skip-title';
      title.textContent = account
        ? `Already remixed for ${account} — skipped:`
        : 'Already remixed for selected account(s) — skipped:';
      const ul = document.createElement('ul');
      for (const u of skipped.slice(0, 12)) {
        const li = document.createElement('li');
        li.textContent = u;
        ul.appendChild(li);
      }
      dupBanner.innerHTML = '';
      dupBanner.appendChild(title);
      dupBanner.appendChild(ul);
      dupBanner.hidden = false;
    }

    function setBusy(on) {
      submitting = on;
      if (onBusy) onBusy(on);
      if (runBtn) runBtn.disabled = on;
      updateAutogenSummary();
    }

    async function runLeftoverAutogen() {
      setError('');
      const plan = plannedAutogenJobs();
      if (!plan.jobs.length) {
        setError(plan.blocked[0] || 'Check accounts that have a character and leftovers.');
        return;
      }
      const work = [];
      for (const job of plan.jobs) {
        if (job.url) {
          work.push({
            account: job.account,
            characterKey: job.characterKey,
            url: job.url,
            leftover: poolFor(job.account)?.leftover || job.leftover || [],
          });
          continue;
        }
        const leftovers = job.leftover || [];
        if (!leftovers.length) continue;
        work.push({
          account: job.account,
          characterKey: job.characterKey,
          url: null,
          leftover: leftovers,
        });
      }
      if (!work.length) {
        setError('No leftover URLs to autogenerate.');
        return;
      }
      setBusy(true);
      try {
        const baseTitle = getTitle();
        const started = [];
        const failures = [];
        const skipped = [];
        const replaced = [];
        setDupBanner([]);
        for (let i = 0; i < work.length; i++) {
          const item = work[i];
          const tried = new Set();
          const maxAttempts = Math.max(
            1,
            Math.min(8, (item.leftover || []).length || (item.url ? 1 : 0)),
          );
          let url = item.url || nextLeftoverUrl(item.leftover, tried);
          let created = null;
          let lastDetail = '';

          for (let attempt = 0; attempt < maxAttempts && url; attempt++) {
            tried.add(url);
            setStatus(
              `Autogenerate ${i + 1} / ${work.length}`,
              attempt === 0
                ? `${item.account} · ${url}`
                : `${item.account} · replace #${attempt} · ${url}`,
            );
            const body = buildCreateBody({
              url,
              account: item.account,
              characterKey: item.characterKey,
              voiceId: item.voiceId,
              voiceLabel: item.voiceLabel,
              title: work.length > 1 ? `${baseTitle} (${item.account})` : baseTitle,
              listId: getListId(),
            });
            const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
              method: 'POST',
              body: JSON.stringify(body),
            });
            if (data?.error === 'already_remixed_for_account') {
              skipped.push(url);
              setDupBanner(skipped, item.account);
              url = nextLeftoverUrl(item.leftover, tried);
              continue;
            }
            if (!ok || !data?.jobId) {
              lastDetail = formatCreateFailure(data, status);
              if (isReplaceableCreateFailure(data)) {
                replaced.push(`${item.account}: ${lastDetail} → trying another leftover`);
                url = nextLeftoverUrl(item.leftover, tried);
                continue;
              }
              failures.push(`${item.account}: ${lastDetail}`);
              created = null;
              break;
            }
            created = { data, url };
            break;
          }

          if (!created) {
            if (!failures.some((f) => f.startsWith(`${item.account}:`))) {
              failures.push(
                `${item.account}: ${lastDetail || 'No usable leftover after rejects/skips'}`,
              );
            }
            continue;
          }

          started.push({
            jobId: created.data.jobId,
            tiktokUrl: created.url,
            title: created.data.title || baseTitle,
            account: item.account,
            characterKey: item.characterKey,
            stage: created.data.stage || 'queued',
          });
        }

        await loadSourcePool();
        if (!started.length) {
          if (skipped.length && !failures.length) {
            setStatus('All skipped', 'Those leftovers were already remixed for the selected accounts.');
            return;
          }
          throw new Error(failures[0] || 'Autogenerate did not start any jobs.');
        }
        if (failures.length || replaced.length) {
          setError([...replaced, ...failures].filter(Boolean).join('\n'));
        }
        setStatus(
          `Autogenerated ${started.length} job(s)${skipped.length ? ` · ${skipped.length} skipped` : ''}${
            replaced.length ? ` · ${replaced.length} replaced` : ''
          }`,
          'Each job uses that account’s character. Pipelines queue on Fast Panda.',
        );
        if (onJobsStarted) onJobsStarted(started);
      } catch (err) {
        setError(err?.message || String(err));
        setStatus('Failed');
      } finally {
        setBusy(false);
      }
    }

    async function runPasteAutogen() {
      setError('');
      const plan = plannedPasteJobs();
      if (!plan.jobs.length) {
        setError(plan.blocked[0] || 'Paste URLs and select accounts.');
        return;
      }
      setBusy(true);
      try {
        const baseTitle = getTitle();
        const started = [];
        const failures = [];
        const skipped = [];
        setDupBanner([]);
        for (let i = 0; i < plan.jobs.length; i++) {
          const item = plan.jobs[i];
          setStatus(`Autogenerate pasted ${i + 1} / ${plan.jobs.length}`, `${item.account} · ${item.url}`);
          const body = buildCreateBody({
            url: item.url,
            account: item.account,
            characterKey: item.characterKey,
            voiceId: item.voiceId,
            voiceLabel: item.voiceLabel,
            title: `${baseTitle} (${item.account})`,
            listId: getListId(),
          });
          const { ok, status, data } = await api('/api/contentstation/character-remix-2-og', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          if (data?.error === 'already_remixed_for_account') {
            skipped.push(item.url);
            setDupBanner(skipped, item.account);
            continue;
          }
          if (!ok || !data?.jobId) {
            failures.push(`${item.account}: ${formatCreateFailure(data, status)}`);
            continue;
          }
          started.push({
            jobId: data.jobId,
            tiktokUrl: item.url,
            title: data.title || baseTitle,
            account: item.account,
            characterKey: item.characterKey,
            stage: data.stage || 'queued',
          });
        }
        await loadSourcePool();
        if (!started.length) {
          if (skipped.length && !failures.length) {
            setStatus('All skipped', 'Those URLs were already remixed for the selected accounts.');
            return;
          }
          throw new Error(failures[0] || 'Autogenerate did not start any jobs.');
        }
        if (failures.length) setError(failures.join('\n'));
        setStatus(
          `Autogenerated ${started.length} job(s)${skipped.length ? ` · ${skipped.length} skipped` : ''}`,
          'Pipelines queue on Fast Panda.',
        );
        if (onJobsStarted) onJobsStarted(started);
      } catch (err) {
        setError(err?.message || String(err));
        setStatus('Failed');
      } finally {
        setBusy(false);
      }
    }

    autogenRandomEl?.addEventListener('change', () => renderAutogen());
    autogenSelectAllBtn?.addEventListener('click', () => selectAllAutogenAccounts());
    autogenSelectNoneBtn?.addEventListener('click', () => selectNoneAutogenAccounts());
    autogenBtn?.addEventListener('click', () => runLeftoverAutogen());
    autogenPasteBtn?.addEventListener('click', () => runPasteAutogen());
    tiktokUrls?.addEventListener('input', () => updateAutogenSummary());

    return {
      loadSourcePool,
      refresh: loadSourcePool,
      updateSummary: updateAutogenSummary,
      isBusy: () => submitting,
    };
  }

  window.CSRemix2Autogen = { createController, MAX_URLS };
})();
