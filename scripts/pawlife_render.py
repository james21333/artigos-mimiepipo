"""Render Paw-Life prelander body: full PT-BR copy + correct image layout."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
BLOCKS_EN = ROOT / "scripts/data/pawlife-blocks-en.json"

BITMAP = "1749939499-1713183115-1711366759829_bitmap.webp"
STARS = "1751321630-1713201807-1711369581080_stars.webp"
AVATAR = "1752793241-1731498747-dr%20blane%20square2.webp"
PRESENTATION = "1754784687-FureverPets_Presentation_1.webp"
ARROW = "1752794760-1734623169-1715414398-right.webp"
CHECK = "1747602782-Untitled%20design%20%286%29.png"
SIGN_FILES = {
    "1751220960-1713245435-1711461897636_4.png",
    "1751220968-1713245469-1711461923065_2.png",
    "1751220977-1713245487-1711461935757_3.png",
    "1751220987-1713245504-1711461945141_1.png",
}
REVIEW_AVATAR_FILES = {
    "1754784481-1731502777-Screenshot%202024-11-13%20at%2014.59.25.webp",
    "1754784489-1736513873-review2.webp",
}
REVIEW_STARS = "1753915787-1713240664-1711393011636_4_5_star_2x.webp"
OFFER_FILES = {
    "1757939915-Untitled%20design.jpg",
    "1757940390-Untitled%20design%20%284%29%20%281%29.png",
}

# Exact EN → PT for every block string (gut-health / Digestão Saudável adaptation).
TRANSLATIONS: dict[str, str] = {
    'Top Veterinarian Exposes Hidden Dog Killer:"This Is Why 80% of Dogs Are Dying 3 Years Too Soon"':
        'Veterinário renomado expõe o assassino silencioso dos cães: "É por isso que 80% morrem 3 anos antes do tempo"',
    '"By the time most dog parents notice, the damage is already done. It\'s heartbreaking because it\'s completely preventable" - Dr. Michael Thompson, Certified Canine Behavior Specialist':
        '"Quando a maioria dos tutores percebe, o dano já está feito. Dói saber que quase sempre dava para prevenir." — Dr. Rafael Mendes, MV',
    "4,892 Ratings": "4.892 avaliações",
    "By Dr. Michael Thompson": "Por Dr. Rafael Mendes, MV",
    "Jan 15, 2026": "__PUBLISHED_DATE__",
    "This dog should have lived to 13. She died at 10.": "Essa cadela deveria ter vivido até os 13. Morreu com 10.",
    'If your dog\'s breath seems "normal" but something feels off...':
        'Se o cocô do seu cão parece "quase normal", mas algo no comportamento te incomoda...',
    "If you've noticed them eating differently or dropping food...":
        "Se você notou ele comendo grama de desespero ou recusando a tigela...",
    'If you\'re doing everything "right" but still worry...':
        'Se você faz "tudo certo" e mesmo assim vive preocupada...',
    "Then what I discovered could add 3 years to your dog's life.":
        "Então o que descobri pode devolver anos de vida ao seu cão.",
    "There's a silent epidemic affecting millions of dogs.":
        "Existe uma epidemia silenciosa afetando milhões de cães.",
    "It's stealing 1-3 years from their lives.": "Está roubando 1 a 3 anos de vida deles.",
    "And the worst part?": "E o pior?",
    'What you dismiss as "dog breath" is actually the smell of death creeping through their body.':
        'O que você trata como "só barriga sensível" é, na verdade, inflamação crônica se espalhando pelo corpo.',
    "I'm talking about something 80% of dogs have by age 3.":
        "Estou falando de algo que 80% dos cães já têm antes dos 3 anos.",
    "But this isn't the dramatic emergency that has you racing to the animal hospital at 2 AM.":
        "Mas isso não é a emergência dramática que te leva correndo pro hospital veterinário às 2 da manhã.",
    "This is the invisible killer that takes years off your dog's life...":
        "Esse é o assassino invisível que tira anos da vida do seu cão...",
    "Silently poisoning their vital organs from the inside out...":
        "Envenenando silenciosamente os órgãos vitais por dentro...",
    'While you think bad breath is just part of having a dog.':
        'Enquanto você acha que cocô mole e coceira são "só coisa de cão".',
    "The Case That Changed Everything about My Practice":
        "O caso que mudou tudo na minha clínica",
    "I'm Dr. Michael Thompson.": "Sou o Dr. Rafael Mendes.",
    "I've practiced veterinary medicine for 22 years in Austin, Texas.":
        "Atuo como veterinário há 22 anos em São Paulo.",
    "Eight months ago, a family brought in Bailey—a 7-year-old Golden Retriever who'd always been perfectly healthy.":
        "Há oito meses, uma família trouxe a Bailey — uma Golden Retriever de 7 anos que sempre pareceu saudável.",
    "Annual checkups. Premium food. Daily walks.": "Check-up anual. Ração premium. Passeios diários.",
    "The perfect patient.": "A paciente perfeita.",
    "Her blood work told a different story. Kidney values through the roof.":
        "Os exames contaram outra história. Marcadores renais altíssimos.",
    "Liver enzymes triple normal. Maybe a year left.":
        "Enzimas hepáticas três vezes acima do normal. Talvez um ano.",
    '"But she just had bad breath!" her owner sobbed.':
        '"Mas ela só tinha cocô mole e coceira!" a tutora disse, chorando.',
    '"Dogs have bad breath. How was I supposed to know?"':
        '"Cão é assim. Como eu ia saber?"',
    "That's when it hit me. She was right. We've normalized something deadly.":
        "Foi quando caiu a ficha. Ela tinha razão. Normalizamos algo mortal.",
    "Bailey HAD seemed fine except for that smell. Just like thousands of other dogs I'd diagnosed too late.":
        "A Bailey PARECIA bem — exceto pela barriga instável. Igual milhares de cães que diagnostiquei tarde demais.",
    "I spent that entire weekend researching.":
        "Passei o fim de semana inteiro pesquisando.",
    "What I discovered made me question everything I'd been taught.":
        "O que descobri me fez questionar tudo que aprendi na faculdade.",
    'Your Dog\'s "Bad Breath" Is Actually 700 Species of Bacteria':
        'A "barriga sensível" do seu cão esconde um intestino permeável e flora desequilibrada',
    "I took bacterial samples from 50 dogs' mouths.":
        "Analisei amostras de microbiota de 50 cães com sintomas intestinais.",
    "Then examined them under high-powered microscopes.":
        "Comparei com exames de cães que pioravam mês a mês apesar de tratamento.",
    'Then compared them to organ tissue samples from dogs who died "mysteriously" young.':
        'A conexão era clara: disbiose crônica, inflamação sistêmica e órgãos sobrecarregados.',
    "The connection was undeniable. The same bacteria causing \"bad breath\" was embedded in kidney tissue, liver cells, and heart valves.":
        "Não era só estômago. Rim, fígado e pele pagavam a conta do intestino inflamado.",
    "Your dog's mouth contains over 700 species of bacteria.":
        "Quando a parede intestinal fica permeável, toxinas escapam para a corrente sanguínea.",
    "When gums become inflamed—which happens in 80% of dogs by age 3—these bacteria enter the bloodstream every single time your dog:":
        "Isso acontece em 80% dos cães antes dos 3 anos — e piora toda vez que o cão:",
    "Eats a meal": "Come a refeição",
    "Drinks water": "Bebe água",
    "Chews a toy": "Mastiga um brinquedo",
    "Licks their paws": "Lambe as patas (e se coça depois)",
    'But here\'s what made me angry: We call it "dental disease" like it\'s just about teeth. It\'s not. It\'s about your dog\'s entire body being under constant bacterial attack.':
        'O que me deixou irritado: chamamos de "estômago sensível" como se fosse só digestão. Não é. É o corpo inteiro sob ataque inflamatório constante.',
    "Dogs Hide Their Pain Until It's Too Late":
        "Cães escondem o mal-estar até ser tarde demais",
    "Every time bacteria enters your dog's bloodstream, a countdown begins.":
        "Cada crise intestinal reinicia um ciclo de inflamação.",
    "The kidneys—working overtime to filter toxins—develop scar tissue. The liver accumulates damage. The heart valves weaken.":
        "Os rins filtram toxinas em excesso. O fígado acumula dano. A pele coça. A glândula anal entope.",
    "Dogs evolved to hide pain. In the wild, showing weakness means death. So they suffer in silence while bacteria slowly destroys their organs from within.":
        "Cães evoluíram para esconder dor. No mato, fraqueza significa morte. Então sofrem em silêncio enquanto o intestino inflamado destrói o resto por dentro.",
    "By the time you notice symptoms beyond bad breath—lethargy, eating problems, behavior changes—up to 75% of organ function may be permanently lost.":
        "Quando você percebe além do cocô mole — apatia, grama, coceira, mau cheiro — muito dano já pode estar consolidado.",
    "I've seen this pattern thousands of times.": "Vi esse padrão milhares de vezes.",
    "Young dogs aging rapidly. Middle-aged dogs dying like elderly ones.":
        "Cães jovens envelhecendo rápido. Adultos morrendo como idosos.",
    "All because of something completely preventable.":
        "Tudo por algo completamente evitável.",
    "The Pet Industry's Profitable Secret":
        "O segredo lucrativo da indústria pet",
    "I tested every solution the pet industry sells.": "Testei cada solução que a indústria pet vende.",
    "They're all designed to fail.": "Quase todas foram feitas para falhar.",
    "❌ Dental chews?": "❌ Petiscos digestivos?",
    "Work for 10 minutes while your dog chews them. Bacteria regrows within 20 minutes.":
        "Funcionam enquanto mastiga. Em dias a barriga volta ao mesmo.",
    "❌ Toothbrushing?": "❌ Probiótico genérico?",
    "Even if you manage it daily, you're protecting teeth for 2 minutes out of 1,440 in a day.":
        "Mesmo tomando todo dia, é um visitante que some — não alimenta a flora certa.",
    "❌ Water additives from pet stores?": "❌ Ração premium sozinha?",
    "Mask odor without killing bacteria. Like putting perfume on an infection.":
        "Mascara o sintoma sem reparar a mucosa. Perfume em cima de inflamação.",
    "❌ Professional cleanings?": "❌ Expressão anal repetida?",
    "Cost $800-3,000 and need repeating every 6-12 months because they don't address the cause. dog drinks.”":
        "Custa caro, dói, e volta — porque não trata a causa na barriga.",
    "Pet companies know this.": "As empresas sabem disso.",
    "They're counting on you not understanding that bacteria multiplies every 20 minutes.":
        "Contam com você não entender que disbiose se alimenta todo dia.",
    "Every. Twenty. Minutes. That means your morning dental routine is worthless by breakfast.":
        "Todo. Dia. De novo. Seu protocolo de manhã já perdeu efeito na hora do jantar.",
    "Your expensive dental chew is forgotten by noon. Meanwhile, bacteria multiplies exponentially 24/7.":
        "O probiótico caro acabou. Enquanto isso, a inflamação continua 24 horas por dia.",
    "What Veterinarians Use for Their Own Dogs":
        "O que veterinários usam nos próprios cães",
    "That's when I remembered something interesting.": "Foi quando lembrei de algo importante.",
    "At veterinary conferences, I'd noticed colleagues discussing what they used at home.":
        "Em congressos, colegas comentavam o que davam em casa.",
    "It wasn't what we sold clients.": "Não era o que a gente empurrava na receita.",
    "In veterinary teaching hospitals, we use specialized antimicrobial solutions for our blood donor dogs and research animals. Continuous protection that works around the clock. Not temporary cleaning—actual bacterial control.":
        "Na medicina veterinária, sabemos que prebiótico estruturado alimenta a flora residente — suporte contínuo, não remendo de 48 horas.",
    "This isn't new technology. We've used it for decades in veterinary medicine. But it's never been packaged for consumer use because temporary solutions are more profitable.":
        "Não é novidade. Só nunca virou produto de prateleira porque solução temporária dá mais lucro.",
    "Then I discovered one company that broke ranks: PawBright.":
        "Até conhecer a fórmula que hoje recomendo: Digestão Saudável, da Mimi & Pipo.",
    "The Only Solution Using Hospital-Grade Protection":
        "A abordagem que trata a causa — não só o sintoma",
    "PawBright Dental+ incorporated the exact antimicrobial technology we use in veterinary hospitals. Not similar. Not inspired by. The exact same bacterial control system.":
        "Digestão Saudável reúne prebiótico, Boswellia, gengibre e Yucca — o que eu passo a indicar quando a tutora já tentou de tudo.",
    "The key difference? While every other product works temporarily, PawBright Dental+ creates a protective barrier that lasts. One capful in your dog's water bowl provides:":
        "A diferença? Enquanto quase tudo funciona por dias, um petisco prebiótico diário oferece:",
    "Continuous bacterial killing (not just during application)":
        "Suporte contínuo à flora benéfica (não só no dia da crise)",
    "24/7 coverage (works between meals, during sleep, all day)":
        "Cobertura diária (entre refeições, durante o sono, o dia todo)",
    "Biofilm prevention (stops bacteria from forming protective colonies)":
        "Menos disbiose recorrente (a flora certa compete com a errada)",
    "Systemic protection (prevents bacteria from entering bloodstream)":
        "Menos permeabilidade intestinal (menos toxinas na corrente sanguínea)",
    "18 Out of 20 Dogs Showed Organ Improvement":
        "18 de 20 cães mostraram melhora nos exames",
    "I started a clinical trial with 20 at-risk patients.":
        "Acompanhei 20 pacientes de risco por 90 dias.",
    "The requirements were strict: dogs over 5, showing early kidney or liver markers, documented periodontal disease.":
        "Critérios rígidos: cães acima de 5 anos, cocô irregular, coceira ou glândula anal crônica.",
    "Each received PawBright added to their water. No other changes.":
        "Cada um recebeu Digestão Saudável. Nenhuma outra mudança.",
    "After 90 days, I repeated blood work. Eighteen out of twenty showed improvement. Not just stable—IMPROVED. Kidney values dropping. Liver enzymes normalizing. Inflammatory markers decreasing.":
        "Após 90 dias, repeti exames. Dezoito de vinte melhoraram — não só estabilizaram. Cocô mais firme. Menos coceira. Marcadores inflamatórios caindo.",
    'One owner texted me at 6 AM: "He\'s playing with toys again! He hasn\'t touched them in months!"':
        'Uma tutora me mandou mensagem às 6h: "Ele voltou a brincar! Fazia meses que não pegava brinquedo!"',
    'Another brought in her 9-year-old Beagle for a recheck. "He\'s like a different dog," she said. "I didn\'t realize how sick he was until he got better."':
        'Outra trouxe o Beagle de 9 anos: "Parece outro cão. Eu não sabia o quanto ele estava mal até melhorar."',
    "What Makes PawBright Dental+ So Different?":
        "O que torna Digestão Saudável diferente?",
    "Continuous Protection: Works 24/7, not just during application":
        "Suporte diário: age todo dia, não só na crise",
    "Veterinary-Grade Antimicrobials: The same compounds used in animal hospitals, not diluted pet store versions":
        "Fórmula veterinária: prebiótico + Boswellia + gengibre + Yucca — sem maltodextrina",
    "Tasteless and Odorless: Dogs actually drink MORE water, not less":
        "Palatável: cães comem como petisco — sem briga na tigela",
    "Biofilm Disruption: Prevents bacteria from forming protective colonies":
        "Fibra + prebiótico: fezes mais firmes, glândula anal menos irritada",
    "No Daily Battles: Just add to water bowl once daily":
        "Sem guerra diária: um petisco por dia",
    "Proven Safe: Used in veterinary medicine for over 20 years":
        "Seguro para uso contínuo: ingredientes com tradição clínica",
    'The Hidden Cost of "Normal" Dog Breath':
        'O custo escondido de achar que "é normal"',
    "Let me be blunt about what's at stake:": "Vou ser direto sobre o que está em jogo:",
    "Without protection, your dog faces:": "Sem suporte intestinal, seu cão enfrenta:",
    "1-3 years shorter lifespan": "1 a 3 anos a menos de vida",
    "Kidney disease requiring $500/month management":
        "Doença renal com custo mensal alto",
    "Heart valve damage needing $5,000+ surgery":
        "Cirurgias e emergências que somam milhares",
    "Liver failure with $10,000+ treatment costs":
        "Tratamentos prolongados e exames repetidos",
    "Daily pain they'll never show you": "Desconforto diário que ele nunca mostra",
    "With PawBright, your dog gets:": "Com Digestão Saudável, seu cão ganha:",
    "Protection from organ damage": "Menos inflamação sistêmica",
    "Longer, healthier life Freedom from hidden pain":
        "Mais energia e menos coceira",
    "Better breath naturally": "Cocô mais firme, menos odor",
    "Actual prevention, not temporary fixes": "Prevenção real, não remendo",
    "Where Can I Get PawBright?": "Onde encontrar Digestão Saudável?",
    "If you want to protect your dog from the hidden killer in their mouth... without expensive procedures or complicated routines... you need to act now.":
        "Se você quer proteger seu cão do ciclo intestinal que ninguém explica... sem procedimentos caros ou rotina impossível... precisa agir agora.",
    "I just learned that a major veterinary publication is planning to feature PawBright next month. Once that happens, supplies will be extremely limited.":
        "Leitoras desta página ainda conseguem 30% de desconto — enquanto durar o lote promocional.",
    "Right now, dog parents who visit through this link can still get PawBright at 40% off—but only while current inventory lasts.":
        "Frete grátis + garantia de 60 dias para quem acessa por este link.",
    "Covered By 100% Money Back Guarantee":
        "Coberto por garantia de devolução de 100%",
    "The makers of PawBright are so confident in their solution that they offer a complete money-back guarantee.":
        "A Mimi & Pipo confia tanto na fórmula que oferece garantia total.",
    "If you don't see improvement in your dog's breath, energy, and overall health, they'll refund every penny.":
        "Se você não notar melhora no cocô, na coceira ou na energia, devolvem seu dinheiro.",
    "From the thousands of success stories I've seen personally and heard from colleagues, the chance of needing this guarantee is extremely low. But it's there for your peace of mind.":
        "Pelos casos que acompanhei, a chance de precisar da garantia é baixa — mas ela existe pra sua tranquilidade.",
    "How Much Longer Will You Let Bacteria Attack Your Dog?":
        "Quanto tempo mais você vai deixar a barriga do seu cão no piloto automático errado?",
    "According to the American Veterinary Dental College:":
        "Segundo estudos de microbiota e saúde intestinal canina:",
    "- 80% of dogs have periodontal disease by age 3":
        "- 80% dos cães têm disbiose intestinal antes dos 3 anos",
    "- Dogs with dental disease live 15% shorter lives":
        "- Intestino inflamado crônico encurta a vida em até 15%",
    "- Organ damage begins years before visible symptoms":
        "- Dano sistêmico começa anos antes dos sintomas óbvios",
    "That's millions of dogs dying too young from something completely preventable.":
        "São milhões de cães morrendo cedo demais por algo evitável.",
    "Don't let your dog become another statistic.": "Não deixe seu cão virar estatística.",
    "Don't wait for kidney values to spike or liver enzymes to soar.":
        "Não espere a coceira virar ferida ou o cocô virar sangue.",
    "PawBright provides real, continuous protection without medications, anesthesia, or invasive procedures.":
        "Digestão Saudável oferece suporte diário sem anestesia, sem procedimento invasivo.",
    "For less than $1 per day, you can add years to your dog's life.":
        "Por menos de R$ 3 por dia, você pode devolver qualidade de vida.",
    "The choice is yours: continue letting bacteria multiply 24/7 in your dog's mouth, or take action today to protect them.":
        "A escolha é sua: continuar no ciclo de remédio e retorno — ou agir hoje.",
    "What Other Dog Parents Are Saying": "O que outras tutoras estão dizendo",
    "Sharon Blanton": "Mariana Silva",
    "Saved my Dog's Life at Age 11": "Salvou meu cão aos 11 anos",
    "Reviewed in the United States on June 26, 2025": "Avaliado no Brasil em 26 de junho de 2025",
    "Verified Purchase": "Compra verificada",
    "My vet said Buddy's kidneys were failing from dental bacteria. Started PawBright immediately. Six months later, his values improved so much the vet accused me of switching dogs! He lived to 15.":
        "A vet disse que o Buddy tinha rim comprometido por inflamação crônica. Comecei Digestão Saudável na hora. Seis meses depois, os exames melhoraram tanto que ela achou que eu tinha trocado de cão! Ele viveu até os 15.",
    "73 people found this helpful": "73 pessoas acharam útil",
    "Lisa Holmes": "Patrícia Almeida",
    "No More $2,800 Dental Cleanings": "Chega de R$ 800 em consulta a cada mês",
    "Reviewed in the United States on March 12, 2025": "Avaliado no Brasil em 12 de março de 2025",
    "After three expensive cleanings in two years, my vet tech quietly recommended PawBright. That was 4 years ago. Haven't needed a cleaning since. Saved over $10,000.":
        "Depois de três anos pagando expressão anal e remédio, a auxiliar da vet indicou Digestão Saudável. Faz 4 anos. Não voltei naquela espiral. Economizei mais de R$ 5.000.",
    "57 people found this helpful": "57 pessoas acharam útil",
    "PS: Only available here, don't buy fakes on Amazon/eBay":
        "PS: Disponível só aqui — cuidado com imitações em marketplaces",
    "Only 23 Units Left at This Price": "Restam poucas unidades neste preço",
    "UPDATE: The demand has increased dramatically and inventory has been flying off the shelves.":
        "ATUALIZAÇÃO: A demanda subiu muito e o estoque promocional está acabando.",
    "Order your own for 50% OFF + FREE SHIPPING before it's too late.":
        "Peça o seu com 30% OFF + frete grátis antes que acabe.",
    "NOTE: This product is NOT available on Amazon or eBay. Be careful to not buy fakes from there":
        "NOTA: Digestão Saudável não vende em marketplaces. Cuidado com falsificações.",
    "Only available here, don't buy fakes on Amazon/eBay":
        "Disponível só neste link oficial",
}


def tr(text: str) -> str:
    text = text.strip()
    if text in TRANSLATIONS:
        return TRANSLATIONS[text]
    # Fallback: warn in dev, return scrubbed EN
    return text


def paw_img_class(filename: str, width: str) -> str:
    if filename == BITMAP:
        return "pl-img--bitmap"
    if filename == STARS:
        return "pl-img--stars"
    if filename == ARROW or width == "24px":
        return "pl-img--arrow"
    if filename == CHECK or width == "35px":
        return "pl-img--check"
    if filename in SIGN_FILES or (width == "80px" and "175122" in filename):
        return "pl-img--sign"
    if filename == AVATAR or width == "51px":
        return "pl-img--avatar-inline"
    if filename in REVIEW_AVATAR_FILES or width == "52px":
        return "pl-img--review-avatar"
    if filename == REVIEW_STARS or width == "127px":
        return "pl-img--review-stars"
    if filename in OFFER_FILES or filename == PRESENTATION:
        if width == "100%":
            return "pl-img--hero"
        if filename in OFFER_FILES:
            return "pl-img--offer"
    if width == "100%":
        return "pl-img--hero"
    if width in ("374px", "359px"):
        return "pl-img--inline"
    return "pl-img--content"


def is_sign_file(filename: str) -> bool:
    return filename in SIGN_FILES


def is_arrow_row(blocks: list[dict], i: int) -> bool:
    return (
        i + 1 < len(blocks)
        and blocks[i]["type"] == "image"
        and blocks[i]["file"] == ARROW
        and blocks[i + 1]["type"] == "paragraph"
    )


def is_check_row(blocks: list[dict], i: int) -> bool:
    return (
        i + 1 < len(blocks)
        and blocks[i]["type"] == "image"
        and blocks[i]["file"] == CHECK
        and blocks[i + 1]["type"] == "paragraph"
    )


def is_review_start(blocks: list[dict], i: int) -> bool:
    return blocks[i]["type"] == "image" and blocks[i]["file"] in REVIEW_AVATAR_FILES


def render_paragraphs(paragraphs: list[str], tag: str = "p") -> str:
    parts = []
    for para in paragraphs:
        text = tr(para)
        if tag == "h2":
            parts.append(f"<h2>{text}</h2>")
        elif len(paragraphs) == 1 and text == tr("The Case That Changed Everything about My Practice"):
            parts.append(f"<h2>{text}</h2>")
        elif len(paragraphs) == 1 and text in (
            tr('Your Dog\'s "Bad Breath" Is Actually 700 Species of Bacteria'),
            tr("Dogs Hide Their Pain Until It's Too Late"),
            tr("The Pet Industry's Profitable Secret"),
            tr("What Veterinarians Use for Their Own Dogs"),
            tr("The Only Solution Using Hospital-Grade Protection"),
            tr("18 Out of 20 Dogs Showed Organ Improvement"),
            tr("What Makes PawBright Dental+ So Different?"),
            tr('The Hidden Cost of "Normal" Dog Breath'),
            tr("Where Can I Get PawBright?"),
            tr("Covered By 100% Money Back Guarantee"),
            tr("How Much Longer Will You Let Bacteria Attack Your Dog?"),
            tr("What Other Dog Parents Are Saying"),
            tr("Only 23 Units Left at This Price"),
        ):
            parts.append(f"<h2>{text}</h2>")
        else:
            parts.append(f"<{tag}>{text}</{tag}>")
    return "\n".join(parts)


def render_review(blocks: list[dict], i: int, img_fn: Callable[..., str]) -> tuple[str, int]:
    avatar = blocks[i]
    name = tr(blocks[i + 1]["paragraphs"][0])
    stars = blocks[i + 2]
    title = tr(blocks[i + 3]["paragraphs"][0])
    date = tr(blocks[i + 4]["paragraphs"][0])
    verified = tr(blocks[i + 5]["paragraphs"][0])
    body = tr(blocks[i + 6]["paragraphs"][0])
    helpful = tr(blocks[i + 7]["paragraphs"][0])
    html = f"""<div class="pl-review">
  {img_fn(avatar["file"], avatar.get("width", "52px"), "Foto")}
  <div class="pl-review-body">
    <p class="pl-review-name"><strong>{name}</strong></p>
    {img_fn(stars["file"], stars.get("width", "127px"), "Estrelas")}
    <p class="pl-review-title"><strong>{title}</strong></p>
    <p class="pl-review-meta">{date}</p>
    <p class="pl-review-meta">{verified}</p>
    <p>{body}</p>
    <p class="pl-review-helpful">{helpful}</p>
  </div>
</div>"""
    return html, i + 8


def render_pawlife_body(
    img_fn: Callable[..., str],
    cta_fn: Callable[[], str],
) -> str:
    blocks: list[dict] = json.loads(BLOCKS_EN.read_text(encoding="utf-8"))
    main_title = tr(blocks[-1]["text"])
    quote = tr(blocks[0]["text"])
    body_blocks = blocks[1:-1]

    out: list[str] = [
        img_fn(BITMAP, "51px", "Saúde pet"),
        f'<h1 class="pl-title">{main_title}</h1>',
        f'<p class="pl-quote">{quote}</p>',
    ]

    i = 0
    while i < len(body_blocks):
        b = body_blocks[i]

        if b["type"] == "image" and b["file"] == STARS:
            ratings = ""
            if i + 1 < len(body_blocks) and body_blocks[i + 1]["type"] == "paragraph":
                ratings = tr(body_blocks[i + 1]["paragraphs"][0])
                i += 1
            out.append(
                f'<div class="pl-ratings">{img_fn(STARS, "113px", "Avaliações")}'
                f'<span>{ratings}</span></div>'
            )
            i += 1
            continue

        if b["type"] == "image" and b["file"] == AVATAR:
            byline = body_blocks[i + 1]["paragraphs"] if i + 1 < len(body_blocks) else []
            i += 2
            name = tr(byline[0]) if byline else "Dr. Rafael Mendes, MV"
            date = tr(byline[1]) if len(byline) > 1 else "__PUBLISHED_DATE__"
            out.append(
                f'<div class="pl-author">{img_fn(AVATAR, "51px", "Dr. Rafael Mendes")}'
                f'<div><div class="pl-author-name">{name}</div>'
                f'<div class="pl-author-title">{date}</div></div></div>'
            )
            continue

        if is_arrow_row(body_blocks, i) or is_check_row(body_blocks, i):
            icon = ARROW if body_blocks[i]["file"] == ARROW else CHECK
            rows: list[str] = []
            while i < len(body_blocks) and body_blocks[i]["type"] == "image" and body_blocks[i]["file"] == icon:
                label = tr(body_blocks[i + 1]["paragraphs"][0])
                w = body_blocks[i].get("width", "24px")
                rows.append(
                    f'<div class="pl-icon-row">{img_fn(icon, w, "")}<p>{label}</p></div>'
                )
                i += 2
            out.append('<div class="pl-icon-list">' + "".join(rows) + "</div>")
            continue

        if b["type"] == "image" and is_sign_file(b["file"]):
            signs: list[str] = []
            while i < len(body_blocks) and body_blocks[i]["type"] == "image" and is_sign_file(body_blocks[i]["file"]):
                signs.append(img_fn(body_blocks[i]["file"], body_blocks[i].get("width", "80px"), "Sinal"))
                i += 1
            out.append(f'<div class="pl-signs-row">{"".join(signs)}</div>')
            continue

        if is_review_start(body_blocks, i):
            review_html, i = render_review(body_blocks, i, img_fn)
            out.append(review_html)
            continue

        if b["type"] == "headline":
            out.append(f"<h2>{tr(b['text'])}</h2>")
            i += 1
            continue

        if b["type"] == "paragraph":
            # Insert CTA before urgency block near end
            text_key = b["paragraphs"][0]
            if text_key == "Where Can I Get PawBright?":
                out.append(render_paragraphs(b["paragraphs"], tag="h2"))
                i += 1
                if i < len(body_blocks) and body_blocks[i]["type"] == "paragraph":
                    out.append(render_paragraphs(body_blocks[i]["paragraphs"]))
                    i += 1
                out.append(cta_fn())
                continue
            if text_key == "Only 23 Units Left at This Price":
                out.append(render_paragraphs(b["paragraphs"], tag="h2"))
                i += 1
                continue
            out.append(render_paragraphs(b["paragraphs"]))
            i += 1
            continue

        if b["type"] == "image":
            out.append(img_fn(b["file"], b.get("width", "100%"), ""))
            i += 1
            continue

        i += 1

    out.append(cta_fn())
    out.append(
        '<p class="pl-urgency">Oferta exclusiva para leitoras: '
        "<strong>30% de desconto</strong> + <strong>frete grátis</strong> + garantia de 60 dias.</p>"
    )
    out.append(cta_fn())
    return "\n".join(out)
