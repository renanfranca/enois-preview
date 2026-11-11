# Documentação para quem vai operar o enois-preview

## Purpose and success

Hoje a documentação foi escrita como registro de aceite e changelog. Uma pessoa que programa, mas não conhece TypeScript, Cloudflare Workers nem GitHub Codespaces, não consegue responder com ela:

1. Que problema o enois-preview resolve e para quem?
2. O que acontece, em ordem, quando eu rodo `enois-preview publish`? E quando alguém abre o link?
3. Qual comando uso para cada situação do dia a dia?

Este plano reescreve os guias para **quem vai operar** a ferramenta (publicar previews dos próprios PRs), em **pt-BR e inglês com paridade**. Os diagramas ficam em **Mermaid** e as notas por versão vão para um **CHANGELOG**. Essas quatro escolhas foram feitas pelo usuário em 11 de novembro de 2026.

**Sucesso (observável):**
- O README, em cada idioma, abre explicando o problema e o propósito em linguagem comum. Depois vêm um diagrama "onde roda o quê", requisitos, instalação, uma tabela de comandos e um mapa da documentação. VALIDATION.md não aparece mais na primeira frase.
- Existem, em `docs/pt-BR/` e `docs/en/`, três guias novos com os mesmos nomes de arquivo:
  - `CONCEPTS.md`: glossário e modelo mental;
  - `FLOW.md`: diagramas do `publish` e da visita;
  - `RECIPES.md`: receitas no formato fixo.
- Nenhum guia (README, TUTORIAL, LLM) contém frases do tipo "Na versão 0.3.x" ou "In 0.3.x". Esse conteúdo está em `CHANGELOG.md` (pt-BR, raiz) e `docs/en/CHANGELOG.md`.
- Todos os links relativos dos `.md` resolvem.
- `node dist/scripts/export-public.js` leva os arquivos novos ao pacote público.
- `npm test` passa.
- Toda afirmação factual dos docs vem do código atual ou dos docs atuais, com a fonte listada em `Context and limits`.

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, partindo de `main` limpa em `c52d80e`, versão 0.3.7 (`package.json`). Este plano é a única mudança pendente e vai no commit.
- O GitHub é **público**. Não escreva nos docs nem no plano:
  - caminhos absolutos com nome de usuário (use `~`);
  - emails, segredos ou URLs privadas novas.
- **Fora do escopo:**
  - conteúdo de `VALIDATION.md` e de `docs/validation/**`;
  - código TypeScript ou Java;
  - documentação para contribuidores (mapa de módulos, como escrever testes);
  - tradução de `docs/diagnostics/README.md`.
  - Em `docs/diagnostics/*`, só links e termos alinhados ao glossário.
- **Restrições técnicas encontradas no planejamento:**
  - `release/public-files.json` é a allowlist da exportação pública (`scripts/export-public.ts`). Arquivo `.md` novo que não entrar nela não chega ao repo público, e nenhum erro avisa.
  - O exportador recusa as entradas `EXECPLAN.md`, `VALIDATION.md`, `catalog/scenarios.json`, `wrangler.jsonc` e caminhos com segmento iniciado por `.`.
  - `scripts/export-public.ts` exige o título `## TypeScript migration evidence` dentro de `VALIDATION.md`, porque exporta só daquele ponto em diante. Não altere esse título.
- **Fontes de verdade.** Leia cada uma antes de escrever a seção que depende dela. Não use memória.

  | Assunto | Fonte |
  |---|---|
  | Comandos e mensagens | `preview/cli.ts` (`main`, `selectAccounts`) |
  | Fluxo do publish | `preview/publication.ts` (`publishRevision`, `continueRevision`, `exportSources`, `resumeRevision`) e `preview/remote.ts` (`Publisher`, com as etapas `buildAndValidate`, `acquireRemoteLease`, `registry`, `configuration`, `catalog`, `deploy`, `validatePublic`, `releaseRemoteLease`) |
  | Captura e recuperação | `preview/capture.ts` (`commits`, `capture`, `recover`, `sourceDigest`) |
  | Instalação | `scripts/install-tool.ts`, `preview/installation.ts` |
  | Configuração | `preview/config.ts`, `example/prepare.ts`, `example/sources.json` |
  | Visitante | `src/worker.ts` (`createWorker`), `src/scenario.ts` (`IDLE_MS`, fases, `launch`, `alarm`, `expire`), `runtime/start.ts`, `runtime/gateway.ts`, `runtime/register-codespace.ts`, `runtime/demo-activity.ts`, `runtime/DemoCredentials.java` |
  | Limites (20 MiB, 256 MiB, 10 min) | README atual, conferido contra `runtime/` e `src/` |
  | Histórico para o CHANGELOG | Seções "Na versão 0.3.x" do README, TUTORIAL e LLM atuais; `git tag -n`; `git log --oneline`; a seção "Execução observada da versão 0.2.0" de `docs/pt-BR/TUTORIAL.md` |

## Definitions

Estes termos serão definidos para o leitor em `CONCEPTS.md`. Confirme cada definição na fonte indicada.

- **Cenário:** nome (slug) de um preview, escolhido pelo operador. Fonte: `preview/cli.ts`.
- **Revisão:** sha256 de 64 caracteres das entradas congeladas: commits das 3 aplicações, dados, receita, runtime, Worker, `dist` e `toolCommit`. O link público usa `<cenario>-<16 primeiros caracteres>`. Fonte: `preview/publication.ts`.
- **Dados congelados / captura:** cópia sanitizada do H2 e das mídias, feita com o backend parado, em `state/data/<id>/`. Fonte: `preview/capture.ts`.
- **Lançador:** repositório GitHub **privado** do operador. Contém o Worker, o catálogo, `.devcontainer/<slug>/` e `tool.lock.json`.
- **Journal:** `operations/<revisao>/journal.json`, com etapa e checkpoints. É o que permite o `resume`.
- **Lease:** trava. As locais são arquivos `flock`. A remota é a ref `refs/heads/enois-preview-publication-lease` no lançador.
- **`restoration.json`:** registro do estado do backend antes da captura. A próxima execução usa esse registro para restaurar o backend.
- **`toolCommit` / `install.json`:** commit público fixado e os hashes da instalação. Ambos são conferidos antes de `publish` e `resume`.
- **As três aplicações:** `enois-backend` (Spring Boot, Java 25, H2), `enois-frontend` (Nuxt) e `enois-design-system` (pacote npm). Fonte: `example/sources.json`.

## Decisions

- **Mesmos nomes de arquivo nos dois idiomas** (`docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md`), com títulos traduzidos.
  - Alternativa considerada: nomes em português (`CONCEITOS.md`).
  - Razão: os links cruzados ficam simétricos e a paridade é fácil de conferir com `diff <(ls docs/pt-BR) <(ls docs/en)`.
  - Consequência: o README raiz (pt-BR) continua na raiz, como hoje.
- **Notas por versão saem dos guias e vão para o CHANGELOG.** Os guias descrevem só o comportamento atual.
  - Razão: evitar texto quase idêntico em 6 arquivos que envelhece a cada release.
  - Consequência: releases futuras atualizam o CHANGELOG, não os guias.
- **VALIDATION.md continua igual e só muda de posição no README.** Ele vai para uma seção "Para auditar".
  - Razão: é evidência histórica e o exportador depende do formato dele.
- **O TUTORIAL fica focado na primeira publicação com o exemplo fictício.** As situações do dia a dia vão para RECIPES.
  - Consequência: a tabela "Execução observada da versão 0.2.0" sai do TUTORIAL e vai para o CHANGELOG, com os links preservados.
- **No README, a tabela de comandos vem antes de Requisitos e Instalação** (decidido na execução).
  - Alternativa considerada: a ordem listada em M4 (Requisitos, Instalação, depois a tabela).
  - Razão: com essa ordem, a tabela ficaria além das cerca de 60 linhas renderizadas, e o aceite de M4 exige responder "qual comando uso" nas duas primeiras telas.
  - Consequência: as demais seções seguem a ordem de M4.
- **Ambos os idiomas são feitos nesta execução, sem pausa entre eles.**
  - Razão: o handoff executa o plano de ponta a ponta.
  - Consequência: o usuário revisa os dois idiomas no PR. Se pedir mudança de estrutura, ela é aplicada nos dois.

## Milestones

### M1. CHANGELOG e limpeza das notas por versão

- **Comportamento:** quem lê os guias vê só o comportamento atual. O histórico fica num lugar só.
- **Edições:**
  - Criar `CHANGELOG.md` (pt-BR) e `docs/en/CHANGELOG.md`, da versão mais nova para a mais antiga (0.3.7 … 0.2.0).
    - Cada entrada traz a data (de `git log -1 --format=%cs <tag>` quando a tag existe) e de 1 a 5 itens, em linguagem de operador.
    - O conteúdo vem das seções "Na versão 0.3.1/0.3.4" e "In 0.3.1/0.3.4" e das notas de 0.3.0 do TUTORIAL, do `git log` e da tabela 0.2.0 do TUTORIAL.
    - Versão sem informação suficiente nas fontes recebe só "Correções internas; veja o histórico do Git". Não invente.
  - Remover esses parágrafos de `README.md`, `docs/en/README.md`, `docs/*/TUTORIAL.md` e `docs/*/LLM.md`.
  - Regras ainda válidas que estavam nesses parágrafos (Ctrl+C, `restoration.json`, `source-digest`, leases) não podem se perder. Elas vão para RECIPES (M3), sem número de versão.
- **Validação:** `grep -nE "(Na versão|In) 0\.[0-9]" README.md docs/en/README.md docs/*/TUTORIAL.md docs/*/LLM.md` não imprime nada (exit 1).
- **Aceite:** com o README de 0.3.7 aberto, a frase "Na versão 0.3.1, Ctrl+C…" não aparece. O mesmo fato aparece uma vez no CHANGELOG (histórico) e uma vez em RECIPES (como agir).

### M2. CONCEPTS e FLOW, com diagramas Mermaid

- **Comportamento:** o leitor entende o modelo mental e a sequência antes de rodar qualquer comando.
- **Edições:**
  - `docs/{pt-BR,en}/CONCEPTS.md`:
    - glossário com os termos de `Definitions`, cada um com uma frase de "por que importa para você";
    - seção "Código vs dados" (o código vem dos commits; os dados ficam congelados até `--refresh-data`);
    - seção "Por que é imutável".
  - `docs/{pt-BR,en}/FLOW.md` com três diagramas, cada um seguido de uma lista numerada que explica cada passo em linguagem comum:
    1. **`flowchart` "onde roda o quê":** terminal local (`preview/`), GHCR (imagem de `recipe/` + `runtime/`), lançador privado, Cloudflare Worker + Durable Object (`src/`), Codespace (gateway :3000, Spring :8081, Nuxt :3001) e visitante.
    2. **`sequenceDiagram` do `publish`:**
       - leitura da config e recuperação pendente;
       - lock local e checagem de árvore limpa;
       - captura, só na primeira vez ou com `--refresh-data`;
       - export por commit;
       - congelamento da revisão e journal;
       - as 8 etapas do `Publisher`;
       - em caso de falha, `failure.json` e `resume`.
    3. **`sequenceDiagram` da visita:**
       - `/preview/<slug>`, o Durable Object e a criação do Codespace;
       - boot (`runtime/start.ts`), senhas novas e callback `/__demo/register`;
       - página de credenciais;
       - atividade renovando o prazo de 10 min, polling sem renovar, e exclusão.
  - Os nomes de etapas, rotas e portas são conferidos no código-fonte de `Context and limits`.
- **Validação:**
  - `grep -c '```mermaid' docs/pt-BR/FLOW.md docs/en/FLOW.md` retorna 3 em cada arquivo;
  - checagem de links (comando em `Validation`).
- **Aceite:** cada etapa do diagrama do publish corresponde a um nome real em `preview/remote.ts` ou `preview/publication.ts`. O executor registra essa correspondência em `Progress`.

### M3. RECIPES

- **Comportamento:** para cada situação comum, o operador acha um bloco que diz o que rodar e o que esperar.
- **Formato fixo de cada receita:** **Quando usar** · **Comandos** (bloco `sh` copiável) · **O que esperar** (saída ou efeito observável) · **Se der errado** (próxima ação, com link para diagnóstico).
- **Receitas, nesta ordem:**
  1. Instalar ou trocar a ferramenta para outro commit fixado.
  2. Primeira publicação com o exemplo fictício (resumo, com link para o TUTORIAL).
  3. Publicar de novo só com código novo.
  4. Publicar com dados novos (`--refresh-data`).
  5. Retomar uma publicação que falhou (`resume <revisao-completa>`).
  6. Ctrl+C, `SIGTERM` ou processo morto:
     - códigos de saída 130 e 143;
     - esperar a restauração do backend;
     - preservar `restoration.json`;
     - não remover leases alheias.
  7. Conferir se o banco mudou (`source-digest`, comparando `logicalSha256`, não `databaseSha256`).
  8. Usar meus próprios dados: campos `database`, `h2Jar`, `media`, `accounts` e `service`, e repetir `setup`.
  9. Compartilhar o link no PR e o que o visitante vê:
     - senhas na página de entrada;
     - contas compartilhadas;
     - 20 MiB por arquivo e 256 MiB por ambiente;
     - exclusão após 10 min.
  10. Erros comuns e o que fazer:
      - árvore suja;
      - `toolCommit` diferente da instalação;
      - instalação alterada (alguém rodou `npm run` dentro dela);
      - Node fora de `>=24 <25`.
- **Fontes:**
  - Comandos e mensagens de erro vêm de `preview/cli.ts`, `preview/publication.ts`, `preview/installation.ts` e `preview/capture.ts`.
  - Copie a mensagem de erro real (string do `PreviewError`) na receita 10, para o leitor achar por busca.
- **Validação:** `grep -c '^## ' docs/pt-BR/RECIPES.md docs/en/RECIPES.md` retorna o mesmo número (≥ 10) nos dois arquivos.
- **Aceite:** cada mensagem de erro citada na receita 10 é encontrada literalmente por `grep -rF "<mensagem>" preview/ scripts/`. O executor registra isso em `Progress`.

### M4. README, TUTORIAL e LLM reescritos

- **`README.md` e `docs/en/README.md`, nesta ordem:**
  1. Uma frase do que é.
  2. "O problema": revisar um PR exige o app inteiro rodando com dados realistas, e a ferramenta entrega um link que sobe esse ambiente sob demanda.
  3. Diagrama "onde roda o quê" (o mesmo de FLOW).
  4. Requisitos.
  5. Instalação (o bloco `sh` atual, mantido).
  6. Tabela de comandos (`setup`, `publish`, `publish --refresh-data`, `resume`, `source-digest`), cada um com uma linha de propósito e um link para a receita.
  7. Mapa da documentação.
  8. Limites e custos (contas compartilhadas, 10 min, planos gratuitos, termos do Codespaces).
  9. "Para auditar" (VALIDATION.md, diagnóstico).
  10. Licença.
  - Nenhum fato de limite ou custo do README atual pode se perder. Confira com o checklist em `Validation`.
- **`docs/*/TUTORIAL.md`:**
  - passos numerados, um comando por passo;
  - regras viram blocos curtos "Atenção:";
  - termos com link para CONCEPTS;
  - sem notas de versão e sem a tabela 0.2.0 (que vai para o CHANGELOG em M1).
- **`docs/*/LLM.md`:** manter o propósito e as proibições. Remover duplicações e apontar para CONCEPTS e RECIPES.
- **Outros links:**
  - `TUTORIAL.md` (raiz): atualizar os links;
  - `docs/diagnostics/*`: só corrigir links quebrados.
- **Validação:** a checagem de links e `diff <(ls docs/pt-BR) <(ls docs/en)`, que deve mostrar só `README.md` (existe apenas em `en`; o pt-BR fica na raiz) e `CHANGELOG.md` (em `en`; o pt-BR fica na raiz).
- **Aceite:** o README em pt-BR responde às 3 perguntas de `Purpose and success` nas primeiras duas telas (cerca de 60 linhas renderizadas).

### M5. Allowlist pública e validação final

- **Edições:** acrescentar a `release/public-files.json` os arquivos abaixo, em ordem alfabética, como o arquivo já está:
  - `CHANGELOG.md`
  - `docs/en/CHANGELOG.md`
  - `docs/en/CONCEPTS.md`
  - `docs/en/FLOW.md`
  - `docs/en/RECIPES.md`
  - `docs/pt-BR/CONCEPTS.md`
  - `docs/pt-BR/FLOW.md`
  - `docs/pt-BR/RECIPES.md`
- **Validação:** todos os comandos da seção `Validation`.
- **Aceite:** o pacote exportado contém os 8 arquivos novos e o `VALIDATION.md` exportado continua começando por `# TypeScript migration validation`.

## Progress

Executado em 11 de novembro de 2026 na branch `docs/operator-documentation`, Node 24.16.0. Antes das edições, as checagens 7, 8, 9 e 10 falhavam (notas por versão em 6 guias; CONCEPTS, FLOW, RECIPES e CHANGELOG inexistentes).

- [x] M1 CHANGELOG e limpeza das notas por versão
  - `CHANGELOG.md` e `docs/en/CHANGELOG.md` cobrem 0.3.7 até 0.2.0, com datas de `git log -1 --format=%cs <tag>` (0.2.0, 0.3.0 e 0.3.1: 2026-11-07; 0.3.2: 2026-11-09; 0.3.3 a 0.3.6: 2026-11-10; 0.3.7: 2026-11-11). Itens tirados dos guias antigos, das mensagens de commit e das seções por versão de `VALIDATION.md`. A tabela "Execução observada da versão 0.2.0" de cada idioma foi movida com os links preservados.
  - Checagem 7: `grep -nE "(Na versão|In) 0\.[0-9]" ...` sem saída, exit 1.
  - "Ctrl+C" aparece uma vez como histórico (CHANGELOG 0.3.1) e uma vez como ação (RECIPES, receita 6).
- [x] M2 CONCEPTS e FLOW
  - Correspondência etapa do diagrama → código: `buildAndValidate` (`preview/remote.ts:37`), `acquireRemoteLease` (`:189`), `registry` (`:141`), `configuration` (`:85`), `catalog` (`:109`), `deploy` (`:164`), `validatePublic` (`:57`), `releaseRemoteLease` (`:213`). Passos anteriores: `publishRevision` (`preview/publication.ts:136`), `exportSources` (`:96`), `continueRevision` (`:115`, grava `failure.json`), `resumeRevision` (`:179`), `verifyJournal` (`:86`), `recoverPending` (`:112`); árvore suja em `commits` (`preview/capture.ts`); `installed` e restauração em `preview/cli.ts`.
  - Visita conferida em `src/worker.ts` (`/preview/<slug>`, `/__demo/status/<slug>`, `/__demo/register`, página de credenciais, recusa com espera de dez minutos), `src/scenario.ts` (`IDLE_MS = 600_000`, fases, `launch`, `alarm`, `expire`), `runtime/start.ts` (Spring 127.0.0.1:8081, Nuxt 3001, gateway, `DemoCredentials`), `runtime/gateway.ts` (porta 3000, `/api` para 8081, resto para 3001, injeção de `activity.js`), `runtime/demo-activity.ts` (eventos confiáveis, aba visível, intervalo de 15 s).
  - Checagem 9: 3 blocos `mermaid` em cada FLOW.
  - Correção feita durante a escrita: `resume` também verifica a instalação (`verifyJournal` chama `toolCommit`), então ele pula os passos 4, 6, 7 e 8 do FLOW, não 4 a 8.
- [x] M3 RECIPES
  - 10 seções `##` em cada idioma.
  - Mensagens da receita 10 encontradas literalmente com `grep -rlF`: árvore suja (`preview/capture.ts`), `toolCommit` diferente (`preview/publication.ts`), instalação alterada (`preview/installation.ts`), pin do lançador (`preview/remote.ts`), confirmação inicial (`preview/config.ts`). `Unsupported record format. Expected` está em `shared/records.ts`, fora de `preview/` e `scripts/`; o restante da mensagem é montado com `FORMAT`.
  - Lacuna: a ferramenta não verifica a versão do Node e não tem mensagem de erro para isso (só `engines` em `package.json` e `.nvmrc`). A receita 10 diz isso e orienta `node --version`, sem inventar mensagem.
  - Limites conferidos: 20 MiB em `src/upload-transport.ts` e `recipe/StrictMediaSanitizer.java`; 256 MiB em `recipe/test/DemoLocalStorageTests.java`; 10 min em `IDLE_MS`.
- [x] M4 README, TUTORIAL e LLM
  - Checagem 8: `diff <(ls docs/pt-BR) <(ls docs/en)` mostra só `CHANGELOG.md` e `README.md` do lado `en`. Pares de `## `: CONCEPTS 5/5, FLOW 3/3, RECIPES 10/10, TUTORIAL 5/5, LLM 3/3.
  - `TUTORIAL.md` (raiz) ganhou links para RECIPES. `docs/diagnostics/*` não precisou de mudança: nenhum link quebrou.
  - Além da checagem 5, todas as âncoras `#...` dos arquivos alterados foram conferidas contra os títulos (slug no estilo GitHub): 0 quebradas.
- [x] M5 allowlist e validação final
  - `release/public-files.json`: 8 entradas adicionadas, ordem alfabética mantida (diff só com `+`).
  - Validação: 1 `npm run build` exit 0; 2 `npm run typecheck` exit 0; 3 `npm test` exit 0 (114 testes, 114 passaram, 0 falhas); 4 `npm run check` exit 0; 5 links exit 0 sem saída; 6 exportação exit 0, os 8 arquivos presentes, primeira linha `# TypeScript migration validation`; 7 sem saída; 8 conforme M4; 9 3 e 3; 10 sem saída.

Checklist de preservação (restrição → onde aparece agora):

| Restrição | Arquivo e seção |
| --- | --- |
| Recusa de árvore suja | README "Limites e custos"; RECIPES 3 e 10; FLOW passo 4 |
| A ferramenta não comita nem altera as três aplicações | README "Limites e custos"; CONCEPTS "As três aplicações"; RECIPES 10 |
| Instalação imutável e proibição de `npm run` dentro dela | README "Instalação"; TUTORIAL passo 9; RECIPES 1 |
| Checkout de desenvolvimento não publica | README "Instalação"; RECIPES 1 |
| Revisões da 0.3.1 ou anteriores só retomam com o executor original | README "Instalação"; RECIPES 5; CHANGELOG 0.3.2 |
| Formato `enois-preview-ts-v1` e recusa de registros antigos | README "Instalação"; RECIPES 10; LLM "Proibições"; TUTORIAL "Lançador da versão Python" |
| Ctrl+C (130/143), `restoration.json` e leases | RECIPES 6; CONCEPTS "Lease" e "`restoration.json`"; LLM "Como orientar" |
| `source-digest` só lê; comparar `logicalSha256` | RECIPES 7; README "Comandos" |
| Contas compartilhadas, 20 MiB / 256 MiB, 10 min, polling não renova | README "Limites e custos"; RECIPES 9; FLOW visita, passos 8 e 9 |
| Planos gratuitos só no setup; nenhum cartão ou plano pago | README "Limites e custos"; TUTORIAL passo 15 |
| Termos do Codespaces | README "Limites e custos" |
| GPLv3, avisos dos projetos, dados fora do repositório | README "Licença" |
| Codespace sem comandos manuais no terminal dele | TUTORIAL "Antes de começar"; RECIPES 9; CONCEPTS "Worker, Durable Object e Codespace"; LLM |
| Tokens nunca em argumentos, chat ou arquivos versionados | TUTORIAL "Antes de começar"; RECIPES 1; LLM "Proibições" |

Lacunas abertas:
- Renderização Mermaid não verificada localmente (sem `mermaid-cli`). Conferir na pré-visualização do GitHub no PR.
- Versão do Node sem mensagem de erro própria (ver M3).

## Risks

- **Fato errado na documentação.** É o principal risco: texto mais simples tende a generalizar demais. Controle: toda afirmação sobre comportamento é conferida na fonte da tabela de `Context and limits` e os nomes citados são buscados com `grep`. Se o executor não confirmar um fato no código, ele não escreve o fato e registra a lacuna em `Progress`.
- **Perda de restrição importante** ao enxugar o texto (por exemplo, "não rode `npm run` dentro da instalação", "não remova leases alheias", "um checkout de desenvolvimento não publica"). Controle: o checklist de preservação em `Validation`.
- **Diagramas Mermaid sem verificação local de renderização.** Não há `mermaid-cli` nas dependências e não vamos adicionar nenhuma. Controle: sintaxe simples (sem estilos nem HTML nos rótulos). A renderização fica como **lacuna declarada**, a conferir na pré-visualização do GitHub no PR.
- **Divergência entre idiomas.** Controle: os mesmos nomes de arquivo e a mesma contagem de seções (`grep -c '^## '`) em cada par.
- **Vazamento em repositório público.** Controle: `grep -rnE "/home/|@[a-z0-9.-]+\.(com|br)" README.md CHANGELOG.md docs/pt-BR docs/en` não retorna nada. Os emails `@enois.invalid` do exemplo são aceitáveis.

## Validation

Rode na raiz do repositório. Os resultados esperados vêm entre parênteses. Registre em `Progress` o resultado observado de cada comando.

1. `npm run build` (exit 0)
2. `npm run typecheck` (exit 0)
3. `npm test` (exit 0, 0 falhas)
4. `npm run check` (exit 0)
5. Links relativos (exit 0, nenhuma linha impressa):
   ```sh
   node -e 'const fs=require("fs"),p=require("path"),cp=require("child_process");const fs_=cp.execSync("git ls-files --cached --others --exclude-standard \"*.md\"").toString().trim().split("\n").filter(f=>!f.startsWith("docs/validation/")&&!f.startsWith(".agent/"));let bad=0;for(const f of fs_){const t=fs.readFileSync(f,"utf8");for(const m of t.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)){const l=m[1];if(/^[a-z]+:/i.test(l))continue;if(!fs.existsSync(p.join(p.dirname(f),l))){console.log(f+" -> "+l);bad++;}}}process.exit(bad?1:0)'
   ```
6. Exportação pública (exit 0; os 8 arquivos novos existem; a primeira linha do VALIDATION exportado é `# TypeScript migration validation`):
   ```sh
   out=$(mktemp -d)/public && node dist/scripts/export-public.js "$out" && for f in CHANGELOG.md docs/en/CHANGELOG.md docs/en/CONCEPTS.md docs/en/FLOW.md docs/en/RECIPES.md docs/pt-BR/CONCEPTS.md docs/pt-BR/FLOW.md docs/pt-BR/RECIPES.md; do test -f "$out/$f" || echo "FALTA $f"; done; head -1 "$out/VALIDATION.md"
   ```
7. Notas por versão removidas dos guias (sem saída): `grep -nE "(Na versão|In) 0\.[0-9]" README.md docs/en/README.md docs/*/TUTORIAL.md docs/*/LLM.md`
8. Paridade: `diff <(ls docs/pt-BR) <(ls docs/en)` mostra apenas `CHANGELOG.md` e `README.md` do lado `en`. O comando `for f in CONCEPTS FLOW RECIPES TUTORIAL LLM; do echo $f $(grep -c '^## ' docs/pt-BR/$f.md) $(grep -c '^## ' docs/en/$f.md); done` mostra pares iguais.
9. Mermaid: `grep -c '```mermaid' docs/pt-BR/FLOW.md docs/en/FLOW.md` retorna 3 em cada um. A renderização é uma lacuna declarada, a conferir no PR.
10. Privacidade: `grep -rnE "/home/|@[a-z0-9.-]+\.(com|br)" README.md CHANGELOG.md docs/pt-BR docs/en` não imprime nada.
11. **Checklist de preservação.** Para cada restrição abaixo, que está no README e no TUTORIAL atuais, registre em `Progress` o arquivo e a seção nova onde ela aparece:
    - recusa de árvore suja;
    - "a ferramenta não comita nem altera as três aplicações";
    - instalação imutável e proibição de `npm run` dentro dela;
    - checkout de desenvolvimento não publica;
    - revisões da 0.3.1 ou anteriores só retomam com o executor original;
    - formato `enois-preview-ts-v1` e recusa de registros antigos;
    - Ctrl+C (130/143), `restoration.json` e leases;
    - `source-digest` só lê e se compara `logicalSha256`;
    - contas compartilhadas, 20 MiB / 256 MiB e 10 min (o polling não renova);
    - planos gratuitos conferidos só no setup; nenhum cartão ou plano pago;
    - termos do Codespaces;
    - GPLv3, avisos dos projetos e dados fora do repositório;
    - Codespace não exige comandos manuais no terminal dele;
    - tokens nunca em argumentos, chat ou arquivos versionados.

**Obrigações do executor antes de entregar:**
- Confira cada expectativa contra as fontes citadas, separadamente de conferir se os comandos passam. Um `npm test` verde não prova que os docs estão corretos.
- Registre em `Progress` a evidência de cada critério: o comando, o resultado observado e o arquivo ou a linha.
- Registre lacunas (por exemplo, a renderização Mermaid e fatos não confirmados) como lacunas. Não declare satisfeito um critério com lacuna aberta.
