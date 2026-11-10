# enois-preview

Ferramenta específica ao Énóis para publicar revisões imutáveis de desenvolvimento e teste por um Worker HTTPS e Codespaces privados. A publicação só informa sucesso após as verificações públicas. Consulte o resultado individual dos critérios em [VALIDATION.md](VALIDATION.md) antes de considerar uma revisão pronta para compartilhar.

[English](docs/en/README.md) · [Tutorial](docs/pt-BR/TUTORIAL.md) · [Guia para LLM](docs/pt-BR/LLM.md) · [Diagnóstico](docs/diagnostics/README.md)

Instale a ferramenta pelo instalador, no commit público completo fixado em `tool.lock.json` no lançador privado. O instalador baixa o arquivo desse commit no GitHub, compila fora dos seus checkouts em `~/.local/share/enois-preview/<COMMIT>`, grava em `install.json` os hashes da fonte e do `dist`, aponta `current` para essa instalação e liga o comando `enois-preview`. Publicação e retomada recalculam esses hashes e recusam, antes de qualquer efeito, uma instalação que difira do registro ou do `toolCommit`. Um checkout de desenvolvimento não publica, nem limpo no mesmo commit. A instalação é imutável: para outra versão, instale outro commit. Não execute `npm run` dentro dela, porque isso recompila o `dist`. Revisões congeladas pela 0.3.1 ou anteriores só são retomadas pelo executor original: um checkout limpo no commit delas, com `npm run build`.

```sh
git clone https://github.com/renanfranca/enois-preview.git /caminho/temporario/enois-preview
cd /caminho/temporario/enois-preview
git checkout --detach <COMMIT_PUBLICO_FIXADO>
npm ci --ignore-scripts
npm run build
node dist/scripts/install-tool.js --commit <COMMIT_PUBLICO_FIXADO>
cd ~/.local/share/enois-preview/current
npx --no-install playwright install chromium
node dist/example/prepare.js /caminho/novo/workspace-ficticio
enois-preview setup --config /caminho/novo/workspace-ficticio/.preview/config.json
enois-preview publish meu-cenario
enois-preview publish meu-cenario --refresh-data
enois-preview resume <revisao-completa>
enois-preview source-digest
```

Na versão 0.3.1, `Ctrl+C` (`SIGINT`) e `SIGTERM` cancelam comandos ativos e impedem novas etapas. O primeiro sinal determina a saída: `130` ou `143`, respectivamente. Aguarde a restauração do backend; sinais adicionais não a interrompem. Se ela falhar dentro dos prazos existentes, preserve `restoration.json`: a próxima execução de publicação ou retomada tenta a recuperação antes de avaliar fontes. Uma captura incompleta mantém os dados completos anteriores. Após congelar uma revisão, use o identificador informado com `enois-preview resume <revisao-completa>`; um push ou deploy aceito pode precisar de reconciliação, pois cancelar a espera local não desfaz o efeito remoto. Não remova leases de outra operação. `SIGKILL` depende da recuperação durável na próxima execução.

Na versão 0.3.4, `enois-preview source-digest` só lê: com o backend de origem parado e liberado, copia o banco H2 para um diretório privado e imprime em JSON o `databaseSha256`, o digest lógico `logicalSha256` (o `SCRIPT` do H2 sem as linhas `CREATE USER`, com sha256) e as contagens por tabela. Nunca inicia nem para o backend; recusa um backend em execução ou uma restauração pendente. Um `start`/`stop` reescreve o arquivo sem mudar os dados: compare o `logicalSha256`, não o hash do arquivo.

Esta versão usa TypeScript estrito e ESM. Depois de instalar, compile explicitamente; não depende de scripts de instalação. Para desenvolvimento, execute `npm ci --ignore-scripts`, `npm run build`, `npm run typecheck`, `npm test` e `npm run check`. O teste recompila a ferramenta antes de executar. Python não é requisito.

Configuração, dados, journals, proveniência e catálogo novos usam `format: "enois-preview-ts-v1"`. A instalação padrão fica em `~/.config/enois-preview-ts`. Registros antigos com `schema` ou sem esse `format` são recusados antes de alterações. Crie uma instalação e catálogo novos: não copie a confirmação nem converta journals Python. Arquivos antigos e histórico são preservados; não há promessa de retomada ou funcionamento dos links anteriores.

A preparação do exemplo cria cópias isoladas dos três projetos públicos nos commits de [example/sources.json](example/sources.json). Ela não usa o catálogo operacional, H2 ou imagens privadas. As quatro personagens são fictícias; os retratos são ilustrações vetoriais originais. A semente contém oito posts, três com imagens, seis comentários, duas respostas e oito reações. Lia e Rui são as contas selecionadas; as senhas são criadas no boot e aparecem somente na entrada do ambiente. Maya e Davi preservam perfil e conteúdo, com login desabilitado.

Configure suas próprias contas e infraestrutura privada antes de executar `setup`. A instalação usa Linux e precisa de Node 24.x (`>=24 <25`), Git, Java 25/Javac, Docker, `fuser`, `flock`, GitHub CLI e autenticação Cloudflare. O driver H2 deve corresponder ao banco configurado. A receita fornece `ffmpeg` e o modelo local de classificação de imagens na imagem, sem serviço externo de escrita de mídia.

O primeiro `publish` captura dados após fechar somente o backend identificado. Publicações seguintes usam os commits atuais e os dados congelados, sem ler ou parar o banco local. `--refresh-data` solicita outra captura; uma falha preserva a versão completa anterior. As fontes são exportadas por commit e o pacote do design system é construído novamente. A ferramenta não comita nem altera as três aplicações.

Os visitantes compartilham contas, dados e capacidade: 20 MiB por arquivo novo e 256 MiB por ambiente. As mídias da semente não gastam essa capacidade. O boot restaura a semente e gera novas senhas; alterações e uploads são descartáveis. Dez minutos sem interação reconhecida iniciam a exclusão. Polling não renova o prazo. Disponibilidade e franquias das plataformas limitam essa proteção; um link imutável não garante um ambiente permanentemente ativo.

A conferência de planos gratuitos e bloqueio de gastos ocorre somente na instalação. Publicar, retomar e abrir links não exigem renovação. A ferramenta não solicita cartão, contrata recursos nem ativa planos pagos. A confirmação humana não audita faturamento por API. Consulte [a cobrança do Codespaces](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces) e [os limites gratuitos de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).

Este é um uso temporário associado ao desenvolvimento e teste do projeto. Os [termos do Codespaces](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#codespaces) restringem uso desproporcional como servidor e hospedagem de aplicações de produção. O funcionamento técnico não demonstra aprovação desta arquitetura pelo GitHub.

Código sob [GPLv3](LICENSE), preservando os avisos dos projetos consumidos. Dados locais e credenciais devem permanecer fora do repositório público. Sanitizar autenticação não anonimiza o conteúdo escolhido pelo operador.
