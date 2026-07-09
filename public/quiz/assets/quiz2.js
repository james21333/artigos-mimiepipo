/* VitalPaws-style quiz2 — loaded when ?view=quiz2 */
(function () {
  if (!document.documentElement.classList.contains('quiz2-view')) return;
  var PDP = 'https://mimiepipo.com.br/products/digestao-saudavel';
  var IMG = 'assets/quiz2/';

  var PAGES = [
    {
      type: 'intro',
      title: 'Teste de Saúde Intestinal',
      subtitle: 'Responda este quiz de 2 minutos para avaliar a saúde intestinal do seu cão:',
      side: '1745843159884.webp',
      caption: '*Desenvolvido com base em pesquisa veterinária*'
    },
    {
      type: 'choice',
      title: 'Qual a idade do seu cão?',
      side: '1745850990176.webp',
      multi: false,
      layout: 'list',
      options: [
        { id: 'pup', label: '0-1 ano (Filhote)' },
        { id: 'adult', label: '1-6 anos (Adulto)' },
        { id: 'senior', label: '6+ anos (Idoso)' }
      ]
    },
    {
      type: 'choice',
      title: 'Qual o peso do seu cão?',
      multi: false,
      layout: 'picture',
      options: [
        { id: 'small', label: 'Abaixo de 12 kg', img: '1745510107779.png' },
        { id: 'medium', label: 'Entre 12-34 kg', img: '1745510117055.png' },
        { id: 'large', label: 'Acima de 34 kg', img: '1745510121789.png' }
      ]
    },
    {
      type: 'choice',
      title: 'Seu cão come grama (ocasionalmente)?',
      side: '1745510652464.jpg',
      multi: false,
      layout: 'horizontal',
      options: [{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }]
    },
    {
      type: 'choice',
      title: 'Seu cão tem fezes moles ou diarreia com frequência?',
      side: '1745609503866.webp',
      multi: false,
      layout: 'horizontal',
      options: [{ id: 'yes', label: 'Sim' }, { id: 'no', label: 'Não' }]
    },
    {
      type: 'choice',
      title: 'Você notou gases ou inchaço no seu cão?',
      side: '1745855842953.webp',
      multi: false,
      layout: 'horizontal',
      options: [
        { id: 'often', label: 'Sim, com frequência' },
        { id: 'sometimes', label: 'Às vezes' },
        { id: 'no', label: 'Não' }
      ]
    },
    {
      type: 'choice',
      title: 'Que outros comportamentos seu cão faz com frequência?',
      subtitle: 'Marque todos que se aplicam',
      multi: true,
      layout: 'picture',
      options: [
        { id: 'paw', label: 'Lambe as patas', img: '1745609068808.webp' },
        { id: 'scratch', label: 'Coça', img: '1745609074653.webp' },
        { id: 'head', label: 'Balança a cabeça', img: '1745609081362.webp' },
        { id: 'vomit', label: 'Vomita', img: '1745609089523.webp' },
        { id: 'scoot', label: 'Arrasta o bumbum', img: '1745609097787.webp' },
        { id: 'poop', label: 'Come cocô', img: '1745609108597.webp' }
      ]
    },
    {
      type: 'choice',
      title: 'Qual a dieta do seu cão?',
      subtitle: 'Marque todos que se aplicam',
      multi: true,
      layout: 'picture',
      options: [
        { id: 'kibble', label: 'Ração seca', img: '1745609030530.webp' },
        { id: 'canned', label: 'Comida enlatada', img: '1745609023704.webp' },
        { id: 'raw', label: 'Alimento cru', img: '1745609036704.webp' },
        { id: 'home', label: 'Comida caseira', img: '1745609045054.webp' },
        { id: 'other', label: 'Outro', img: '1745606767761.png' }
      ]
    },
    {
      type: 'choice',
      title: 'Você suplementa a dieta com vitaminas, probióticos ou ômega?',
      side: '1745614900996.jpg',
      multi: false,
      layout: 'horizontal',
      options: [
        { id: 'often', label: 'Sim, regularmente' },
        { id: 'sometimes', label: 'Às vezes' },
        { id: 'no', label: 'Não' }
      ]
    },
    {
      type: 'choice',
      title: 'Por fim, quão importante é a saúde do seu cão a longo prazo?',
      side: '1745879504976.jpg',
      multi: false,
      layout: 'horizontal',
      options: [
        { id: 'extreme', label: 'Extremamente importante' },
        { id: 'important', label: 'Importante' },
        { id: 'low', label: 'Não é tão importante' }
      ]
    }
  ];

  var state = { step: 0, answers: {}, history: [0] };
  var quiz2LeadSent = false;

  function trackQuizLead() {
    if (quiz2LeadSent || typeof fbq !== 'function') return;
    quiz2LeadSent = true;
    fbq('track', 'Lead', { content_name: 'digestao-quiz-2' });
  }

  function el(id) { return document.getElementById(id); }
  function pdpUrl() {
    var incoming = new URLSearchParams(location.search);
    var p = new URLSearchParams();
    p.set('utm_source', incoming.get('utm_source') || 'quiz2');
    p.set('utm_medium', incoming.get('utm_medium') || 'artigos');
    p.set('utm_campaign', incoming.get('utm_campaign') || 'digestao-quiz-vitalpaws');
    var qs = p.toString();
    return qs ? PDP + '?' + qs : PDP;
  }

  function progressPct() {
    if (state.step <= 0) return 0;
    if (state.step >= PAGES.length) return 100;
    return Math.round((state.step / PAGES.length) * 100);
  }

  function canContinue() {
    var page = PAGES[state.step];
    if (!page || page.type !== 'choice') return true;
    var key = 'p' + state.step;
    var val = state.answers[key];
    if (page.multi) return Array.isArray(val) && val.length > 0;
    return !!val;
  }

  function render() {
    var root = el('q2-stage');
    var bar = el('q2-progress');
    var nav = el('q2-nav');
    var page = PAGES[state.step];

    bar.style.width = progressPct() + '%';
    el('q2-pct').textContent = progressPct() + '%';

    if (state.step === PAGES.length) {
      renderLoading();
      return;
    }
    if (state.step === PAGES.length + 1) {
      renderResult();
      nav.style.display = 'none';
      return;
    }

    nav.style.display = state.step === 0 || state.step >= PAGES.length ? 'none' : 'flex';
    el('q2-back').style.visibility = state.step > 1 ? 'visible' : 'hidden';
    el('q2-next').disabled = state.step > 0 && !canContinue();
    el('q2-next').textContent = state.step === 0 ? 'Começar' : 'Próximo';

    if (page.type === 'intro') {
      root.innerHTML =
        '<div class="q2-split">' +
          '<div class="q2-main">' +
            '<h1 class="q2-title">' + page.title + '</h1>' +
            '<p class="q2-sub">' + page.subtitle + '</p>' +
            '<button type="button" class="q2-start" id="q2-start-btn">Começar</button>' +
            '<p class="q2-caption">' + page.caption + '</p>' +
          '</div>' +
          '<div class="q2-side"><img src="' + IMG + page.side + '" alt=""></div>' +
        '</div>';
      el('q2-start-btn').onclick = next;
      return;
    }

    var optsHtml = '';
    if (page.layout === 'horizontal') {
      optsHtml = '<div class="q2-hopts">' + page.options.map(function (o) {
        var sel = isSelected(state.step, o.id) ? ' selected' : '';
        return '<button type="button" class="q2-hopt' + sel + '" data-id="' + o.id + '">' + o.label + '</button>';
      }).join('') + '</div>';
    } else if (page.layout === 'picture') {
      optsHtml = '<div class="q2-popts">' + page.options.map(function (o) {
        var sel = isSelected(state.step, o.id) ? ' selected' : '';
        return '<button type="button" class="q2-popt' + sel + '" data-id="' + o.id + '">' +
          '<span class="q2-pimg"><img src="' + IMG + o.img + '" alt=""></span>' +
          '<span class="q2-plabel">' + o.label + '</span></button>';
      }).join('') + '</div>';
    } else {
      optsHtml = '<div class="q2-lopts">' + page.options.map(function (o) {
        var sel = isSelected(state.step, o.id) ? ' selected' : '';
        return '<button type="button" class="q2-lopt' + sel + '" data-id="' + o.id + '">' +
          '<span class="q2-check"></span><span>' + o.label + '</span></button>';
      }).join('') + '</div>';
    }

    var sideHtml = page.side
      ? '<div class="q2-side"><img src="' + IMG + page.side + '" alt=""></div>'
      : '';

    root.innerHTML =
      '<div class="q2-split' + (page.side ? '' : ' q2-split--full') + '">' +
        '<div class="q2-main">' +
          '<h2 class="q2-qtitle">' + page.title + '</h2>' +
          (page.subtitle ? '<p class="q2-hint">' + page.subtitle + '</p>' : '') +
          optsHtml +
        '</div>' + sideHtml +
      '</div>';

    root.querySelectorAll('[data-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pick(state.step, btn.dataset.id, page.multi);
        render();
        if (!page.multi && state.step < PAGES.length) {
          setTimeout(next, 220);
        }
      });
    });
  }

  function isSelected(step, id) {
    var val = state.answers['p' + step];
    if (Array.isArray(val)) return val.indexOf(id) >= 0;
    return val === id;
  }

  function pick(step, id, multi) {
    var key = 'p' + step;
    if (multi) {
      var arr = state.answers[key] || [];
      var i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      state.answers[key] = arr;
    } else {
      state.answers[key] = id;
    }
  }

  function next() {
    if (state.step > 0 && !canContinue()) return;
    if (state.step < PAGES.length) {
      state.step++;
      state.history.push(state.step);
      render();
    }
  }

  function back() {
    if (state.history.length > 1) {
      state.history.pop();
      state.step = state.history[state.history.length - 1];
      render();
    }
  }

  function renderLoading() {
    el('q2-stage').innerHTML =
      '<div class="q2-loading">' +
        '<img src="' + IMG + 'quiz_loader.gif" alt="" width="120" height="120">' +
        '<p>Analisando as respostas...</p>' +
      '</div>';
    setTimeout(function () {
      state.step = PAGES.length + 1;
      state.history.push(state.step);
      render();
    }, 2200);
  }

  function renderResult() {
    trackQuizLead();
    el('q2-stage').innerHTML =
      '<div class="q2-result">' +
        '<h1 class="q2-title">Seus resultados:</h1>' +
        '<p class="q2-result-sub"><strong>O intestino do seu cão PRECISA DE ATENÇÃO</strong>, veja por quê:</p>' +
        '<p class="q2-result-body">Com base nas informações que você forneceu, seu cão provavelmente apresenta sinais de intestino desequilibrado e sistema imune enfraquecido — o que explica os sintomas que você notou.</p>' +
        '<img class="q2-result-img" src="' + IMG + '1745847271409.webp" alt="">' +
        '<p class="q2-result-body">Desenvolvemos um petisco diário que apoia o intestino do seu cão, atuando nas dificuldades exatas que você descreveu: <strong>Digestão Saudável</strong> da Mimi &amp; Pipo.</p>' +
        '<a class="q2-cta" href="' + pdpUrl() + '">Para a solução do seu cão →</a>' +
        '<p class="q2-caption">✅ Experimente sem risco por 60 dias!</p>' +
        '<button type="button" class="q2-restart" id="q2-restart">Refazer quiz</button>' +
      '</div>';
    el('q2-restart').onclick = function () {
      state = { step: 0, answers: {}, history: [0] };
      quiz2LeadSent = false;
      el('q2-nav').style.display = 'none';
      render();
    };
  }

  el('q2-next').onclick = function () {
    if (state.step === 0) next();
    else if (state.step === PAGES.length - 1) {
      state.step = PAGES.length;
      state.history.push(state.step);
      render();
    } else next();
  };
  el('q2-back').onclick = back;

  render();
})();
