#!/usr/bin/env python3
"""Generate wolfroots + pawlife advertorial HTML templates."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "templates"
BASE = "https://artigos.mimiepipo.com.br"
W = f"{BASE}/prelander/wolfroots"
P = f"{BASE}/prelander/pawlife"
M = f"{BASE}/prelander/mimiepipo"

CTA = "VERIFICAR ESTOQUE EXCLUSIVO PARA LEITORAS"
CTA_SHORT = "Ver Digestão Saudável — Garantia de 60 dias"


def wolfroots_template() -> str:
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>__PAGE_TITLE__</title>
  <meta name="description" content="Advertorial — saúde intestinal do cão. Mimi &amp; Pipo Digestão Saudável.">
  <meta name="robots" content="noindex, nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700;900&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  __META_PIXEL_HEAD__
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    html {{ -webkit-text-size-adjust: 100%; }}
    body {{
      margin: 0;
      background: #fff;
      color: #222;
      font-family: "Open Sans", system-ui, sans-serif;
      font-size: 17px;
      line-height: 1.65;
      padding-bottom: 92px;
    }}
    img {{ max-width: 100%; height: auto; display: block; }}
    a {{ color: inherit; }}
    .wr-topbar {{
      background: #f5f5f5;
      border-bottom: 1px solid #e5e5e5;
      padding: 10px 16px;
      font-size: 13px;
      color: #666;
    }}
    .wr-wrap {{ max-width: 760px; margin: 0 auto; padding: 0 16px 48px; }}
    .wr-dek {{
      margin: 24px 0 12px;
      font-family: Merriweather, Georgia, serif;
      font-size: 22px;
      line-height: 1.35;
      font-weight: 900;
      color: #111;
    }}
    .wr-subdek {{
      margin: 0 0 18px;
      font-family: Merriweather, Georgia, serif;
      font-size: 18px;
      line-height: 1.4;
      color: #333;
    }}
    .wr-meta {{
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: center;
      margin: 0 0 24px;
      font-size: 14px;
      color: #555;
      border-bottom: 1px solid #eee;
      padding-bottom: 16px;
    }}
    .wr-stars {{ color: #f5a623; letter-spacing: 1px; font-weight: 700; }}
    .wr-h1 {{
      margin: 28px 0 18px;
      font-family: Merriweather, Georgia, serif;
      font-size: 28px;
      line-height: 1.25;
      font-weight: 900;
      color: #111;
    }}
    .wr-hero {{ margin: 0 0 8px; border-radius: 6px; overflow: hidden; }}
    .wr-adcopy {{ margin: 0 0 28px; }}
    .wr-adcopy .pag-adcopy {{ margin-bottom: 48px; font-size: 17px; line-height: 1.65; }}
    .wr-adcopy .pag-h2 {{ font-family: Merriweather, Georgia, serif; font-size: 22px; margin: 32px 0 16px; }}
    .wr-body p, .wr-body li {{ margin: 0 0 16px; }}
    .wr-body h2 {{
      margin: 36px 0 16px;
      font-family: Merriweather, Georgia, serif;
      font-size: 24px;
      line-height: 1.25;
      font-weight: 900;
      color: #111;
    }}
    .wr-body h3 {{
      margin: 28px 0 12px;
      font-size: 19px;
      font-weight: 700;
      color: #111;
    }}
    .wr-img {{ margin: 20px 0; border-radius: 6px; overflow: hidden; }}
    .wr-quote {{
      margin: 24px 0;
      padding: 16px 18px;
      border-left: 4px solid #2d8659;
      background: #f7fbf8;
      font-style: italic;
    }}
    .wr-list {{ margin: 0 0 16px; padding-left: 1.25rem; }}
    .wr-list li {{ margin-bottom: 10px; }}
    .wr-cta-wrap {{ margin: 28px 0; text-align: center; }}
    .wr-cta {{
      display: block;
      width: 100%;
      background: #2d8659;
      color: #fff !important;
      text-decoration: none;
      font-size: 17px;
      font-weight: 700;
      line-height: 1.35;
      padding: 18px 22px;
      border-radius: 6px;
      text-align: center;
    }}
    .wr-cta-note {{ margin: 14px 0 0; font-size: 15px; color: #444; text-align: center; }}
    .wr-testi {{
      margin: 24px 0;
      padding: 18px 0;
      border-top: 1px solid #eee;
    }}
    .wr-testi strong {{ display: block; margin-top: 10px; }}
    .wr-badge {{ max-width: 280px; margin: 16px auto; }}
    .wr-grid2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin: 20px 0;
    }}
    .wr-stock {{
      background: #fff8e6;
      border: 1px solid #e8c96b;
      border-radius: 6px;
      padding: 14px 16px;
      margin: 20px 0;
      font-size: 16px;
    }}
    .wr-footer {{
      background: #222;
      color: rgba(255,255,255,.65);
      padding: 24px 16px 28px;
      font-size: 11px;
      line-height: 1.5;
      text-align: center;
    }}
    .wr-footer a {{ color: rgba(255,255,255,.85); }}
    .wr-footer ul {{ list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 16px; }}
    .pag-sticky-cta {{
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
      background: rgba(255,255,255,.96);
      border-top: 1px solid rgba(45,134,89,.35);
      box-shadow: 0 -4px 16px rgba(0,0,0,.08);
    }}
    .pag-sticky-cta-btn {{ font-size: 14px; padding: 14px 16px; }}
    .pag-cta-btn {{
      display: block; width: 100%; background: #2d8659; color: #fff !important;
      text-decoration: none; font-size: 16px; font-weight: 700; line-height: 1.35;
      padding: 16px 24px; border-radius: 4px; text-align: center; border: none;
    }}
    .pag-cta-wrap {{ margin: 20px 0; text-align: center; }}
    .pag-cta-btn--green {{ background: #2d8659; }}
    .pag-adcopy-spacer {{ height: 28px; }}
    ul.pag-problems {{ margin: 0 0 20px; padding-left: 1.25rem; }}
    @media (max-width: 600px) {{
      .wr-grid2 {{ grid-template-columns: 1fr; }}
      .wr-h1 {{ font-size: 24px; }}
      .wr-dek {{ font-size: 19px; }}
    }}
    @media (min-width: 750px) {{
      .wr-wrap {{ padding: 0 24px 56px; }}
      .wr-h1 {{ font-size: 32px; }}
    }}
  </style>
</head>
<body>
  <div class="wr-topbar">Início &gt; Pets &gt; Nutrição Canina</div>
  <div class="wr-wrap">
    <p class="wr-dek">A descoberta que milhares de tutores brasileiros fizeram sobre por que a barriga do cão nunca estabiliza de verdade</p>
    <p class="wr-subdek">E o petisco diário de 30 segundos que está devolvendo cocô firme, menos coceira e mais energia — sem trocar a ração</p>
    <div class="wr-meta">
      <span class="wr-stars">⭐ ⭐ ⭐ ⭐ ⭐ 4,7/5 — 635+ avaliações</span>
      <span>Por Dra. Camila Rocha, MV | __PUBLISHED_DATE__</span>
    </div>

    <h1 class="wr-h1">__AD_HEADLINE__</h1>
    <div class="wr-hero"><img src="__HERO__" alt="__HERO_ALT__" width="1080" height="1350" loading="eager" decoding="async"></div>
    <div class="wr-adcopy">__AD_COPY_BODY__</div>

    <article class="wr-body">
      <p>A Dra. Camila viu a mesma cena centenas de vezes na clínica: cães com barriga sensível, cocô irregular, coceira que volta, vômito “de leve” — e tutores exaustos depois de meses tentando remédio, ração cara e probiótico que só funciona por alguns dias.</p>
      <div class="wr-img"><img src="{W}/01.jpg" alt="Cão com desconforto abdominal" loading="lazy"></div>
      <p>O veterinário sempre dizia a mesma coisa: “É stress, é idade, é alergia.” Mas algo não fechava. Cães jovens piorando rápido. Idosos apagando antes da hora. E a conta subindo todo mês.</p>

      <h2>O momento em que tudo mudou</h2>
      <p>Num congresso de nutrição veterinária, a Dra. Camila ouviu uma frase que ficou martelando:</p>
      <div class="wr-quote">“O intestino do cão moderno está faminto — não de comida, mas do que alimenta a flora certa. Sem isso, probiótico vira visita temporária.”</div>
      <div class="wr-img"><img src="{W}/06.webp" alt="Comparação intestino saudável vs desequilibrado" loading="lazy"></div>
      <p>Cães compartilham quase todo o DNA com lobos. A diferença não é o corpo — é o que entra nele todo dia. Ração ultra-processada, antibióticos, vermífugos repetidos e zero prebiótico real deixam a mucosa frágil e a microbiota confusa.</p>

      <h2>Por que 80% dos “tratamentos de barriga” falham</h2>
      <ul class="wr-list">
        <li><strong>Probiótico sozinho</strong> — bactéria boa sem comida na tripa morre rápido.</li>
        <li><strong>Só fibras genéricas</strong> — empurram o cocô, não reparam a parede intestinal.</li>
        <li><strong>Ração “digestiva” cara</strong> — mesmo ultraprocessamento, embalagem diferente.</li>
        <li><strong>Antibiótico repetido</strong> — mata o mal e boa parte do que restava de equilíbrio.</li>
      </ul>
      <div class="wr-img"><img src="{W}/07.webp" alt="Ciclo de desequilíbrio intestinal" loading="lazy"></div>
      <p>Quando a parede intestinal fica permeável, toxinas e proteínas mal digeridas escapam para a corrente sanguínea. O corpo reage com inflamação. A pele coça. A glândula anal entope. O cheiro fica forte. Giardia volta. O cão come grama de desespero.</p>

      <h2>O que a ração moderna não entrega (e o lobo ainda recebe)</h2>
      <div class="wr-badge"><img src="{W}/05.png" alt="Avaliações 4,7 de 5" loading="lazy"></div>
      <div class="wr-grid2">
        <div class="wr-img"><img src="{W}/08.webp" alt="Nutrientes prebióticos naturais" loading="lazy"></div>
        <div class="wr-img"><img src="{W}/09.webp" alt="Suporte à mucosa intestinal" loading="lazy"></div>
      </div>
      <div class="wr-img"><img src="{W}/11.webp" alt="Comparativo abordagem intestinal" loading="lazy"></div>
      <p>Seu cão ainda espera o suporte intestinal que ancestrais recebiam — mas a tigela moderna entrega calorias, não reparação de mucosa.</p>

      <h2>Por que veterinários de confiança passaram a recomendar prebiótico estruturado</h2>
      <div class="wr-grid2">
        <div class="wr-img"><img src="{W}/12.webp" alt="Passo 1 protocolo" loading="lazy"></div>
        <div class="wr-img"><img src="{W}/13.webp" alt="Passo 2 protocolo" loading="lazy"></div>
      </div>
      <div class="wr-img"><img src="{W}/14.webp" alt="Resultados consistentes em 21 dias" loading="lazy"></div>

      <h2>A solução não era complicada</h2>
      <p>A Dra. Camila passou meses cruzando estudos sobre prebióticos, Boswellia, gengibre, Yucca e microalgas — nutrientes que nutrem a flora existente e acalmam a mucosa, em vez de forçar mais uma “bactéria visitante”.</p>
      <div class="wr-img"><img src="{M}/ingredients.png" alt="Ingredientes Digestão Saudável" loading="lazy"></div>
      <p>O que faltava no mercado brasileiro era um petisco diário, palatável, formulado por veterinários, sem maltodextrina nem corante — algo que o tutor conseguia manter por 21 a 28 dias seguidos.</p>

      <div class="wr-cta-wrap">
        <a class="wr-cta" href="__PDP__">{CTA_SHORT}</a>
        <p class="wr-cta-note">30% de desconto + frete grátis para leitoras desta página</p>
      </div>

      <h2>Conheça o Digestão Saudável da Mimi &amp; Pipo</h2>
      <div class="wr-grid2">
        <div class="wr-img"><img src="{M}/product-jar.png" alt="Pote Digestão Saudável" loading="lazy"></div>
        <div>
          <p>Biscoitos prebióticos desenvolvidos no Brasil. Um ritual de 30 segundos por dia — o cão come como petisco, você não precisa esconder cápsula na comida.</p>
          <ul class="wr-list">
            <li>Complexo de leveduras prebióticas</li>
            <li>Boswellia + gengibre + espirulina</li>
            <li>Yucca para odor e trânsito</li>
            <li>Sem conservantes artificiais</li>
          </ul>
        </div>
      </div>
      <div class="wr-img"><img src="{M}/benefits.png" alt="Benefícios do protocolo intestinal" loading="lazy"></div>

      <h2>O que tutores relatam nas primeiras semanas</h2>
      <div class="wr-testi">
        <p>“Em cinco dias o cocô firmou. Parei de acordar às três da manhã.”</p>
        <strong>— Fernanda, tutora da Nina (SRD, 8 anos)</strong>
      </div>
      <div class="wr-testi">
        <p>“A coceira nas patas diminuiu antes da pele. Ninguém acreditava que era intestino.”</p>
        <strong>— Ricardo, tutor do Fred (Golden, 5 anos)</strong>
      </div>
      <div class="wr-testi">
        <p>“Giardia voltou três vezes. Na quarta vez eu cuidei da barriga — não só do vermífugo.”</p>
        <strong>— Aline, tutora do Thor (Border Collie, 3 anos)</strong>
      </div>
      <div class="wr-img"><img src="{W}/25.jpg" alt="Cão feliz após recuperação intestinal" loading="lazy"></div>

      <h2>Como usar (simples de verdade)</h2>
      <div class="wr-img"><img src="{M}/dose.png" alt="Dosagem por peso" loading="lazy"></div>
      <ol class="wr-list">
        <li>Clique abaixo e verifique se ainda há estoque promocional.</li>
        <li>Escolha 2 potes para cobrir 21–28 dias (30% OFF + frete grátis).</li>
        <li>Dê os biscoitos todo dia, na dose do peso do cão.</li>
        <li>Observe energia, cocô e coceira entre os dias 3 e 14.</li>
      </ol>

      <div class="wr-stock"><strong>⚠ Estoque limitado para leitoras:</strong> a Mimi &amp; Pipo reservou unidades com 30% de desconto e frete grátis nesta página. Quando acabar, volta ao preço cheio do site.</div>

      <div class="wr-cta-wrap">
        <p>Por tempo limitado: <strong>30% de desconto</strong> + <strong>frete grátis</strong> + <strong>garantia de 60 dias</strong>.</p>
        <a class="wr-cta" href="__PDP__">{CTA}</a>
        <p class="wr-cta-note">Clique acima para ver se a oferta ainda está ativa.</p>
      </div>

      <h2>E se não funcionar?</h2>
      <p>Você tem 60 dias de garantia. Se não notar melhora, devolve. O risco é continuar administrando sintoma por sintoma enquanto a causa intestinal fica lá.</p>
      <p class="wr-quote">E se funcionar? Seu cão recupera energia. Você recupera noites de sono. E para de pagar remédio que só mascara.</p>

      <h2>Perguntas frequentes</h2>
      <h3>Quanto tempo até ver diferença?</h3>
      <p>A maioria nota cocô mais firme e menos gases entre os dias 3 e 7. Coceira e energia costumam responder entre a semana 2 e 4.</p>
      <h3>Funciona com ração medicamentosa?</h3>
      <p>Sim — é petisco complementar. Não substitua prescrição, mas muitos tutores mantêm junto com dieta veterinária.</p>
      <h3>Quanto tempo demora o frete?</h3>
      <p>Envio nacional. A maioria recebe em poucos dias úteis; frete grátis nesta oferta de leitoras.</p>
      <div class="wr-img"><img src="{W}/30.jpg" alt="Tutor feliz com cão saudável" loading="lazy"></div>
    </article>
  </div>

  <footer class="wr-footer">
    <p style="font-style:italic;margin-bottom:12px;">Este conteúdo não substitui orientação veterinária.</p>
    <ul>
      <li><a href="https://mimiepipo.com.br/pages/termos-e-condicoes">Termos</a></li>
      <li><a href="https://mimiepipo.com.br/pages/politica-de-privacidade">Privacidade</a></li>
      <li><a href="https://mimiepipo.com.br/pages/regras-de-afiliados">Afiliados</a></li>
    </ul>
    <p>&copy; __FOOTER_YEAR__ Mimi &amp; Pipo. Todos os direitos reservados.</p>
    <p>Este produto não se destina a diagnosticar, tratar, curar ou prevenir doenças.</p>
  </footer>

  __STICKY_CTA__
  __META_PIXEL_SCRIPT__
</body>
</html>
"""


def pawlife_template() -> str:
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>__PAGE_TITLE__</title>
  <meta name="description" content="Advertorial — mecanismo intestinal. Mimi &amp; Pipo Digestão Saudável.">
  <meta name="robots" content="noindex, nofollow">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Open+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  __META_PIXEL_HEAD__
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    html {{ -webkit-text-size-adjust: 100%; }}
    body {{
      margin: 0;
      background: #fff;
      color: #222;
      font-family: "Open Sans", system-ui, sans-serif;
      font-size: 17px;
      line-height: 1.65;
      padding-bottom: 96px;
    }}
    img {{ max-width: 100%; height: auto; display: block; }}
    a {{ color: inherit; }}
    .pl-topbar {{
      background: #f4f4f4;
      border-bottom: 1px solid #e0e0e0;
      padding: 10px 16px;
      font-size: 13px;
      color: #666;
    }}
    .pl-shell {{ max-width: 1170px; margin: 0 auto; padding: 0 16px 48px; }}
    .pl-layout {{
      display: block;
      margin-top: 20px;
    }}
    .pl-main {{ min-width: 0; }}
    .pl-sidebar {{
      display: none;
    }}
    .pl-hook {{
      font-family: Montserrat, sans-serif;
      font-size: 26px;
      line-height: 1.25;
      font-weight: 800;
      color: #111;
      margin: 20px 0 12px;
    }}
    .pl-hook-sub {{
      font-size: 18px;
      line-height: 1.45;
      color: #444;
      margin: 0 0 20px;
      font-style: italic;
    }}
    .pl-author {{
      display: flex;
      gap: 14px;
      align-items: center;
      margin: 0 0 24px;
      padding-bottom: 18px;
      border-bottom: 1px solid #eee;
    }}
    .pl-author img {{ width: 72px; height: 72px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }}
    .pl-author-name {{ font-weight: 700; font-size: 16px; }}
    .pl-author-title {{ font-size: 14px; color: #555; }}
    .pl-h1 {{
      font-family: Montserrat, sans-serif;
      font-size: 28px;
      line-height: 1.25;
      font-weight: 800;
      margin: 24px 0 16px;
      color: #111;
    }}
    .pl-hero {{ margin: 0 0 12px; border-radius: 8px; overflow: hidden; }}
    .pl-adcopy {{ margin-bottom: 28px; }}
    .pl-adcopy .pag-adcopy {{ margin-bottom: 48px; }}
    .pl-body p, .pl-body li {{ margin: 0 0 16px; }}
    .pl-body h2 {{
      font-family: Montserrat, sans-serif;
      font-size: 24px;
      line-height: 1.25;
      font-weight: 800;
      margin: 36px 0 16px;
      color: #111;
    }}
    .pl-body h3 {{ font-size: 19px; font-weight: 700; margin: 24px 0 12px; }}
    .pl-img {{ margin: 20px 0; border-radius: 8px; overflow: hidden; }}
    .pl-highlight {{
      background: #f0faf4;
      border-left: 4px solid #2d8659;
      padding: 16px 18px;
      margin: 24px 0;
    }}
    .pl-list {{ padding-left: 1.25rem; margin: 0 0 16px; }}
    .pl-list li {{ margin-bottom: 10px; }}
    .pl-cta-wrap {{ margin: 28px 0; text-align: center; }}
    .pl-cta {{
      display: inline-block;
      width: 100%;
      max-width: 520px;
      background: #2d8659;
      color: #fff !important;
      text-decoration: none;
      font-family: Montserrat, sans-serif;
      font-size: 17px;
      font-weight: 800;
      line-height: 1.35;
      padding: 18px 22px;
      border-radius: 8px;
      text-transform: uppercase;
      letter-spacing: .3px;
    }}
    .pl-cta-note {{ margin-top: 12px; font-size: 15px; color: #444; }}
    .pl-review {{
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
      background: #fafafa;
    }}
    .pl-review-stars {{ color: #f5a623; margin-bottom: 8px; }}
    .pl-offer-box {{
      background: #fff8e6;
      border: 2px solid #e8c96b;
      border-radius: 8px;
      padding: 18px;
      margin: 24px 0;
      text-align: center;
    }}
    .pl-sidebar-card {{
      background: #f7f7f7;
      border: 1px solid #e5e5e5;
      border-radius: 8px;
      padding: 18px;
      position: sticky;
      top: 16px;
    }}
    .pl-sidebar-card img {{ margin: 0 auto 12px; max-width: 180px; }}
    .pl-footer {{
      background: #222;
      color: rgba(255,255,255,.65);
      padding: 24px 16px;
      font-size: 11px;
      text-align: center;
    }}
    .pl-footer a {{ color: rgba(255,255,255,.85); }}
    .pl-sticky {{
      position: fixed;
      left: 0; right: 0; bottom: 0;
      z-index: 1001;
      transform: translateY(110%);
      transition: transform .25s ease;
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
      background: rgba(45,134,89,.97);
      box-shadow: 0 -6px 20px rgba(0,0,0,.15);
    }}
    .pl-sticky.is-visible {{ transform: translateY(0); }}
    .pl-sticky a {{
      display: block;
      color: #fff !important;
      text-decoration: none;
      font-family: Montserrat, sans-serif;
      font-weight: 800;
      font-size: 15px;
      text-align: center;
      line-height: 1.35;
    }}
    .pag-cta-btn {{
      display: block; width: 100%; background: #2d8659; color: #fff !important;
      text-decoration: none; font-size: 16px; font-weight: 700; line-height: 1.35;
      padding: 16px 24px; border-radius: 4px; text-align: center;
    }}
    .pag-cta-wrap {{ margin: 20px 0; text-align: center; }}
    .pag-adcopy-spacer {{ height: 28px; }}
    ul.pag-problems {{ margin: 0 0 20px; padding-left: 1.25rem; }}
    @media (min-width: 960px) {{
      .pl-layout {{
        display: grid;
        grid-template-columns: minmax(0, 1fr) 300px;
        gap: 32px;
        align-items: start;
      }}
      .pl-sidebar {{ display: block; }}
    }}
    @media (max-width: 600px) {{
      .pl-hook {{ font-size: 22px; }}
      .pl-h1 {{ font-size: 24px; }}
    }}
  </style>
</head>
<body>
  <div class="pl-topbar">Início &gt; Pets &gt; Saúde</div>
  <div class="pl-shell">
    <p class="pl-hook">“É por isso que 80% dos cães perdem anos de vida com a barriga ‘quase normal’”</p>
    <p class="pl-hook-sub">Quando a maioria dos tutores percebe, o dano intestinal já está instalado há meses. E quase sempre dava para prevenir.</p>

    <div class="pl-author">
      <img src="{P}/17-1752793241-1731498747-dr%20blane%20square2.webp" alt="Dr. Rafael Mendes" width="72" height="72">
      <div>
        <div class="pl-author-name">Dr. Rafael Mendes, MV</div>
        <div class="pl-author-title">Especialista em nutrição e microbiota canina · __PUBLISHED_DATE__</div>
      </div>
    </div>

    <div class="pl-layout">
      <div class="pl-main">
        <h1 class="pl-h1">__AD_HEADLINE__</h1>
        <div class="pl-hero"><img src="__HERO__" alt="__HERO_ALT__" width="1080" height="1350" loading="eager" decoding="async"></div>
        <div class="pl-adcopy">__AD_COPY_BODY__</div>

        <article class="pl-body">
          <p>Se o cocô do seu cão oscila entre mole e normal… se a coceira volta depois do banho… se o cheiro forte persiste mesmo com ração “premium”… isso não é “coisa de cachorro”. É sinal de que a barreira intestinal está pedindo socorro.</p>
          <div class="pl-img"><img src="{P}/03-1749939499-1713183115-1711366759829_bitmap.webp" alt="Ilustração intestino e microbiota" loading="lazy"></div>

          <h2>O caso que mudou minha clínica</h2>
          <p>Atendo em São Paulo há 18 anos. A Luna chegou com histórico clássico: probiótico, vermífugo, shampoo medicado, ração hipoalergênica. Exames “ok”. Tutora exausta.</p>
          <p>Seis meses depois de um protocolo prebiótico consistente — não só cápsula solta — a pele estabilizou, o cocô firmou e a glândula anal parou de incomodar. Não foi mágica. Foi mecanismo.</p>
          <div class="pl-img"><img src="{P}/08-1751286169-a1048d0d-d555-433c-9e08-1ec644f2d9d3.jpg" alt="Cão idoso recuperando vitalidade" loading="lazy"></div>

          <h2>A epidemia silenciosa na barriga do cão</h2>
          <p>Existe uma crise que não aparece no pronto-socorro às duas da manhã. É lenta. Invisível. Enquanto você acha que “só comeu algo”, bactérias erradas dominam, a mucosa inflama e toxinas escapam para o sangue.</p>
          <div class="pl-highlight">
            <strong>O que parece problema de pele, glândula, vômito ou ansiedade — muitas vezes começa no intestino.</strong>
          </div>

          <h2>Por que probiótico sozinho quase nunca resolve</h2>
          <p>Imagine jogar sementes em terra seca. Probiótico sem prebiótico é isso. A bactéria “boa” chega, não encontra alimento, e some em dias.</p>
          <ul class="pl-list">
            <li>Prebiótico alimenta a flora que <em>já mora</em> no cão</li>
            <li>Boswellia e gengibre acalmam a mucosa inflamada</li>
            <li>Yucca ajuda odor e trânsito — menos gases e cocô fétido</li>
            <li>Microalgas e ômegas apoiam pele e articulações inflamadas</li>
          </ul>
          <div class="pl-img"><img src="{P}/22-1754784687-FureverPets_Presentation_1.webp" alt="Diagrama mecanismo prebiótico" loading="lazy"></div>

          <h2>Os 4 sinais silenciosos (antes do cocô ficar líquido de novo)</h2>
          <div class="wr-grid2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0;">
            <div class="pl-img"><img src="{P}/04-1751220960-1713245435-1711461897636_4.png" alt="Sinal 1 barriga" loading="lazy"></div>
            <div class="pl-img"><img src="{P}/05-1751220968-1713245469-1711461923065_2.png" alt="Sinal 2 pele" loading="lazy"></div>
            <div class="pl-img"><img src="{P}/06-1751220977-1713245487-1711461935757_3.png" alt="Sinal 3 odor" loading="lazy"></div>
            <div class="pl-img"><img src="{P}/07-1751220987-1713245504-1711461945141_1.png" alt="Sinal 4 energia" loading="lazy"></div>
          </div>

          <h2>O que os estudos mostram (traduzido para a vida real)</h2>
          <p>Cães com microbiota diversa toleram melhor stress, antibiótico e mudança de ração. Cães com flora empobrecida reagem com coceira, diarreia e apatia — mesmo com exame “normal”.</p>
          <div class="pl-img"><img src="{M}/ingredients.png" alt="Fórmula Digestão Saudável" loading="lazy"></div>

          <div class="pl-cta-wrap">
            <a class="pl-cta" href="__PDP__">{CTA_SHORT}</a>
            <p class="pl-cta-note">30% OFF + frete grátis para leitoras · garantia 60 dias</p>
          </div>

          <h2>Resultados que vejo quando o tutor completa 21–28 dias</h2>
          <div class="pl-review">
            <div class="pl-review-stars"><img src="{P}/15-1751321630-1713201807-1711369581080_stars.webp" alt="5 estrelas" width="120" height="24"></div>
            <p>“Parei de acordar três vezes por noite. A Nina finalmente dorme.”</p>
            <strong>— Carla, 52 anos</strong>
          </div>
          <div class="pl-review">
            <div class="pl-review-stars"><img src="{P}/15-1751321630-1713201807-1711369581080_stars.webp" alt="5 estrelas" width="120" height="24"></div>
            <p>“Gastei fortuna em shampoo. O que faltava era prebiótico diário.”</p>
            <strong>— Marcos, tutor do Fred</strong>
          </div>
          <div class="pl-img"><img src="{P}/21-1754784489-1736513873-review2.webp" alt="Depoimento de tutora" loading="lazy"></div>

          <h2>Por que recomendo Digestão Saudável da Mimi &amp; Pipo</h2>
          <p>Formulado por veterinários no Brasil. Petisco palatável — não pílula escondida. Sem maltodextrina. Testes de pureza. E uma garantia de 60 dias que raramente vejo em petisco funcional.</p>
          <div class="pl-img"><img src="{M}/product-jar.png" alt="Digestão Saudável Mimi e Pipo" loading="lazy"></div>
          <div class="pl-img"><img src="{M}/dose.png" alt="Como dosar por peso" loading="lazy"></div>

          <div class="pl-offer-box">
            <p><strong>Oferta exclusiva para leitoras desta página</strong></p>
            <p>30% de desconto + frete grátis no pacote de 2 potes (protocolo completo de 21–28 dias)</p>
            <a class="pl-cta" href="__PDP__">{CTA}</a>
          </div>

          <h2>Sua escolha hoje</h2>
          <p>Continuar tratando sintoma por sintoma — ou dar ao intestino do seu cão o suporte prebiótico que a ração moderna não entrega.</p>
          <p>A demanda subiu depois que este artigo circulou. O estoque promocional não é garantido amanhã.</p>

          <div class="pl-cta-wrap">
            <a class="pl-cta" href="__PDP__">{CTA}</a>
            <p class="pl-cta-note">Clique para verificar estoque e desconto de 30%</p>
          </div>
        </article>
      </div>

      <aside class="pl-sidebar">
        <div class="pl-sidebar-card">
          <img src="{M}/product-jar.png" alt="Digestão Saudável">
          <p style="font-family:Montserrat,sans-serif;font-weight:800;font-size:16px;margin:0 0 8px;">Digestão Saudável</p>
          <p style="font-size:14px;margin:0 0 12px;">Prebiótico diário · Mimi &amp; Pipo</p>
          <p style="font-size:14px;margin:0 0 14px;"><strong>30% OFF</strong> + frete grátis para leitoras</p>
          <a class="pl-cta" href="__PDP__" style="font-size:14px;padding:14px;">Ver oferta</a>
        </div>
      </aside>
    </div>
  </div>

  <footer class="pl-footer">
    <p style="font-style:italic;margin-bottom:10px;">Conteúdo informativo — consulte seu veterinário.</p>
    <p><a href="https://mimiepipo.com.br/pages/politica-de-privacidade">Privacidade</a> · <a href="https://mimiepipo.com.br/pages/termos-e-condicoes">Termos</a></p>
    <p>&copy; __FOOTER_YEAR__ Mimi &amp; Pipo</p>
  </footer>

  <div class="pl-sticky" id="plSticky" role="region" aria-label="Oferta">
    <a href="__PDP__">Ganhe 30% de desconto + frete grátis — Digestão Saudável</a>
  </div>

  __META_PIXEL_SCRIPT__
  <script>
  (function () {{
    var el = document.getElementById('plSticky');
    if (!el) return;
    function sync() {{ el.classList.toggle('is-visible', window.scrollY > 1300); }}
    window.addEventListener('scroll', sync, {{ passive: true }});
    sync();
  }})();
  </script>
</body>
</html>
"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "wolfroots.template.html").write_text(wolfroots_template(), encoding="utf-8")
    (OUT / "pawlife.template.html").write_text(pawlife_template(), encoding="utf-8")
    # Keep legacy path as wolfroots default
    legacy = ROOT / "public" / "advertorial.template.html"
    legacy.write_text(wolfroots_template(), encoding="utf-8")
    print(f"Wrote templates to {OUT} and {legacy}")


if __name__ == "__main__":
    main()
