# Definir cada termo antes do primeiro uso e dar um dono a cada assunto

## Purpose and success

A documentação para quem opera foi reorganizada no commit `fc06986` (plano `.agent/execplans/operator-documentation.md`). Uma revisão do usuário, em 11 de novembro de 2026, encontrou dois problemas de arquitetura:

1. **Termos usados antes de serem explicados.** A linha 3 do `README.md` já fala de "PR" e "Énóis" sem dizer o que são, e nenhum documento explica isso depois. Codespace, Worker, lançador, H2, GHCR, devcontainer e sanitização aparecem no README dezenas de linhas antes (ou sem) uma definição. O próprio `docs/pt-BR/CONCEPTS.md` usa "Codespace" e "revisão" na seção "Em uma frase", antes do glossário.
2. **Assuntos com dois donos:**
   - O diagrama "Onde roda o quê" está idêntico no README e no FLOW. No README, ele aparece sem legenda e sem link para as 6 explicações, que só existem no FLOW. O único link ao lado ("O passo a passo de cada lado está em [Fluxo]") vem antes do diagrama e é genérico.
   - Os limites do visitante (20 MiB, 256 MiB, 10 min, contas compartilhadas) estão no README ("Limites e custos") e em RECIPES, receita 9.
   - Código vs dados está no README e em CONCEPTS.
   - O resumo de uma frase está no README e em CONCEPTS.

Esta passada segue a skill `restructure-documentation` (`~/.claude/skills/restructure-documentation/SKILL.md` e `references/documentation-roles.md`). Ela é limitada a três frentes: ordem dos conceitos, um dono por assunto e paridade pt-BR/en. **Não é outra reescrita.**

**Sucesso (observável):**
- Em cada documento de `README.md`, `docs/en/README.md`, `docs/{pt-BR,en}/{CONCEPTS,FLOW,RECIPES,TUTORIAL,LLM}.md`, a primeira menção a PR é "pull request (PR)", seguida da explicação "o pedido de revisão de código no GitHub" (en: "a code review request on GitHub") pelo menos no README e no CONCEPTS.
- A primeira menção ao Énóis no README (pt e en) e no CONCEPTS traz a definição decidida pelo usuário (texto exato em `Decisions`). Nos outros guias, a primeira menção linka para a entrada do glossário.
- Em `CONCEPTS.md` (pt e en), cada termo do glossário aparece pela primeira vez, inclusive no plural, na flexão e no texto de link, no próprio título `###` da sua definição ou depois dele.
- No README, todo termo da tabela de `Definitions` usado antes do mapa da documentação ou é explicado na mesma frase em no máximo uma oração, ou linka para a âncora dele em CONCEPTS.
- Cada assunto da tabela de `Decisions` tem um único dono. Os outros lugares ficam com uma frase de contexto e um link.
- Nenhum fato se perde. Nenhuma âncora que recebe link quebra. Comandos, mensagens e valores continuam idênticos.

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Context and limits

- **Repositório:** `~/projects/enois-preview`. O trabalho **continua na branch `docs/operator-documentation`**:
  - ela já está em `origin` com o commit `fc06986`, não tem PR e é o mesmo trabalho de documentação;
  - não crie outra branch a partir da `main`;
  - este plano é a única mudança pendente e vai no commit.
- O GitHub é **público**. Não escreva caminhos absolutos com nome de usuário, emails reais, segredos nem URLs privadas novas.
- **Pode editar (documentação):**
  - `README.md`, `CHANGELOG.md`, `TUTORIAL.md` (raiz);
  - `docs/pt-BR/*.md`, `docs/en/*.md`;
  - links em `docs/diagnostics/*.md`;
  - `release/public-files.json` (só se surgir arquivo novo, o que não está previsto).
- **Protegidos:**
  - todo código (`preview/`, `src/`, `runtime/`, `recipe/`, `scripts/`, `shared/`, `example/`, `test/`) e `package.json`;
  - `VALIDATION.md` e `docs/validation/**`;
  - `.agent/execplans/operator-documentation.md`.
- **Âncoras que recebem links e devem continuar existindo** (levantadas com `grep -rnoE "(CONCEPTS|FLOW|RECIPES|README)\.md#[^)]+"`):
  - `CONCEPTS.md#lançador` / `#launcher`
  - `#toolcommit-e-installjson` / `#toolcommit-and-installjson`
  - `#dados-congelados-e-captura` / `#frozen-data-and-capture`
  - `FLOW.md#o-que-acontece-no-publish` / `#what-happens-during-publish`
  - as dez receitas numeradas de `RECIPES.md`
  - `README.md#requisitos` / `docs/en/README.md#requirements`
  - Mudar a posição de um título não muda a âncora. Mudar o texto muda: não renomeie esses títulos.
- **Restrições do exportador público** (`scripts/export-public.ts`):
  - todo `.md` público precisa estar em `release/public-files.json`;
  - `VALIDATION.md` precisa manter o título `## TypeScript migration evidence`.
- **Preferência de escrita do usuário:** sem hífens desnecessários.
- **Fonte da definição do Énóis:** o site oficial, lido em 11 de novembro de 2026.
  - <https://enois.ia.br/>: "Énóis, rede social gratuita, sem anúncios e com feed que termina" e "Somos uma rede social sem fins lucrativos, construída junto com a comunidade."
  - <https://enois.ia.br/sobre>: "Uma rede social gratuita feita por gente, sem anúncios, sem paywall, em construção com quem usa."

## Definitions

Termos que esta passada ordena. Os que estão marcados como **novo** ganham entrada no glossário de CONCEPTS. Cada entrada nova segue o formato das existentes: definição, depois **Por que importa para você** (en: **Why it matters to you**).

| Termo (pt / en) | Fonte da definição | Situação |
|---|---|---|
| Énóis | site enois.ia.br (acima) e `example/sources.json` | **novo**, junto com "As três aplicações" |
| PR / pull request | conceito do GitHub: pedido de revisão de código | **novo** |
| Operador e visitante | README atual ("quem abre o PR (o operador)"), `src/worker.ts` | **novo** |
| CLI | `package.json` `bin.enois-preview` → `dist/preview/cli.js` | **novo** |
| Codespace, Worker, Durable Object | entrada atual "Worker, Durable Object e Codespace"; `src/scenario.ts`, `src/worker.ts` | já existe; mover para o início do glossário |
| GHCR | `preview/remote.ts` (etapa `registry`), `config.registry` em `preview/config.ts` | **novo** |
| H2 | `config.database` e `config.h2Jar` em `preview/config.ts`; `preview/capture.ts` | **novo**, ou incorporado a "Dados congelados e captura" com o título intacto |
| Sanitizar | `recipe/SeedTool.java` (`sanitize`), `preview/capture.ts` | incorporar a "Dados congelados e captura" |
| devcontainer | `preview/remote.ts` (etapa `configuration`) | incorporar a "Lançador" |
| Lançador, Cenário, Revisão, Journal, Lease, `restoration.json`, `toolCommit` e `install.json` | entradas atuais | já existem |

## Decisions

- **Texto do Énóis** (decidido pelo usuário em 11 de novembro de 2026, opção "curta + link"; grafia **"Énóis"**, como o repositório já usa, e não "énóis" como no site):
  - pt: "o Énóis ([enois.ia.br](https://enois.ia.br)), uma rede social gratuita, sem anúncios e sem fins lucrativos, construída junto com a comunidade"
  - en: "Énóis ([enois.ia.br](https://enois.ia.br)), a free, nonprofit social network without ads, built together with its community"
- **PR por extenso na primeira menção de cada documento, não só no README.** Razão: quem chega por um link de receita nunca leu o README.
- **Dono de cada assunto** (critérios de `references/documentation-roles.md`: autoridade, adequação ao público, completude, estabilidade):

  | Assunto | Dono | O que fica nos outros lugares |
  |---|---|---|
  | Diagrama "Onde roda o quê" e as 6 explicações | `FLOW.md#onde-roda-o-quê` (en `FLOW.md#where-things-run`) | README: a seção `## Onde roda o quê` (en `## Where things run`) mantém o título e a âncora, **sem o bloco Mermaid**. Ela fica com 3 a 5 frases em texto comum (sua máquina → GitHub e Cloudflare → Codespace → visitante) e termina numa linha própria, em negrito: "**[Veja o diagrama e o que cada parte faz em Fluxo](docs/pt-BR/FLOW.md#onde-roda-o-quê)**" (en: "**[See the diagram and what each part does in Flow](FLOW.md#where-things-run)**"). |
  | Limites do visitante (contas compartilhadas, 20/256 MiB, semente, boot, 10 min, polling, disponibilidade das plataformas) | `RECIPES.md` receita 9 | README "Limites e custos": uma frase e um link. Mova antes para a receita 9 qualquer fato do README que ela ainda não tenha (por exemplo, "Disponibilidade e franquias das plataformas limitam essa proteção"). |
  | Código vs dados (quando há captura) | `CONCEPTS.md#código-vs-dados` | README: uma frase e um link. |
  | Custos, planos gratuitos, termos do Codespaces, licença | README | sem mudança |
  | Resumo de uma frase | README (introdução) | CONCEPTS: a seção "Em uma frase" vai para **depois** do glossário, com o mesmo título. Ela passa a usar só termos já definidos. |
  | Comandos de desenvolvimento (`npm run typecheck`, `npm test`…) | README, em seção própria "Desenvolver a ferramenta" (en "Developing the tool") antes de "Licença" | sai de "Requisitos", que fica só com o que o operador precisa |

  - **O diagrama sai do README nesta passada** (decidido pelo usuário em 11 de novembro de 2026, para avaliar o resultado):
    - O FLOW é o dono, porque tem o diagrama e as 6 explicações.
    - Alternativas consideradas:
      - cópia idêntica no README, protegida por comparação byte a byte;
      - as 6 explicações também no README, o que gera uma segunda cópia de texto, impossível de verificar automaticamente.
    - Consequência: o caminho até o FLOW precisa ser óbvio. Há três pontos de entrada no README: a linha em negrito na seção "Onde roda o quê", os links diretos na introdução (M2) e o mapa da documentação.
    - Recuperação: se o usuário quiser o diagrama de volta depois de ver o resultado, copie o primeiro bloco Mermaid do FLOW para a seção, com um comentário de cópia, e acrescente a checagem byte a byte.
  - **Links diretos para seções em vez de "Fluxo" genérico.** A frase da introdução do README ("O passo a passo de cada lado está em [Fluxo]…") passa a linkar `FLOW.md#o-que-acontece-no-publish` e `FLOW.md#o-que-acontece-quando-alguém-abre-o-link`. Em en: `#what-happens-during-publish` e `#what-happens-when-someone-opens-the-link`.
- **Paridade:** cada mudança em pt-BR é espelhada em en no mesmo marco, com os mesmos títulos traduzidos e a mesma contagem de seções.

## Milestones

### M1. Glossário de CONCEPTS em ordem

- **Edições em `docs/pt-BR/CONCEPTS.md` e `docs/en/CONCEPTS.md`:**
  - Introdução (linha "Leia este guia…"): reescrever sem termos ainda não definidos, por exemplo "as palavras que aparecem nas mensagens da ferramenta".
  - Mover "Em uma frase" para depois do glossário, com o mesmo título.
  - Nova ordem do glossário, do mais básico para o mais específico:
    1. Énóis e as três aplicações (título atual "As três aplicações" mantido; o Énóis entra como primeira entrada ou dentro dela, com o texto de `Decisions`)
    2. PR (pull request)
    3. Operador e visitante
    4. CLI
    5. Codespace, Worker e Durable Object (pode virar entradas separadas; essa âncora não recebe links)
    6. GHCR
    7. Lançador (inclui devcontainer)
    8. Cenário
    9. Revisão
    10. Dados congelados e captura (inclui H2 e sanitização)
    11. Journal
    12. Lease
    13. `restoration.json`
    14. `toolCommit` e `install.json`
  - Cada definição só pode usar termos definidos acima dela ou explicados na mesma frase. Ajuste os textos de "Por que importa para você" que usem termos posteriores.
- **Validação:** a checagem de primeira ocorrência (Validation 6) e o verificador de links da skill.
- **Aceite:** em CONCEPTS, para cada termo de `Definitions`, a linha da primeira ocorrência (sem diferenciar maiúsculas e incluindo plural) é maior ou igual à linha do título que define o termo.

### M2. README como porta de entrada

- **Edições em `README.md` e `docs/en/README.md`:**
  - Linha 3 e "O problema":
    - Énóis com o texto de `Decisions`;
    - "pull request (PR), o pedido de revisão de código no GitHub";
    - Codespace explicado em uma oração (por exemplo, "uma máquina de desenvolvimento na nuvem do GitHub");
    - "sanitizada" explicada ou linkada.
  - "Em resumo": reescrever os dois bullets em linguagem comum. Cada termo técnico (lançador, revisão, Worker, imagem) é explicado na mesma frase ou linka para a âncora em CONCEPTS.
  - Introdução: trocar o link genérico "[Fluxo]" pelos dois links diretos de `Decisions`.
  - "Onde roda o quê": manter o título. Trocar o bloco Mermaid pelo resumo em texto e pela linha em negrito com link para `FLOW.md#onde-roda-o-quê`, como em `Decisions`. O resumo usa só termos já explicados no README ou linkados para CONCEPTS.
  - "Requisitos": GHCR e H2 na primeira menção, com explicação curta ou link. Mover o parágrafo de desenvolvimento para "Desenvolver a ferramenta".
  - "Limites e custos": aplicar a tabela de donos de `Decisions`. Antes de cortar, confirme que cada fato removido já está no dono.
- **Validação:** checagem de links, Validation 6 aplicada ao README e o checklist de preservação (Validation 9).
- **Aceite:**
  - Lendo o README de cima até "Mapa da documentação", nenhum termo de `Definitions` aparece sem explicação ou link na sua primeira menção.
  - O README não tem bloco Mermaid. A seção "Onde roda o quê" termina com o link em negrito para `FLOW.md#onde-roda-o-quê` (Validation 10).
  - A introdução linka diretamente as duas seções de sequência do FLOW.

### M3. Primeira menção nos outros guias e donos únicos

- **Edições em `docs/{pt-BR,en}/{FLOW,RECIPES,TUTORIAL,LLM}.md`:**
  - Na primeira menção de cada documento: "pull request (PR)"; "Énóis" com link para a entrada em CONCEPTS.
  - FLOW: confirmar que a introdução linka para CONCEPTS antes do primeiro termo técnico. A seção "Onde roda o quê" fica sendo a dona do diagrama (sem mudança de conteúdo).
  - RECIPES, receita 9: receber os fatos de limite que só estavam no README.
  - TUTORIAL: na primeira menção de GHCR, Codespace e lançador, linkar para CONCEPTS quando ainda não houver link.
- **Validação:**
  - `grep -n -m1 -wiE "PR|pull request" <arquivo>` em cada guia: a primeira linha encontrada contém "pull request (PR)";
  - checagem de links.
- **Aceite:** a primeira menção a PR de cada guia mostra a forma por extenso, e a receita 9 contém todos os fatos de limite listados em Validation 9.

### M4. Validação final e auditoria

- Rodar tudo da seção `Validation` e registrar em `Progress` o resultado observado de cada item.
- Revisar `git diff fc06986 --stat` e o diff completo. Procurar:
  - mudança de texto sem ganho de ordem ou de dono;
  - fato movido sem dono;
  - âncora quebrada;
  - edição fora do escopo.
- Percorrer as três jornadas e registrar em `Progress` se cada uma chega ao resultado sem pré-requisito faltando nem volta circular:
  1. Recém-chegado: README → TUTORIAL → link publicado.
  2. Operador no dia a dia: RECIPES (entrando direto pela receita 5) → resume.
  3. Leitor curioso: README → CONCEPTS → FLOW.

## Progress

- [x] M1 glossário de CONCEPTS em ordem (pt e en)
  - Introdução sem termos do glossário; "Em uma frase" movida para depois do glossário (pt linha 93, en linha 93), com o mesmo título.
  - Nova ordem dos títulos `###` (linhas 9 a 87 nos dois idiomas): As três aplicações (com Énóis e H2), PR (pull request), Operador e visitante, CLI, Worker/Durable Object/Codespace, GHCR, Lançador (com devcontainer), Cenário, Revisão, Dados congelados e captura (com sanitização), Journal, Lease, `restoration.json`, `toolCommit` e `install.json`.
  - Fatos de "código vs dados" que só estavam no README entraram em `CONCEPTS.md#código-vs-dados` (backend identificado; design system reconstruído).
  - O caminho `catalog/scenarios.json` saiu da entrada Lançador (casava com a regex de cenário antes da definição); ele continua em "Onde ficam os arquivos", que a entrada agora linka.
  - Durable Object descrito como "um por link publicado": `src/worker.ts:32` usa `idFromName(slug)`, e o slug é `<cenario>-<16 caracteres da revisão>`.
- [x] M2 README como porta de entrada (pt e en)
  - Linha 3 com PR por extenso, explicação do GitHub e texto do Énóis de `Decisions`; Codespace explicado em uma oração; "sanitizada" com link e explicação.
  - "Em resumo" com links para revisão, lançador e Worker; introdução com links diretos às duas seções de sequência do FLOW.
  - "Onde roda o quê" sem Mermaid, com resumo em texto e a linha em negrito para o FLOW.
  - `toolCommit` e journals linkados na primeira menção em "Instalação".
  - "Requisitos" sem o parágrafo de desenvolvimento, que foi para a nova seção "Desenvolver a ferramenta" / "Developing the tool", antes de "Licença".
  - "Limites e custos": código vs dados e limites do visitante viraram uma frase com link para o dono.
- [x] M3 primeira menção nos outros guias e donos únicos (pt e en)
  - Primeira menção a PR por extenso em RECIPES (linha 67), TUTORIAL (linha 123) e LLM (linha 13). FLOW não menciona PR nem Énóis; RECIPES, TUTORIAL e LLM não mencionam Énóis, então não houve link a acrescentar.
  - TUTORIAL: GHCR (linha 9) e Codespace (linha 13) linkados para CONCEPTS; lançador já tinha link.
  - Receita 9 recebeu "contas, dados e capacidade compartilhados", "polling não renova o prazo" e "disponibilidade e franquias das plataformas". O polling foi conferido em `src/scenario.ts`: só a ação de atividade (linha 209) renova `lastActivity`; `status` (linha 201) não renova.
- [x] M4 validação final, auditoria do diff e das três jornadas
  - V1 a V4: `npm run build`, `typecheck`, `test` (0 falhas) e `check` com exit 0.
  - V5: verificador da skill exit 0; verificador `node -e` exit 0.
  - V6 (pt e en): codespace/worker/durable object 33≥33; ghcr 39≥39; H2 11≥9; lançador/launcher 45≥45; cenário/scenario 51≥51; PR 15≥15; énóis 11≥9; CLI 27≥27; journal 69≥69; lease 75≥75; sanitiz 65≥63; devcontainer 47≥45; revision (en) 57≥57. **Exceção em pt:** `revis(ão|ões)` casa primeiro na linha 17 ("o pedido de revisão de código no GitHub", texto obrigatório de `Decisions`). É outro sentido da palavra, não o termo Revisão; a entrada Revisão ganhou "Não confunda com a revisão de código feita no PR". O termo do glossário aparece pela primeira vez na linha 57.
  - V7: CONCEPTS 19/19, FLOW 3/3, RECIPES 10/10, TUTORIAL 5/5, LLM 3/3, README 10/10.
  - V8: âncoras protegidas preservadas; nenhum título protegido foi renomeado e os dois verificadores passam.
  - V9, dono de cada fato: contas e estado compartilhados, 20/256 MiB, mídias da semente, boot com semente e senhas novas, 10 min, polling, disponibilidade e franquias, link imutável sem ambiente garantido → `RECIPES.md` receita 9; primeira captura só do backend identificado, design system reconstruído → `CONCEPTS.md#código-vs-dados`; publicações seguintes sem ler o banco, falha de `--refresh-data` preserva a anterior → `CONCEPTS.md#dados-congelados-e-captura`; a ferramenta não comita nas três aplicações → `CONCEPTS.md#as-três-aplicações` (e o primeiro item de "Limites e custos", mantido).
  - V10: Mermaid 0, 0, 3, 3; cada um dos seis links diretos para o FLOW aparece 1 vez.
  - V11: export exit 0; primeira linha `# TypeScript migration validation`.
  - V12: grep de privacidade sem saída.
  - Diff contra `fc06986`: só README, CONCEPTS, RECIPES, TUTORIAL e LLM (pt e en); nenhum arquivo protegido.
  - Jornada 1 (README → TUTORIAL → link): "Instalação" linka o tutorial; o tutorial linka `README.md#requisitos`, lançador e GHCR; o passo 17 entrega o link. Sem pré-requisito faltando.
  - Jornada 2 (RECIPES, receita 5 → resume): a receita traz o formato da mensagem e o comando; a barra do topo linka Conceitos. "revisão" não tem link dentro da receita (lacuna pequena, fora do escopo deste plano).
  - Jornada 3 (README → CONCEPTS → FLOW): o mapa e os links do README levam ao glossário; CONCEPTS linka o FLOW na barra; FLOW volta a CONCEPTS na introdução. Sem volta circular.
  - Lacuna aberta: a renderização Mermaid do FLOW só é conferida no PR.
  - Observação fora do escopo: `FLOW.md` item 4 de "Onde roda o quê" diz "cada cenário tem um Durable Object"; o código usa um por slug (link publicado). Não foi alterado nesta passada.

## Risks

- **Perder um fato ao trocar cópia por link.** Controle: antes de remover um parágrafo, localize cada fato dele no dono e registre isso em `Progress` (Validation 9).
- **Quebrar âncoras** ao renomear títulos. Controle: não renomeie os títulos listados em `Context and limits`. Rode os dois verificadores de links.
- **Explicação simplificada errada** (por exemplo, dizer que o Worker "hospeda o app"). Controle: cada explicação curta precisa bater com a fonte da tabela de `Definitions`. Na dúvida, linke para CONCEPTS em vez de explicar.
- **Reescrita além do escopo.** Controle: a skill manda fazer o menor conjunto de mudanças com ganho estrutural. Texto que já está em ordem e com dono não é tocado.
- **Divergência entre idiomas.** Controle: Validation 7.

## Validation

Rode na raiz do repositório. Os resultados esperados vêm entre parênteses.

1. `npm run build` (exit 0)
2. `npm run typecheck` (exit 0)
3. `npm test` (exit 0, 0 falhas)
4. `npm run check` (exit 0)
5. Links locais, com dois verificadores (os dois com exit 0 e sem saída de erro):
   - `python3 -I ~/.claude/skills/restructure-documentation/scripts/check_markdown_links.py README.md CHANGELOG.md TUTORIAL.md docs/pt-BR docs/en docs/diagnostics`
   - o comando `node -e` da seção Validation 5 de `.agent/execplans/operator-documentation.md`
6. **Primeira ocorrência.** Para cada termo de `Definitions`, em CONCEPTS pt e en, registre em `Progress` a linha da primeira ocorrência e a linha do título:
   - comando: `grep -n -m1 -iE "<regex do termo>" docs/pt-BR/CONCEPTS.md` e `grep -n "^###" docs/pt-BR/CONCEPTS.md`;
   - regex sugeridas: `codespace`, `worker`, `durable object`, `ghcr`, `\bH2\b`, `lançador|launcher`, `revis(ão|ões)|revision`, `cenário|scenario`, `\bPR\b|pull request`, `énóis`, `\bCLI\b`, `journal`, `\blease`, `sanitiz`, `devcontainer`;
   - esperado: a linha da ocorrência é maior ou igual à linha do título que define o termo. A barra de navegação do topo (linha com `·`) não conta.
7. **Paridade:**
   - `for f in CONCEPTS FLOW RECIPES TUTORIAL LLM; do echo $f $(grep -c '^##' docs/pt-BR/$f.md) $(grep -c '^##' docs/en/$f.md); done` mostra pares iguais;
   - `echo README $(grep -c '^##' README.md) $(grep -c '^##' docs/en/README.md)` mostra um par igual.
8. **Âncoras protegidas.** Cada uma da lista em `Context and limits` continua existindo; os dois verificadores do item 5 cobrem isso.
9. **Checklist de preservação.** Para cada fato abaixo, registre o arquivo e a seção do **dono** final:
   - contas e estado compartilhados;
   - 20 MiB por arquivo e 256 MiB por ambiente;
   - mídias da semente fora da conta;
   - boot restaura a semente e troca senhas;
   - 10 min sem interação;
   - polling não renova o prazo;
   - disponibilidade e franquias das plataformas;
   - link imutável não garante ambiente ativo;
   - primeira captura para só o backend identificado;
   - publicações seguintes não leem o banco;
   - falha de `--refresh-data` preserva a versão anterior;
   - design system reconstruído;
   - a ferramenta não comita nas três aplicações.
10. **Mermaid e caminho até o FLOW:**
    - `grep -c '```mermaid' README.md docs/en/README.md docs/pt-BR/FLOW.md docs/en/FLOW.md` retorna 0, 0, 3, 3.
    - Cada comando abaixo retorna pelo menos 1:
      - `grep -c 'FLOW.md#onde-roda-o-quê' README.md`
      - `grep -c 'FLOW.md#o-que-acontece-no-publish' README.md`
      - `grep -c 'FLOW.md#o-que-acontece-quando-alguém-abre-o-link' README.md`
    - Equivalentes em en, em `docs/en/README.md`, cada um também com pelo menos 1: `grep -c` para `FLOW.md#where-things-run`, `FLOW.md#what-happens-during-publish` e `FLOW.md#what-happens-when-someone-opens-the-link`.
11. **Exportação pública** (exit 0; a primeira linha do VALIDATION exportado é `# TypeScript migration validation`):
    ```sh
    out=$(mktemp -d)/public && node dist/scripts/export-public.js "$out" && head -1 "$out/VALIDATION.md"
    ```
12. **Privacidade** (sem saída): `grep -rnE "/home/|@[a-z0-9.-]+\.(com|br)" README.md CHANGELOG.md docs/pt-BR docs/en`

**Obrigações do executor antes de entregar:**
- Confira cada explicação curta contra a fonte em `Definitions`, separadamente de conferir se os comandos passam.
- Registre em `Progress` a evidência de cada critério (comando, resultado observado e arquivo ou linha) e as três jornadas do M4.
- Registre qualquer lacuna como lacuna, por exemplo a renderização Mermaid, que só é conferida no PR. Não declare cumprido um critério com lacuna aberta.
