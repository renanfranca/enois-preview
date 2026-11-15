# enois-preview

Ferramenta de linha de comando que publica um link de preview para um pull request (PR), o pedido no GitHub para que outras pessoas avaliem uma mudança numa das aplicações do Énóis. O Énóis ([enois.ia.br](https://enois.ia.br)) é uma rede social gratuita, sem anúncios e sem fins lucrativos, construída junto com a comunidade. Quem abre o link recebe o app inteiro rodando, com dados realistas, num ambiente descartável.

[English](docs/en/README.md) · [Conceitos](docs/pt-BR/CONCEPTS.md) · [Fluxo](docs/pt-BR/FLOW.md) · [Receitas](docs/pt-BR/RECIPES.md) · [Tutorial](docs/pt-BR/TUTORIAL.md) · [Releases](https://github.com/renanfranca/enois-preview/releases)

## O problema

Num PR do Énóis, quem corrige um problema hoje prova a correção com prints e vídeos, muitas vezes um gravado no celular e outro no desktop. Quem avalia só vê o que foi gravado: não consegue seguir outro caminho, experimentar outro tamanho de tela nem abrir a mudança no próprio aparelho. E montar o backend, o frontend e o design system rodando juntos, com dados que pareçam reais, na máquina de quem avalia é lento e frágil.

Com um link de preview no PR, quem avalia abre a mudança rodando num ambiente real e analisa do jeito que preferir, inclusive no próprio celular. O link passa a ser a evidência principal da correção; um print pode acompanhá-lo, mas não o substitui. O que colar no PR e que dados usar estão em [Mostrar no PR que o problema foi resolvido](docs/pt-BR/RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido).

O enois-preview resolve isso para quem abre o PR (o operador). Você roda `enois-preview publish <cenario>` no seu terminal, onde o [cenário](docs/pt-BR/CONCEPTS.md#cenário) é um nome curto que você escolhe, e recebe um link HTTPS. Quando alguém abre o link, um GitHub Codespace, uma máquina de desenvolvimento na nuvem do GitHub, sobe sozinho com as três aplicações nos seus commits e com uma cópia dos seus dados [sanitizada](docs/pt-BR/CONCEPTS.md#dados-congelados-e-captura), sem sessões, tokens nem senhas. Depois de dez minutos sem uso, o ambiente é apagado.

Em resumo:

- **No `publish`:** a ferramenta usa o `HEAD` comitado de cada aplicação, copia os dados só quando precisa, congela tudo numa [revisão](docs/pt-BR/CONCEPTS.md#revisão) imutável, constrói a imagem Docker do app, grava a configuração no seu [lançador](docs/pt-BR/CONCEPTS.md#lançador) (um repositório privado seu no GitHub), publica o [Worker](docs/pt-BR/CONCEPTS.md#worker-durable-object-e-codespace) (o programa da Cloudflare que atende o link) e só informa sucesso depois de abrir o link e conferir que o app está no ar, roda a revisão esperada e deixa as contas selecionadas entrarem.
- **Na visita:** o Worker cria o Codespace, mostra as contas e senhas geradas no boot e encaminha a navegação até o app.

O passo a passo de cada lado está no Fluxo: [o que acontece no `publish`](docs/pt-BR/FLOW.md#o-que-acontece-no-publish) e [o que acontece quando alguém abre o link](docs/pt-BR/FLOW.md#o-que-acontece-quando-alguém-abre-o-link).

## Onde roda o quê

O [CLI](docs/pt-BR/CONCEPTS.md#cli), o comando `enois-preview`, roda na sua máquina, onde também ficam as três aplicações e o [banco H2](docs/pt-BR/CONCEPTS.md#as-três-aplicações) local. No `publish`, ele envia a imagem a um pacote privado seu no GHCR (o registro de imagens Docker do GitHub), grava a configuração no lançador e publica o Worker na Cloudflare. Quem abre o link, o [visitante](docs/pt-BR/CONCEPTS.md#operador-e-visitante), fala só com o Worker, que cria o Codespace a partir dessa imagem e dessa configuração. Dentro do Codespace, um gateway encaminha a navegação para o backend e o frontend.

**[Veja o diagrama e o que cada parte faz em Fluxo](docs/pt-BR/FLOW.md#onde-roda-o-quê)**

## Comandos

| Comando                                                 | Para que serve                                                                 | Receita                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `enois-preview setup`                                   | Cria ou confere a sua infraestrutura: lançador, Worker e segredos              | [Instalar e configurar](docs/pt-BR/RECIPES.md#1-instalar-ou-atualizar-a-ferramenta) |
| `enois-preview setup --config <arquivo>`                | Também valida e grava a configuração do workspace                              | [Meus dados](docs/pt-BR/RECIPES.md#8-usar-meus-próprios-dados)                      |
| `enois-preview publish <cenario>`                       | Publica os commits atuais com os dados congelados do cenário                   | [Código novo](docs/pt-BR/RECIPES.md#3-publicar-de-novo-só-com-código-novo)          |
| `enois-preview publish <cenario> --refresh-data`        | Captura dados novos e publica                                                  | [Dados novos](docs/pt-BR/RECIPES.md#4-publicar-com-dados-novos)                     |
| `enois-preview publish <cenario> --accounts ID[,ID...]` | Escolhe as contas dos visitantes sem pergunta no terminal                      | [Meus dados](docs/pt-BR/RECIPES.md#8-usar-meus-próprios-dados)                      |
| `... --force-lease` (no `publish` ou no `resume`)       | Remove o lease remoto de outra operação e continua                             | [Lease](docs/pt-BR/CONCEPTS.md#lease)                                               |
| `enois-preview resume <revisao-completa>`               | Continua uma publicação que falhou, sem recapturar dados                       | [Retomar](docs/pt-BR/RECIPES.md#5-retomar-uma-publicação-que-falhou)                |
| `enois-preview source-digest`                           | Só lê: informa o digest lógico do banco de origem, mesmo com o backend rodando | [Conferir o banco](docs/pt-BR/RECIPES.md#7-conferir-se-o-banco-mudou)               |

`enois-preview --help` mostra o resumo e `enois-preview --version` mostra a versão em execução. Todos aceitam `--home <diretorio>` para usar outro diretório de workspace.

`setup`, `publish`, `resume` e `source-digest` terminam com um JSON que sempre traz `warnings: [{code, message}]`. Um aviso nunca para a operação; quando observado, também sai no stderr como `warning: <mensagem>`. Só três coisas param uma operação: a aplicação não compila ou não roda, a ferramenta não consegue identificar a revisão que construiu e publicou, ou uma conta selecionada não consegue entrar.

## Requisitos

- Linux com Node 24.x (`>=24 <25`); o `.nvmrc` seleciona a família 24.
- Git, Java 25 e Javac, Docker, `flock` e GitHub CLI. O `fuser` é opcional: quando existe, ajuda a avisar que o banco está em uso.
- Uma conta no GitHub e uma na Cloudflare. O `setup` confere os logins do GitHub CLI, do Docker no GHCR e do `wrangler` e oferece cada correção.
- Sua própria infraestrutura privada: um repositório lançador privado, um Worker da Cloudflare e cinco segredos. O `setup` cria o que faltar nas suas contas; o pacote GHCR nasce no primeiro `publish`. Os detalhes estão no [diagnóstico de instalação](docs/diagnostics/installation.pt-BR.md).
- O driver H2 deve corresponder ao banco configurado. A receita da imagem já traz `ffmpeg` e o modelo local de classificação de imagens; uploads novos não usam serviço externo de escrita de mídia.
- Python não é requisito.

Para alterar a própria ferramenta, veja [Desenvolver a ferramenta](#desenvolver-a-ferramenta).

## Instalação

Instale a ferramenta pelo npm e rode o setup guiado:

```sh
npm install -g enois-preview
enois-preview setup
```

O `setup` confere ferramentas e logins, mostra no stderr um plano com uma linha por recurso (`exists`, `create` ou `update`) e só escreve depois da sua confirmação. Ele cria o lançador privado, publica o Worker, grava os segredos (o `GITHUB_TOKEN` é um token que você cria e cola num prompt oculto), ativa o lançador, instala o Chromium da validação pública e grava `~/.config/enois-preview-ts/infrastructure.json`. Rodar de novo não escreve nada quando tudo já existe. As flags, os padrões e os casos em que ele para estão no [diagnóstico de instalação](docs/diagnostics/installation.pt-BR.md).

Com a infraestrutura pronta, a primeira publicação com o exemplo fictício é:

```sh
node "$(npm root -g)/enois-preview/dist/example/prepare.js" ~/workspace-ficticio
enois-preview setup --config ~/workspace-ficticio/.preview/config.json
enois-preview publish meu-cenario
```

Atenção:

- A configuração tem duas partes. A infraestrutura (`repository`, `branch`, `registry`, `worker`, `origin` e `cloudflareAccountId`) fica uma vez por operador em `infrastructure.json`, com modo `0600` e sem segredos; a variável `ENOIS_PREVIEW_INFRASTRUCTURE` troca esse caminho. O workspace (aplicações, banco, H2 e scripts) fica em `<home>/config.json`. Sem `infrastructure.json`, `publish`, `resume` e `source-digest` param com `Infrastructure missing. Run enois-preview setup first.`. Um campo do workspace que o contrato não define, inclusive um campo de infraestrutura, gera o aviso `ignored-config-fields`.
- `publish` e `resume` registram a versão em execução como `toolVersion` no journal e no resultado. Quando o lançador depende de outra versão do `enois-preview`, o `publish` refixa a dependência num commit da própria ferramenta, dentro do lease e antes do deploy. Para atualizar, rode `npm install -g enois-preview@<versão>`.
- Revisões criadas antes da distribuição pelo npm (0.4.0 ou anteriores) não são retomadas: o `resume` para e pede um `publish` novo. Um lançador da 0.4.0 (com `tool.lock.json` e dependência por `codeload`) não é migrado: escolha um `--launcher` novo no `setup`.
- Saíram com a distribuição pelo npm: o `install.sh`, o comando `enois-preview install`, o `install.json`, o script `prepare-launcher`, o `tool.lock.json` nos lançadores e os avisos `unverified-tool` e `launcher-pin`. A instalação é pelo npm, e o `setup` gera o lançador.
- Configuração, dados, [journals](docs/pt-BR/CONCEPTS.md#journal), proveniência e catálogo usam `format: "enois-preview-ts-v1"`. O diretório padrão do workspace é `~/.config/enois-preview-ts`.

A primeira publicação, com dados fictícios, está no [tutorial](docs/pt-BR/TUTORIAL.md).

## Mapa da documentação

| Documento                                                         | Quando ler                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [Conceitos](docs/pt-BR/CONCEPTS.md)                               | Antes de tudo: revisão, captura, lançador, journal, lease                         |
| [Fluxo](docs/pt-BR/FLOW.md)                                       | Para entender o que acontece no `publish` e na visita                             |
| [Tutorial](docs/pt-BR/TUTORIAL.md)                                | Na primeira publicação, com o exemplo fictício                                    |
| [Receitas](docs/pt-BR/RECIPES.md)                                 | No dia a dia: publicar de novo, refresh, retomar, interrupções, erros             |
| [Diagnóstico](docs/diagnostics/README.md)                         | Para preparar a infraestrutura ou investigar uma falha                            |
| [Guia para LLM](docs/pt-BR/LLM.md)                                | Se um assistente for ajudar você a operar                                         |
| [Releases](https://github.com/renanfranca/enois-preview/releases) | Para saber o que mudou em cada versão (até a 0.4.0, no [histórico](CHANGELOG.md)) |
| [Releases e CI](docs/pt-BR/RELEASING.md)                          | Se você mantém a ferramenta: commits, versões, release e recuperação              |

## Limites e custos

- A ferramenta não comita nem altera as três aplicações. Ela publica só o `HEAD` comitado; mudanças staged, unstaged ou arquivos não rastreados geram o aviso `source-dirty` e ficam de fora.
- O código vem sempre dos commits atuais e os dados ficam congelados desde a última captura do cenário, que só lê o banco local na primeira publicação ou com `--refresh-data`. Os detalhes estão em [Código vs dados](docs/pt-BR/CONCEPTS.md#código-vs-dados).
- Os visitantes compartilham contas, dados e o disco do Codespace, e um visitante pode trocar a senha de uma conta compartilhada até o ambiente ser reciclado. Cada arquivo enviado tem limite de 100 MB. O ambiente é apagado depois de dez minutos sem interação. Num PR público, o link também é público, e todo o conteúdo dos dados capturados fica visível. Os limites exatos e que dados usar estão em [Mostrar no PR que o problema foi resolvido](docs/pt-BR/RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido).
- O `setup` mostra o aviso `free-plan` sobre os planos gratuitos e o bloqueio de gastos; ele não pede confirmação e não audita faturamento por API. A ferramenta não solicita cartão, não contrata recursos e não ativa planos pagos. Consulte [a cobrança do Codespaces](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) e [os limites gratuitos de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- Este é um uso temporário associado ao desenvolvimento e teste do projeto. Os [termos do Codespaces](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#codespaces) restringem uso desproporcional como servidor e hospedagem de aplicações de produção. O funcionamento técnico não demonstra aprovação desta arquitetura pelo GitHub.

## Para auditar

A publicação só informa sucesso depois que passam os portões públicos: prontidão, identidade da revisão e login de cada conta selecionada. As conferências de mídia, decodificação, permissões, cookies e inventário da imagem continuam rodando e aparecem como avisos. O resultado individual de cada critério de aceite, com as evidências por versão, está em [VALIDATION.md](VALIDATION.md); consulte esse arquivo antes de considerar uma revisão pronta para compartilhar. Para falhas e recuperação, veja o [diagnóstico](docs/diagnostics/README.md).

## Desenvolver a ferramenta

A ferramenta usa TypeScript estrito e ESM, compilado explicitamente. Para desenvolvimento, use `npm ci`, `npm run build`, `npm run typecheck`, `npm test` e `npm run check`; o teste recompila antes de executar. O código segue o Prettier (`npm run prettier:check`, e um hook de pre-commit formata os arquivos alterados). Um checkout de desenvolvimento roda como `0.0.0-SNAPSHOT` e não cria nem refixa lançadores, porque essa versão não existe no npm. Commits seguem Conventional Commits; o CI e a release estão em [Releases e CI](docs/pt-BR/RELEASING.md).

## Licença

Código sob [GPLv3](LICENSE), preservando os avisos dos projetos consumidos. Dados locais e credenciais devem permanecer fora do repositório público. Sanitizar autenticação não anonimiza o conteúdo escolhido pelo operador.
