# Documentar o link do preview como evidência viva no pull request

## Purpose and success

O usuário explicou, em 11 de novembro de 2026, o problema que o enois-preview resolve de fato. Num pull request (PR) do Énóis, ele hoje precisa provar a correção com prints e vídeos:
- no PR `Rede-ENois/enois-frontend#440`, foram dois vídeos, de celular e de desktop;
- no PR `Rede-ENois/enois-design-system#19`, foram prints de antes e depois, mais um script de DevTools aplicado em produção.

Com o link do preview, quem revisa abre a mudança rodando num ambiente real e analisa do jeito que preferir, inclusive no próprio celular, indo além do que um print mostra.

A documentação atual (commit `2c3dfa3`) apresenta outro problema ("montar o ambiente na máquina de cada revisor é lento"). Ela também não avisa que os repositórios do Énóis são **públicos** e que, por isso, o link colado no PR também é público.

**Sucesso (observável):**
- **Abertura do README** (pt e en):
  - a seção "O problema" apresenta o preview como evidência viva no lugar de print e vídeo;
  - a frase da linha 3 vira duas frases mais curtas.
- **Receita 9 reescrita** como "Mostrar no PR que o problema foi resolvido" (en "Show in the PR that the problem is fixed"). Ela traz, em pt e en:
  - um passo "o que torna o problema reproduzível?";
  - a regra de dados decidida pelo usuário;
  - o aviso de link público;
  - um bloco "Como verificar" pronto para colar no PR;
  - o print opcional sempre acompanhado do link.
- **A âncora antiga da receita 9 continua funcionando.**
- **O pt-BR deixa de usar "revisão" para dois conceitos diferentes.** No CONCEPTS, a entrada PR não usa mais "revisão" no sentido de avaliação de código.
- **A receita 8, o README (Limites e custos) e o LLM.md** avisam que todo o conteúdo do H2 e das mídias capturadas fica visível para quem abre o link, e linkam para a receita 9.
- Todas as validações em `Validation` passam.

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Context and limits

- **Repositório:** `~/projects/enois-preview`. O trabalho **continua na branch `docs/operator-documentation`**:
  - ela está em `origin` no commit `2c3dfa3` e ainda não tem PR;
  - não crie outra branch;
  - este plano é a única mudança pendente e vai no commit.
- O GitHub é **público**. Não escreva caminhos absolutos com nome de usuário, emails reais, segredos nem URLs privadas.
- Também não cite nomes de pessoas, comunidades ou links de posts reais do Énóis.
- Os exemplos da documentação descrevem as características do caso (por exemplo, "um post fixado numa comunidade de nome longo, numa tela estreita"), nunca o conteúdo real.
- **Pode editar (documentação):**
  - `README.md`;
  - `docs/en/README.md`;
  - `docs/{pt-BR,en}/{CONCEPTS,RECIPES,TUTORIAL,LLM}.md`.
- **Protegidos:**
  - todo o código (`preview/`, `src/`, `runtime/`, `recipe/`, `scripts/`, `shared/`, `example/`, `test/`);
  - `package.json`, `release/public-files.json`;
  - `VALIDATION.md`, `docs/validation/**`, `CHANGELOG.md`, `docs/en/CHANGELOG.md`;
  - os ExecPlans anteriores.
- **Habilidades:** siga `restructure-documentation` (`~/.claude/skills/restructure-documentation/SKILL.md`):
  - defina cada termo antes do primeiro uso;
  - cada assunto tem um único dono;
  - preserve âncoras;
  - não reescreva o que já está em ordem.
- **Escrita:** sem hífens desnecessários. Paridade pt e en no mesmo marco.

**Fatos que a documentação vai afirmar, com a fonte.** Releia cada fonte antes de escrever. Se o código contradisser algo desta lista, o código prevalece: registre a divergência em `Progress`.

| Fato | Fonte |
|---|---|
| Os repositórios `Rede-ENois/enois-backend`, `enois-frontend` e `enois-design-system` são públicos | `gh repo view Rede-ENois/<repo> --json visibility` retornou `PUBLIC` em 11 de novembro de 2026 |
| A captura leva **todo** o banco H2 e as pastas de mídia configuradas. Só as contas selecionadas ficam com login; as outras mantêm perfil e conteúdo visíveis, com login desativado | `recipe/SeedTool.java` (`sanitize`: `UPDATE USER_CREDENTIALS SET PASSWORD_HASH='!preview-disabled'…` e depois a reativação das selecionadas); `preview/capture.ts` (`capture`); TUTORIAL, seção "O que o exemplo contém" (Maya e Davi) |
| A sanitização remove sessões, tokens e senhas, mas não anonimiza conteúdo | `recipe/SeedTool.java` (`DROP`, colunas `PASSWORD|SECRET|TOKEN…`); README, seção Licença ("Sanitizar autenticação não anonimiza o conteúdo escolhido pelo operador") |
| A página de entrada do link mostra as contas e senhas, geradas de novo a cada boot | `runtime/DemoCredentials.java`, `runtime/start.ts`, `src/worker.ts` (`/__demo/credentials`); receita 9 atual |
| Os visitantes compartilham contas, estado e capacidade (20 MiB por arquivo, 256 MiB por ambiente) | receita 9 atual (dona desses limites desde `2c3dfa3`) |
| O ambiente é apagado após 10 min sem interação reconhecida. Uma visita nova sobe outro ambiente. O link é imutável, mas não promete ambiente disponível, porque depende da infraestrutura do operador e das cotas gratuitas | `src/scenario.ts` (`IDLE_MS`, `launch`); receita 9 atual; README, seção "Limites e custos" |
| Para trocar os dados: `publish <cenario> --refresh-data`; as contas são escolhidas por `accounts` ou interativamente | receita 4; `preview/cli.ts` (`selectAccounts`); receita 8 |
| Para usar um banco próprio: campos `database`, `h2Jar`, `media`, `accounts` e `service`, e repetir `setup` | receita 8 |

## Decisions

- **Regra de dados para previews em PRs públicos** (decidida pelo usuário em 11 de novembro de 2026). A documentação recomenda, em ordem:
  1. **Dados fictícios moldados no caso real:** reproduzir a *forma* que causa o problema (tamanho de textos, quantidade de itens, emojis, dimensões de imagem, estados como "fixado" ou "com selos", largura de tela), não o conteúdo real.
  2. **Os seus próprios dados**, sabendo que ficam expostos a quem abrir o link.
  3. **Conteúdo de outras pessoas (inclusive raspado do Énóis): não use**, a não ser com consentimento delas ou aval da equipe do Énóis.
  - Razão:
    - o conteúdo vira público junto com o PR;
    - as contas selecionadas viram contas compartilhadas, com senha exibida;
    - a sanitização não anonimiza.
  - Alternativa considerada e descartada: raspar dados do Énóis para reproduzir problemas reais.
- **Print opcional, sempre com o link** (decidido pelo usuário). O link é a evidência principal. Um print do "depois" pode acompanhar o link quando ajudar, por exemplo como registro durável depois que o ambiente deixar de existir. O print nunca substitui o link.
- **A receita 9 muda de título, e a âncora antiga é preservada** com `<a id="9-compartilhar-o-link-no-pr"></a>` (en `<a id="9-share-the-link-in-the-pr"></a>`) na linha anterior ao novo título. Os links internos (TUTORIAL, linha 145, e README, linha 94, nos dois idiomas) passam para a âncora nova.
- **A receita 9 é a dona** do assunto "evidência no PR, regra de dados e aviso de link público". A receita 8, o README e o LLM.md ficam com uma frase e um link.
- **Desambiguação de "revisão" no pt-BR:**
  - "revisão" passa a significar só o identificador da ferramenta (glossário);
  - para avaliação de código, use "avaliar" ou "analisar". Exemplo: "o pedido para que outras pessoas avaliem uma mudança de código no GitHub". O mesmo vale para "revisor", que vira "quem avalia" ou "quem analisa".
  - Em inglês, "code review" e "reviewer" ficam como estão.

## Milestones

### M1. Propósito, abertura e desambiguação

- **Comportamento:** quem chega ao README entende, nas primeiras linhas, que o link substitui print e vídeo como evidência no PR.
- **Edições:**
  - `README.md` e `docs/en/README.md`:
    - Dividir a linha 3 em duas frases: (1) o que a ferramenta faz para o PR; (2) o que é o Énóis (texto atual mantido).
    - Reescrever "O problema" em torno da evidência. Hoje o autor prova a correção com prints e vídeos de celular e desktop. Quem avalia só vê o que foi gravado e não consegue explorar outros caminhos, tamanhos de tela ou o próprio aparelho. Com o link, quem avalia abre a mudança rodando e analisa como preferir.
    - Manter a frase sobre montar o ambiente na máquina de quem avalia como motivo secundário.
  - `docs/pt-BR/CONCEPTS.md`: entrada "PR (pull request)" sem a palavra "revisão" no sentido de avaliação; "Por que importa para você" alinhado ao propósito novo. Espelhar em `docs/en/CONCEPTS.md`.
  - Em todos os arquivos editáveis em pt-BR, trocar "revisão", "revisor" e o verbo "revisar" usados no sentido de avaliação de código. Encontre as ocorrências com `grep -niE "revis(ão|or|ores|ora|ar|ando|ou|e)\b" README.md docs/pt-BR/*.md` e classifique cada uma.
  - Ocorrências conhecidas em `2c3dfa3`:
    - `README.md:3`: "pedido de revisão de código";
    - `README.md:9`: "Para revisar um PR";
    - `docs/pt-BR/CONCEPTS.md:17`: "pedido de revisão de código";
    - `docs/pt-BR/CONCEPTS.md:59`: a nota "Não confunda com a revisão de código feita no PR", que passa a "avaliação de código" e continua servindo de aviso de desambiguação.
- **Validação:**
  - `grep -niE "revisão de código|revisor|\brevisar\b" README.md docs/pt-BR/*.md` sem saída;
  - os verificadores de links (Validation 5).
- **Aceite:**
  - As primeiras 20 linhas do README pt mencionam print ou vídeo e quem avalia explorando o ambiente real.
  - No CONCEPTS pt, a primeira ocorrência de `revis(ão|ões)` é o título `### Revisão` ou vem depois dele. A barra de navegação não conta.

### M2. Receita 9: mostrar no PR que o problema foi resolvido

- **Comportamento:** o operador sai da receita sabendo que dados usar, o que fica público e o que colar no PR.
- **Edições** em `docs/pt-BR/RECIPES.md` e `docs/en/RECIPES.md`, mantendo o formato **Quando usar / Comandos / O que esperar / Se der errado**:
  - Âncora antiga preservada (veja `Decisions`) e título novo.
  - **Quando usar:** você corrigiu algo e quer que quem avalia veja a correção rodando, sem depender de print ou vídeo.
  - **Antes de publicar, um bloco "Atenção: o link é público":**
    - os repositórios do Énóis são públicos, e o link no PR também;
    - todo o conteúdo do H2 local e das mídias capturadas fica visível;
    - as contas selecionadas viram contas compartilhadas, com senha na página de entrada;
    - a sanitização não anonimiza conteúdo;
    - a regra de dados em três níveis (veja `Decisions`).
  - **Comandos:**
    1. Responder "o que torna o problema reproduzível?" e criar esses dados fictícios na sua aplicação local, pela própria interface. Exemplos genéricos: um post fixado numa comunidade de nome longo; um perfil com as seções Sobre, Projetos e Publicações preenchidas.
    2. Rodar `enois-preview publish <cenario> --refresh-data` (link para a receita 4) e, se necessário, selecionar as contas fictícias (link para a receita 8).
    3. Testar o link você mesmo.
    4. Colar no PR o bloco "Como verificar".
  - **O bloco "Como verificar"**, num bloco de código `markdown` copiável. Em pt:
    ```markdown
    ## Como verificar

    Preview: <url do JSON final>
    Contas e senhas: na página de entrada do link (mudam a cada boot).

    1. Entre como <conta>.
    2. Abra <página> e <ação>.
    3. Esperado: <resultado>. Confira no celular e no desktop, ou no seu próprio aparelho.

    Dados fictícios, montados para reproduzir <característica do caso>.
    <!-- Opcional: um print do "depois". O link continua sendo a evidência principal. -->
    ```
    Em en, a mesma estrutura traduzida.
  - **O que esperar:** manter os fatos atuais da receita (página de espera, Codespace sobe sozinho, contas compartilhadas, 20 MiB e 256 MiB, novo boot descarta mudanças e troca senhas, cadastro e integrações desligados, 10 min, link imutável sem ambiente permanente) e acrescentar:
    - quem avalia pode abrir o link no próprio celular, o que é um aparelho real e não uma emulação;
    - um print opcional ajuda como registro durável, porque o ambiente depende da sua infraestrutura e das cotas gratuitas continuarem existindo.
  - **Se der errado:** manter o conteúdo atual.
  - Links internos para a âncora antiga, que passam para a âncora e o título novos:
    - `docs/{pt-BR,en}/TUTORIAL.md:145` ("Limites para quem abre o link");
    - `README.md:94` e `docs/en/README.md:94` (Limites e custos).
    - Confira com `grep -rn "9-compartilhar-o-link-no-pr\|9-share-the-link-in-the-pr" README.md docs`: depois da mudança, só os `<a id>` da própria receita devem aparecer.
- **Validação:**
  - verificadores de links;
  - `grep -c '<a id="9-compartilhar-o-link-no-pr"></a>' docs/pt-BR/RECIPES.md` retorna 1;
  - `grep -c '<a id="9-share-the-link-in-the-pr"></a>' docs/en/RECIPES.md` retorna 1.
- **Aceite:**
  - a receita contém a regra de dados nos três níveis, o aviso de link público, o bloco copiável e o print opcional junto do link;
  - os fatos de limite que estavam na receita 9 continuam nela (checklist em Validation 9).

### M3. Avisos curtos nos outros documentos

- **Edições:**
  - **Receita 8** (pt e en): uma linha "Atenção:" dizendo que todo o conteúdo do banco e das mídias configuradas fica visível para quem abre o link, que só os seus próprios dados ou dados fictícios devem ser usados, e linkando para a receita 9.
  - **README, "Limites e custos"** (pt e en): acrescentar ao item da linha 94, que já linka a receita 9, a frase "num PR público, o link também é público, e todo o conteúdo dos dados capturados fica visível". Não crie um item novo.
  - **LLM.md** (pt e en), em "Proibições":
    - não sugerir raspar ou importar conteúdo de outras pessoas para reproduzir um problema;
    - recomendar dados fictícios moldados no caso;
    - link para a receita 9.
  - **CONCEPTS** (pt e en), entrada "Operador e visitante": deixar claro que o visitante é qualquer pessoa com o link, sem duplicar a regra de dados.
- **Validação:** verificadores de links e paridade de seções.
- **Aceite:** cada um dos quatro arquivos tem exatamente um link para a receita 9 (âncora nova) no trecho editado e não repete a regra completa.

### M4. Validação final e auditoria

- Rodar tudo da seção `Validation` e registrar em `Progress` o resultado observado de cada item.
- Revisar `git diff 2c3dfa3`. Procurar:
  - mudança sem ganho de propósito, ordem ou dono;
  - fato sem fonte;
  - âncora quebrada;
  - edição fora do escopo;
  - nome, link ou conteúdo real do Énóis.
- Percorrer duas jornadas e registrar o resultado em `Progress`:
  1. Operador que acabou de corrigir um bug: README → receita 9 → PR com o bloco "Como verificar".
  2. Quem chega direto pela âncora antiga `RECIPES.md#9-compartilhar-o-link-no-pr` cai na receita nova.

## Progress

- [x] M1 propósito, abertura e desambiguação (pt e en)
  - `README.md:3` e `docs/en/README.md:3`: a frase longa virou duas (o que a ferramenta faz para o PR; o que é o Énóis), mais a frase original sobre quem abre o link.
  - "O problema" (`README.md:9-11`, `docs/en/README.md:9-11`) apresenta print e vídeo, quem avalia explorando o ambiente real, o motivo secundário (montar o ambiente localmente) e um link para a receita 9. Esse link extra serve à jornada 1; o item de "Limites e custos" continua sendo o único link no trecho editado do M3.
  - CONCEPTS: entrada PR sem "revisão" no sentido de avaliação (pt) e "Por que importa" alinhado (pt e en); nota da linha 59 passou a "avaliação de código". No CONCEPTS pt, a primeira ocorrência de `revis(ão|ões)` é o título `### Revisão` (linha 57).
  - Validation 8 sem saída. As demais ocorrências de "revisão" no pt (LLM:5, README:100, RECIPES, FLOW, TUTORIAL:1) são do identificador e ficaram como estão.
- [x] M2 receita 9 nova (pt e en)
  - `<a id>` antigo na linha 193 e título novo na 194, nos dois idiomas. TUTORIAL:145 e README "Limites e custos" apontam para a âncora nova. O grep das âncoras antigas só encontra os dois `<a id>`.
  - Divergência registrada contra o código: com `accounts` vazio, `preview/capture.ts:162` reaproveita as contas da captura anterior no `--refresh-data`; só o primeiro `publish` de um cenário pergunta. O passo 2 da receita diz isso e oferece as duas saídas (IDs em `accounts` e `setup`, ou um cenário novo).
  - Checklist de Validation 9 (linhas iguais em pt e en): página de espera e Codespace sozinho 228; senhas a cada boot 228 (e 218 no bloco); sessões independentes 231; 20 MiB e 256 MiB, sem mídias da semente, 232; novo boot descarta e troca senhas 233; cadastro e integrações desligados 234; 10 min, página de espera e credenciais sem renovar, franquias 235; link imutável e atualização manual 236; print opcional e infraestrutura 237; "O GitHub recusou a criação." e dez minutos 239.
- [x] M3 avisos curtos nos outros documentos (pt e en)
  - Receita 8: uma linha "Atenção:" com um link para a receita 9. README "Limites e custos": a frase do PR público foi acrescentada ao item existente, com um único link. LLM "Proibições": um item com um link. CONCEPTS "Operador e visitante": visitante é qualquer pessoa com o link, com um link e sem a regra de dados.
- [x] M4 validação final, auditoria e jornadas (11 de novembro de 2026)
  - 1 build, 2 typecheck, 3 test (114 de 114 passaram) e 4 check: exit 0.
  - 5: `check_markdown_links.py` exit 0; `node -e` exit 0, sem saída.
  - 6: 1 e 1. 7: CONCEPTS 19/19, FLOW 3/3, RECIPES 11/11, TUTORIAL 5/5, LLM 3/3, README 10/10.
  - 8 e 10: sem saída. 11: exit 0, primeira linha `# TypeScript migration validation`.
  - Fatos reconferidos: `gh repo view` retornou `PUBLIC` para os três repositórios; `SeedTool.java:105` desativa todas as senhas antes de reativar as selecionadas; `DROP` e o padrão `PASSWORD|SECRET|TOKEN…` não tocam conteúdo; `IDLE_MS = 600_000`; `/__demo/credentials` em `src/worker.ts`.
  - `git diff 2c3dfa3 --stat`: só os 10 arquivos de documentação autorizados; nenhum nome, link ou conteúdo real do Énóis.
  - Jornada 1: README "O problema" → link para a receita 9 → aviso de link público, regra de dados, passos e bloco "Como verificar" para colar no PR. Completa.
  - Jornada 2: `RECIPES.md#9-compartilhar-o-link-no-pr` resolve para o `<a id>` da linha 193, imediatamente antes do título novo. Completa.
  - Lacuna: a renderização no GitHub (bloco `markdown` com comentário HTML dentro) não foi vista num navegador; será conferida no PR.

## Risks

- **Prometer mais do que o preview entrega**, por exemplo "substitui qualquer evidência" ou "fica disponível para sempre". Controle: use só os fatos da tabela de `Context and limits`. O texto deixa claro que o ambiente pode deixar de subir e que o print opcional cobre isso.
- **Vazar dados reais pela própria documentação**, ao usar os PRs #440 e #19 como exemplos com nomes, comunidades ou links reais. Controle: exemplos só pelas características do caso e o grep de privacidade (Validation 10).
- **Perder fatos da receita 9 ao reescrever.** Controle: checklist em Validation 9.
- **Divergência entre idiomas.** Controle: Validation 7.

## Validation

Rode na raiz do repositório. Os resultados esperados vêm entre parênteses.

1. `npm run build` (exit 0)
2. `npm run typecheck` (exit 0)
3. `npm test` (exit 0, 0 falhas)
4. `npm run check` (exit 0)
5. Links locais (os dois com exit 0):
   - `python3 -I ~/.claude/skills/restructure-documentation/scripts/check_markdown_links.py README.md CHANGELOG.md TUTORIAL.md docs/pt-BR docs/en docs/diagnostics`
   - o comando `node -e` da seção Validation 5 de `.agent/execplans/operator-documentation.md`
6. Âncoras da receita 9 (cada linha retorna 1): `grep -c '<a id="9-compartilhar-o-link-no-pr"></a>' docs/pt-BR/RECIPES.md` e `grep -c '<a id="9-share-the-link-in-the-pr"></a>' docs/en/RECIPES.md`
7. Paridade (pares iguais):
   - `for f in CONCEPTS FLOW RECIPES TUTORIAL LLM; do echo $f $(grep -c '^##' docs/pt-BR/$f.md) $(grep -c '^##' docs/en/$f.md); done`
   - `echo README $(grep -c '^##' README.md) $(grep -c '^##' docs/en/README.md)`
8. Desambiguação (sem saída): `grep -niE "revisão de código|revisor|\brevisar\b" README.md docs/pt-BR/*.md`
9. **Checklist de preservação da receita 9.** Registre a linha onde cada fato aparece na receita nova, em pt e en:
   - página de espera e Codespace subindo sozinho;
   - senhas geradas a cada boot;
   - contas compartilhadas e sessões independentes para quem escreve e quem lê;
   - 20 MiB por arquivo e 256 MiB por ambiente, sem contar as mídias da semente;
   - novo boot descarta mudanças e uploads e troca senhas;
   - cadastro público e integrações de escrita desligados;
   - 10 min sem interação, com página de espera e leitura de credenciais sem renovar o prazo;
   - disponibilidade e franquias das plataformas;
   - link imutável sem ambiente permanente e atualização manual do link no PR;
   - "O GitHub recusou a criação." e a espera de dez minutos.
10. **Privacidade** (sem saída):
    - `grep -rnE "/home/|@[a-z0-9.-]+\.(com|br)" README.md docs/pt-BR docs/en`
    - `grep -rniE "pearl jam|enois\.ia\.br/(post|comunidades)|user-attachments" README.md docs/pt-BR docs/en`
11. **Exportação pública** (exit 0; a primeira linha é `# TypeScript migration validation`):
    ```sh
    out=$(mktemp -d)/public && node dist/scripts/export-public.js "$out" && head -1 "$out/VALIDATION.md"
    ```

**Obrigações do executor antes de entregar:**
- Confira cada fato escrito contra a fonte em `Context and limits`, separadamente de conferir se os comandos passam.
- Registre em `Progress` a evidência de cada critério (comando, resultado observado e arquivo ou linha) e as duas jornadas do M4.
- Registre lacunas como lacunas. Não declare cumprido um critério com lacuna aberta.
