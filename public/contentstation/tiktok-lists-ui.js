/**
 * Shared TikTok URL-list picker (GLP-1 List and others).
 */
(function () {
  const DEFAULT_ID = 'glp-1';

  function createController(opts) {
    const api = opts.api;
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    const select = document.getElementById('url-list-select');
    const form = document.getElementById('create-url-list-form');
    const nameInput = document.getElementById('new-url-list-name');
    const meta = document.getElementById('url-list-meta');
    const errEl = document.getElementById('url-list-error');
    /** @type {{ id: string, name: string, count: number }[]} */
    let lists = [];

    function setError(msg) {
      if (!errEl) return;
      if (msg) {
        errEl.hidden = false;
        errEl.textContent = msg;
      } else {
        errEl.hidden = true;
        errEl.textContent = '';
      }
    }

    function selected() {
      return (select && select.value ? select.value : DEFAULT_ID).trim() || DEFAULT_ID;
    }

    function current() {
      const id = selected();
      return lists.find((l) => l.id === id) || lists[0] || { id: DEFAULT_ID, name: 'GLP-1 List', count: 0 };
    }

    function fill(prefer) {
      if (!select) return;
      const keep = prefer || select.value || DEFAULT_ID;
      select.innerHTML = '';
      for (const list of lists) {
        const opt = document.createElement('option');
        opt.value = list.id;
        opt.textContent = `${list.name} (${list.count})`;
        select.appendChild(opt);
      }
      if ([...select.options].some((o) => o.value === keep)) select.value = keep;
      else if ([...select.options].some((o) => o.value === DEFAULT_ID)) select.value = DEFAULT_ID;
      const cur = current();
      if (meta) {
        meta.textContent = cur
          ? `${cur.count} video${cur.count === 1 ? '' : 's'} on ${cur.name}`
          : '';
      }
    }

    async function load() {
      setError('');
      const { ok, data } = await api('/api/contentstation/tiktok-lists?action=list');
      if (!ok || !Array.isArray(data?.lists)) {
        setError((data && (data.message || data.error)) || 'Could not load URL lists.');
        return lists;
      }
      lists = data.lists;
      fill();
      return lists;
    }

    select?.addEventListener('change', () => {
      fill(select.value);
      if (onChange) onChange(selected(), current());
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = (nameInput?.value || '').trim();
      if (!name) {
        setError('Enter a list name.');
        return;
      }
      setError('');
      const { ok, data } = await api('/api/contentstation/tiktok-lists', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', name }),
      });
      if (!ok) {
        setError((data && (data.message || data.error)) || 'Could not create list.');
        return;
      }
      lists = data.lists || lists;
      if (nameInput) nameInput.value = '';
      fill(data.list?.id);
      if (onChange) onChange(selected(), current());
    });

    return { load, selected, current, refresh: load };
  }

  window.CSTikTokLists = { DEFAULT_ID, createController };
})();
