# Fluxo

[English](../en/FLOW.md) · [README](../../README.md) · [Conceitos](CONCEPTS.md) · [Receitas](RECIPES.md)

Três diagramas: onde cada parte roda, o que acontece no `publish` e o que acontece quando alguém abre o link. Os termos estão explicados em [Conceitos](CONCEPTS.md).

## Onde roda o quê

```mermaid
flowchart LR
  subgraph Local["Sua máquina"]
    CLI["CLI enois-preview (preview/)"]
    Apps["3 aplicações e H2 local"]
  end
  GHCR["GHCR privado: imagem feita de recipe/ e runtime/"]
  Launcher["Lançador privado no GitHub: catálogo e .devcontainer"]
  subgraph CF["Cloudflare"]
    Worker["Worker e Durable Object (src/)"]
  end
  subgraph CS["GitHub Codespace"]
    Gateway["gateway :3000"]
    Spring["Spring :8081"]
    Nuxt["Nuxt :3001"]
  end
  Visitor["Visitante no navegador"]
  Apps --> CLI
  CLI -->|docker push| GHCR
  CLI -->|git push| Launcher
  CLI -->|wrangler deploy| Worker
  Visitor -->|HTTPS| Worker
  Worker -->|cria pela API do GitHub| CS
  Launcher -.->|devcontainer| CS
  GHCR -.->|imagem| CS
  Worker -->|encaminha| Gateway
  Gateway --> Spring
  Gateway --> Nuxt
```

1. **Sua máquina:** você roda o CLI no terminal local. Ele lê os commits das três aplicações e, quando precisa, o banco H2 e as mídias.
2. **GHCR:** o CLI constrói localmente uma imagem Docker com a receita (`recipe/`), o runtime (`runtime/`), as fontes exportadas e os dados congelados, e envia essa imagem ao seu pacote privado no GHCR.
3. **Lançador:** o CLI grava no seu repositório privado a configuração do Codespace e a entrada do catálogo.
4. **Cloudflare:** o CLI publica o Worker do lançador com `wrangler deploy`. O Worker atende o link e cada cenário tem um Durable Object que controla o ciclo de vida do Codespace.
5. **Codespace:** criado pelo Worker quando alguém abre o link. Dentro dele, o gateway na porta 3000 recebe todo o tráfego, envia `/api` para o Spring na porta 8081 e o resto para o Nuxt na porta 3001.
6. **Visitante:** só fala com o Worker por HTTPS. Ele nunca acessa o Codespace diretamente.

## O que acontece no `publish`

```mermaid
sequenceDiagram
  actor Op as Operador
  participant CLI as CLI local
  participant Apps as Aplicações e H2
  participant Docker as Docker local
  participant GHCR as GHCR
  participant L as Lançador
  participant W as Worker

  Op->>CLI: enois-preview publish cenario
  CLI->>CLI: lê config.json e confere a confirmação inicial
  opt existe restoration.json
    CLI->>Apps: restaura o backend ao estado anterior
  end
  CLI->>CLI: trava publication.lock
  CLI->>Apps: recusa árvore suja e lê os commits
  CLI->>CLI: confere install.json e toolCommit
  opt primeira vez ou refresh-data
    CLI->>Apps: para o backend, copia H2 e mídias, restaura
    CLI->>CLI: sanitiza e guarda em data/id
  end
  CLI->>Apps: exporta cada commit com git archive
  CLI->>CLI: calcula a revisão, congela as entradas e cria o journal
  CLI->>Docker: 1 buildAndValidate - build e boot local
  CLI->>L: 2 acquireRemoteLease - cria a ref de lease
  CLI->>GHCR: 3 registry - push e confirma o digest
  CLI->>L: 4 configuration - push de .devcontainer e proveniência
  CLI->>L: 5 catalog - push da entrada do catálogo
  CLI->>W: 6 deploy - build do lançador e wrangler deploy
  CLI->>W: 7 validatePublic - abre o link e confere tudo
  CLI->>L: 8 releaseRemoteLease - apaga a ref de lease
  alt sucesso
    CLI->>Op: JSON com status validated e url
  else falha numa etapa
    CLI->>CLI: grava failure.json
    CLI->>Op: mensagem com a revisão e o comando resume
  end
```

1. **Configuração:** o CLI lê `config.json` da sua instalação privada. Sem a confirmação inicial do `setup`, ele para aqui.
2. **Recuperação pendente:** se um comando anterior deixou `restoration.json`, o CLI primeiro devolve o backend ao estado registrado.
3. **Trava local:** `publication.lock` impede dois `publish` ou `resume` ao mesmo tempo no mesmo `state`.
4. **Árvore limpa:** se qualquer uma das três aplicações tiver mudanças staged, unstaged ou arquivos não rastreados, o CLI recusa sem parar nenhum serviço.
5. **Instalação verificada:** o CLI recalcula os hashes da instalação e confere se ela pertence ao `toolCommit` configurado.
6. **Captura:** só na primeira publicação do cenário ou com `--refresh-data`. O backend é parado só se estava rodando e volta ao estado anterior logo depois da cópia. Se nenhuma conta estiver configurada, o CLI pergunta no terminal quais IDs usar.
7. **Exportação:** cada aplicação é exportada do commit atual com `git archive`, fora dos seus checkouts.
8. **Congelamento:** o CLI calcula a revisão e, se ela ainda não existe, copia dados, fontes, receita, runtime, Worker e `dist` para `operations/<revisao>/frozen` e cria o journal.
9. **As oito etapas do publicador** (`Publisher` em `preview/remote.ts`), nesta ordem:
   1. `buildAndValidate`: constrói a imagem localmente e valida o boot num contêiner local.
   2. `acquireRemoteLease`: cria a ref `refs/heads/enois-preview-publication-lease` no lançador. Se outra operação a tem, espera até `leaseWaitSeconds`.
   3. `registry`: envia a imagem ao GHCR com a tag `preview-<revisao>` e passa a usá-la pelo digest.
   4. `configuration`: faz push de `.devcontainer/<slug>/` e da proveniência no lançador.
   5. `catalog`: faz push da nova entrada em `catalog/scenarios.json`.
   6. `deploy`: no checkout do lançador, roda `npm ci`, `npm run build`, `npm test`, `npm run check` e `wrangler deploy`.
   7. `validatePublic`: abre o link público e confere imagem, boot, saúde, contas, mídias e revisão.
   8. `releaseRemoteLease`: apaga a ref de lease.
10. **Resultado:** em caso de sucesso, o CLI imprime um JSON com `status: "validated"` e a `url`. Em caso de falha, grava `failure.json`, informa a etapa, a revisão completa e o comando `enois-preview resume <revisao>`.

O `resume` faz os passos 1, 2, 3 e 5 e pula a árvore limpa, a captura, a exportação e o congelamento (passos 4, 6, 7 e 8): lê o journal da revisão, confere os arquivos congelados e continua as oito etapas a partir do que já foi registrado. Ele nunca recaptura dados.

## O que acontece quando alguém abre o link

```mermaid
sequenceDiagram
  actor V as Visitante
  participant W as Worker
  participant DO as Durable Object
  participant GH as API do GitHub
  participant CS as Codespace

  V->>W: GET /preview/slug
  W->>DO: launch
  DO->>GH: cria o Codespace na menor máquina
  W->>V: página Preparando o cenário
  loop até ficar pronto
    V->>W: GET /__demo/status/slug
    W->>DO: status
  end
  CS->>CS: runtime/start - copia a semente e gera senhas novas
  CS->>CS: sobe Spring, Nuxt e gateway
  CS->>W: POST /__demo/register com o segredo de callback
  W->>DO: register
  DO->>CS: confere a saúde pela porta 3000
  DO->>DO: fase ready
  W->>V: página com contas e senhas
  V->>W: navega no app
  W->>CS: encaminha para o gateway
  V->>W: POST /__demo/activity ao interagir
  W->>DO: renova o prazo de 10 min
  Note over DO: dez minutos sem atividade
  DO->>GH: apaga o Codespace
```

1. **Abertura:** o visitante abre `/preview/<slug>`. O Worker confere se o slug está no catálogo e pede ao Durable Object daquele cenário para iniciar.
2. **Criação:** se não existe Codespace, o Durable Object cria um pela API do GitHub, na menor máquina disponível. Se o GitHub recusar, a página pede para tentar de novo em dez minutos.
3. **Espera:** o visitante vê "Preparando o cenário" e a página se atualiza sozinha consultando `/__demo/status/<slug>`.
4. **Boot:** no Codespace, `runtime/start.ts` copia a semente do banco e das mídias para `/tmp`, gera senhas novas para as contas selecionadas e sobe o Spring (porta 8081), o Nuxt (porta 3001) e o gateway (porta 3000).
5. **Registro:** `runtime/register-codespace.ts` chama `/__demo/register` com o segredo de callback, o nome do Codespace, o token da porta privada e as credenciais. O Durable Object confere dono, repositório, máquina e saúde do app antes de marcar a fase como pronta.
6. **Credenciais:** o visitante recebe a página com as contas e as senhas novas. As senhas aparecem só aí, nunca no relatório do CLI.
7. **Uso:** a partir daí, o Worker encaminha as requisições para o gateway do Codespace.
8. **Atividade:** o gateway injeta um script nas páginas HTML. Teclado, toque, roda do mouse e movimento do ponteiro numa aba visível enviam `/__demo/activity` no máximo a cada 15 segundos, e isso renova o prazo. A página de espera e a leitura de credenciais não renovam.
9. **Exclusão:** dez minutos depois da última atividade, o Durable Object apaga o Codespace. Quem abrir o link depois vê "O ambiente foi encerrado" e pode iniciar um novo, que volta à semente com senhas novas.
