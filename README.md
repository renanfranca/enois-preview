# enois-preview

Ferramenta de linha de comando que publica um link de preview para um pull request (PR), o pedido no GitHub para que outras pessoas avaliem uma mudança numa das aplicações do Énóis. O Énóis ([enois.ia.br](https://enois.ia.br)) é uma rede social gratuita, sem anúncios e sem fins lucrativos, construída junto com a comunidade. Quem abre o link recebe o app inteiro rodando, com dados realistas, num ambiente descartável.

[English](docs/en/README.md) · [Conceitos](docs/pt-BR/CONCEPTS.md) · [Fluxo](docs/pt-BR/FLOW.md) · [Receitas](docs/pt-BR/RECIPES.md) · [Tutorial](docs/pt-BR/TUTORIAL.md) · [Histórico](CHANGELOG.md)

## O problema

Num PR do Énóis, quem corrige um problema hoje prova a correção com prints e vídeos, muitas vezes um gravado no celular e outro no desktop. Quem avalia só vê o que foi gravado: não consegue seguir outro caminho, experimentar outro tamanho de tela nem abrir a mudança no próprio aparelho. E montar o backend, o frontend e o design system rodando juntos, com dados que pareçam reais, na máquina de quem avalia é lento e frágil.

Com um link de preview no PR, quem avalia abre a mudança rodando num ambiente real e analisa do jeito que preferir, inclusive no próprio celular. O link passa a ser a evidência principal da correção; um print pode acompanhá-lo, mas não o substitui. O que colar no PR e que dados usar estão em [Mostrar no PR que o problema foi resolvido](docs/pt-BR/RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido).

O enois-preview resolve isso para quem abre o PR (o operador). Você roda `enois-preview publish <cenario>` no seu terminal, onde o [cenário](docs/pt-BR/CONCEPTS.md#cenário) é um nome curto que você escolhe, e recebe um link HTTPS. Quando alguém abre o link, um GitHub Codespace, uma máquina de desenvolvimento na nuvem do GitHub, sobe sozinho com as três aplicações nos seus commits e com uma cópia dos seus dados [sanitizada](docs/pt-BR/CONCEPTS.md#dados-congelados-e-captura), sem sessões, tokens nem senhas. Depois de dez minutos sem uso, o ambiente é apagado.

Em resumo:
- **No `publish`:** a ferramenta confere que as fontes estão comitadas, copia os dados só quando precisa, congela tudo numa [revisão](docs/pt-BR/CONCEPTS.md#revisão) imutável, constrói a imagem Docker do app, grava a configuração no seu [lançador](docs/pt-BR/CONCEPTS.md#lançador) (um repositório privado seu no GitHub), publica o [Worker](docs/pt-BR/CONCEPTS.md#worker-durable-object-e-codespace) (o programa da Cloudflare que atende o link) e só informa sucesso depois de abrir o link e conferir o resultado.
- **Na visita:** o Worker cria o Codespace, mostra as contas e senhas geradas no boot e encaminha a navegação até o app.

O passo a passo de cada lado está no Fluxo: [o que acontece no `publish`](docs/pt-BR/FLOW.md#o-que-acontece-no-publish) e [o que acontece quando alguém abre o link](docs/pt-BR/FLOW.md#o-que-acontece-quando-alguém-abre-o-link).

## Onde roda o quê

O [CLI](docs/pt-BR/CONCEPTS.md#cli), o comando `enois-preview`, roda na sua máquina, onde também ficam as três aplicações e o [banco H2](docs/pt-BR/CONCEPTS.md#as-três-aplicações) local. No `publish`, ele envia a imagem a um pacote privado seu no GHCR (o registro de imagens Docker do GitHub), grava a configuração no lançador e publica o Worker na Cloudflare. Quem abre o link, o [visitante](docs/pt-BR/CONCEPTS.md#operador-e-visitante), fala só com o Worker, que cria o Codespace a partir dessa imagem e dessa configuração. Dentro do Codespace, um gateway encaminha a navegação para o backend e o frontend.

**[Veja o diagrama e o que cada parte faz em Fluxo](docs/pt-BR/FLOW.md#onde-roda-o-quê)**

## Comandos

| Comando | Para que serve | Receita |
| --- | --- | --- |
| `enois-preview setup --config <arquivo>` | Confere a infraestrutura existente e registra a confirmação inicial dos planos gratuitos | [Instalar](docs/pt-BR/RECIPES.md#1-instalar-ou-trocar-a-ferramenta-para-outro-commit-fixado) · [Meus dados](docs/pt-BR/RECIPES.md#8-usar-meus-próprios-dados) |
| `enois-preview publish <cenario>` | Publica os commits atuais com os dados congelados do cenário | [Código novo](docs/pt-BR/RECIPES.md#3-publicar-de-novo-só-com-código-novo) |
| `enois-preview publish <cenario> --refresh-data` | Captura dados novos e publica | [Dados novos](docs/pt-BR/RECIPES.md#4-publicar-com-dados-novos) |
| `enois-preview resume <revisao-completa>` | Continua uma publicação que falhou, sem recapturar dados | [Retomar](docs/pt-BR/RECIPES.md#5-retomar-uma-publicação-que-falhou) |
| `enois-preview install <commit-completo>` | Instala outro commit público verificado e aponta o comando para ele | [Instalar](docs/pt-BR/RECIPES.md#1-instalar-ou-trocar-a-ferramenta-para-outro-commit-fixado) |
| `enois-preview source-digest` | Só lê: informa o digest lógico do banco de origem parado | [Conferir o banco](docs/pt-BR/RECIPES.md#7-conferir-se-o-banco-mudou) |

`enois-preview --help` mostra o resumo. Todos aceitam `--home <diretorio>` para usar outra instalação privada.

## Requisitos

- Linux com Node 24.x (`>=24 <25`); o `.nvmrc` seleciona a família 24.
- Git, Java 25 e Javac, Docker, `fuser`, `flock` e GitHub CLI.
- Autenticação no GitHub, no GHCR e na Cloudflare.
- Sua própria infraestrutura privada: um repositório lançador privado, um pacote GHCR privado e um Worker da Cloudflare. Para criá-la, siga o [diagnóstico de instalação](docs/diagnostics/installation.pt-BR.md).
- O driver H2 deve corresponder ao banco configurado. A receita da imagem já traz `ffmpeg` e o modelo local de classificação de imagens; uploads novos não usam serviço externo de escrita de mídia.
- Python não é requisito.

Para alterar a própria ferramenta, veja [Desenvolver a ferramenta](#desenvolver-a-ferramenta).

## Instalação

Instale com um comando, no commit público completo fixado em `tool.lock.json` no lançador privado:

```sh
COMMIT=<COMMIT_PUBLICO_FIXADO>
curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
```

O `install.sh` vem do próprio commit fixado e só prepara o instalador num diretório temporário, apagado no fim. O instalador baixa esse commit do GitHub, compila fora dos seus checkouts em `~/.local/share/enois-preview/<COMMIT>`, grava em `install.json` os hashes da fonte e do `dist`, aponta `current` para essa instalação, liga o comando `enois-preview` e instala o Chromium usado na validação pública. Ele precisa de Node 24.x, npm, `curl` e `tar`.

Para trocar depois para outro commit fixado, a própria ferramenta instala:

```sh
enois-preview install <OUTRO_COMMIT_PUBLICO_FIXADO>
```

Com a ferramenta instalada, a primeira publicação com o exemplo fictício é:

```sh
node ~/.local/share/enois-preview/current/dist/example/prepare.js /caminho/novo/workspace-ficticio
enois-preview setup --config /caminho/novo/workspace-ficticio/.preview/config.json
enois-preview publish meu-cenario
```

Atenção:
- `publish` e `resume` recalculam os hashes e recusam, antes de qualquer efeito, uma instalação que difira do registro ou do [`toolCommit`](docs/pt-BR/CONCEPTS.md#toolcommit-e-installjson).
- O `install.sh` existe a partir da 0.3.9. Para instalar um commit anterior, siga o [caminho manual](docs/pt-BR/RECIPES.md#1-instalar-ou-trocar-a-ferramenta-para-outro-commit-fixado).
- A instalação é imutável: para outra versão, instale outro commit. Não execute `npm run` dentro dela, porque isso recompila o `dist`.
- Um checkout de desenvolvimento não publica, nem limpo no mesmo commit.
- Revisões congeladas pela 0.3.1 ou anteriores só são retomadas pelo executor original: um checkout limpo no commit delas, com `npm run build`.
- Configuração, dados, [journals](docs/pt-BR/CONCEPTS.md#journal), proveniência e catálogo usam `format: "enois-preview-ts-v1"`. A instalação privada padrão fica em `~/.config/enois-preview-ts`. Registros antigos com `schema` ou sem esse `format` são recusados antes de alterações: crie uma instalação e um catálogo novos, sem copiar a confirmação nem converter journals Python. Arquivos antigos e histórico são preservados, sem promessa de retomada ou de funcionamento dos links anteriores.

A primeira publicação, com dados fictícios, está no [tutorial](docs/pt-BR/TUTORIAL.md).

## Mapa da documentação

| Documento | Quando ler |
| --- | --- |
| [Conceitos](docs/pt-BR/CONCEPTS.md) | Antes de tudo: revisão, captura, lançador, journal, lease |
| [Fluxo](docs/pt-BR/FLOW.md) | Para entender o que acontece no `publish` e na visita |
| [Tutorial](docs/pt-BR/TUTORIAL.md) | Na primeira publicação, com o exemplo fictício |
| [Receitas](docs/pt-BR/RECIPES.md) | No dia a dia: publicar de novo, refresh, retomar, interrupções, erros |
| [Diagnóstico](docs/diagnostics/README.md) | Para preparar a infraestrutura ou investigar uma falha |
| [Guia para LLM](docs/pt-BR/LLM.md) | Se um assistente for ajudar você a operar |
| [Histórico de versões](CHANGELOG.md) | Para saber o que mudou em cada versão |

## Limites e custos

- A ferramenta não comita nem altera as três aplicações. Ela recusa fontes com mudanças staged, unstaged ou arquivos não rastreados.
- O código vem sempre dos commits atuais e os dados ficam congelados desde a última captura do cenário, que só lê o banco local na primeira publicação ou com `--refresh-data`. Os detalhes estão em [Código vs dados](docs/pt-BR/CONCEPTS.md#código-vs-dados).
- Os visitantes compartilham contas, dados e capacidade de upload, e o ambiente é apagado depois de dez minutos sem interação. Num PR público, o link também é público, e todo o conteúdo dos dados capturados fica visível. Os limites exatos e que dados usar estão em [Mostrar no PR que o problema foi resolvido](docs/pt-BR/RECIPES.md#9-mostrar-no-pr-que-o-problema-foi-resolvido).
- A conferência dos planos gratuitos e do bloqueio de gastos ocorre somente no `setup`. Publicar, retomar e abrir links não exigem renovação. A ferramenta não solicita cartão, não contrata recursos e não ativa planos pagos. A confirmação humana não audita faturamento por API. Consulte [a cobrança do Codespaces](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) e [os limites gratuitos de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- Este é um uso temporário associado ao desenvolvimento e teste do projeto. Os [termos do Codespaces](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#codespaces) restringem uso desproporcional como servidor e hospedagem de aplicações de produção. O funcionamento técnico não demonstra aprovação desta arquitetura pelo GitHub.

## Para auditar

A publicação só informa sucesso após as verificações públicas. O resultado individual de cada critério de aceite, com as evidências por versão, está em [VALIDATION.md](VALIDATION.md); consulte esse arquivo antes de considerar uma revisão pronta para compartilhar. Para falhas e recuperação, veja o [diagnóstico](docs/diagnostics/README.md).

## Desenvolver a ferramenta

A ferramenta usa TypeScript estrito e ESM, compilado explicitamente. Para desenvolvimento, use `npm ci --ignore-scripts`, `npm run build`, `npm run typecheck`, `npm test` e `npm run check`. O teste recompila antes de executar.

## Licença

Código sob [GPLv3](LICENSE), preservando os avisos dos projetos consumidos. Dados locais e credenciais devem permanecer fora do repositório público. Sanitizar autenticação não anonimiza o conteúdo escolhido pelo operador.
