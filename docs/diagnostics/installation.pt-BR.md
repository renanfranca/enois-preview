# Preparar a infraestrutura privada do operador

Use Node 24.x (`>=24 <25`); o arquivo `.nvmrc` seleciona a família 24 com `nvm install` e `nvm use`. Node 22 não é mais uma versão qualificada. A atualização para 0.3.0 preserva catálogos, links e registros históricos; a retomada de operações anteriores exige seu executor original e não é validada por esta atualização. Novas publicações e retomadas devem usar uma instalação verificada do SHA fixado, criada pelo `install-tool`.

Este procedimento único de infraestrutura complementa o [tutorial canônico](../pt-BR/TUTORIAL.md). A validação pública desta versão TypeScript está registrada em VALIDATION.md. A criação de outra conta nas plataformas não foi exercitada; consulte [o escopo da validação](../../VALIDATION.md). Use o terminal local e suas próprias contas. Mantenha os planos gratuitos com gastos bloqueados; o setup lembra disso com o aviso `free-plan` e não pede confirmação. Não adicione forma de pagamento nem ative serviços pagos.

Comece por um commit público publicado da ferramenta. Substitua os nomes e o SHA completo antes de executar:

```sh
COMMIT=COMMIT_PUBLICO_DA_FERRAMENTA
curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
gh auth login
gh auth setup-git
(cd ~/.local/share/enois-preview/current && npx --no-install wrangler login)
node ~/.local/share/enois-preview/current/dist/scripts/prepare-launcher.js /caminho/novo/lancador-privado --repository SEU_USUARIO/SEU_LANCADOR_PRIVADO --tool-commit COMMIT_PUBLICO_DA_FERRAMENTA --worker-name NOME_DO_SEU_WORKER
```

O gerador cria um catálogo privado vazio e um Worker que importa o pacote público fixado. Ele não cria contas, repositórios, segredos, imagens ou Workers. O instalador compila o commit em `~/.local/share/enois-preview/COMMIT_PUBLICO_DA_FERRAMENTA`, grava em `install.json` os hashes da fonte e do `dist` e liga `enois-preview` a partir de `~/.local/share/enois-preview/current`; publicação e retomada registram se a instalação ainda corresponde a esse registro e mostram o aviso `unverified-tool` quando não corresponde. O `install.sh` vem do próprio commit e só prepara o instalador num diretório temporário; o instalador também instala o Chromium da validação pública. Para um commit anterior à 0.3.9, use o [caminho manual](../pt-BR/RECIPES.md#1-instalar-ou-trocar-a-ferramenta-para-outro-commit-fixado). O gerador e o `wrangler` rodam a partir da instalação.

No diretório do lançador gerado, execute `npm install --package-lock-only --ignore-scripts`, `npm ci --ignore-scripts`, `npm run build`, `npm test` e `npm run check`. Revise `package.json`, `package-lock.json`, `tool.lock.json`, `launcher.ts` e `wrangler.jsonc`. Crie seu repositório privado com `gh repo create SEU_USUARIO/SEU_LANCADOR_PRIVADO --private`. Inicialize o Git local, comite os arquivos revisados na branch de publicação escolhida e envie essa branch. Confirme que `gh repo view SEU_USUARIO/SEU_LANCADOR_PRIVADO --json isPrivate` informa true. Não adicione capturas de trabalho nem bancos.

Execute `npx wrangler deploy` nesse lançador com `LAUNCH_ENABLED` ainda false. Anote a origem HTTPS estável e o Account ID de `npx wrangler whoami`. Isso reserva o endereço sem iniciar Codespaces. A configuração de desenvolvimento da ferramenta pública é desabilitada; não faça deploy pelo checkout público.

Autentique o Docker no GHCR com um token clássico de escopo `write:packages`, usando seu gerenciador de credenciais ou `docker login ghcr.io --username SEU_USUARIO --password-stdin`; nunca passe o token como argumento. O pacote de destino precisa existir antes da verificação do setup. Para reservá-lo, crie um diretório vazio com somente um `Dockerfile` contendo `FROM scratch`, construa com o nome do registro privado e a tag `bootstrap`, e envie essa tag. A primeira publicação tem visibilidade privada por padrão; confira Private nas configurações e conceda ao lançador **Manage Codespaces access**. Não torne o pacote público. [Autenticação e visibilidade no GitHub](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [acesso dos Codespaces](https://docs.github.com/en/codespaces/reference/allowing-your-codespace-to-access-a-private-registry).

Crie um token GitHub fine-grained restrito a esse lançador, com Contents read, Codespaces read/write e Codespaces metadata read. Cadastre somente no Worker por `npx wrangler secret put GITHUB_TOKEN`. Essas permissões atendem aos [endpoints de Codespaces](https://docs.github.com/en/rest/codespaces/codespaces) e à [consulta de máquinas](https://docs.github.com/en/rest/codespaces/machines). Não reutilize o token de publicação do registro como token de gerenciamento do Worker.

Gere um segredo exclusivo de callback e guarde no gerenciador de senhas. Cadastre `CALLBACK_SECRET` no Worker com `npx wrangler secret put CALLBACK_SECRET`. Nos segredos de Codespaces da conta GitHub, conceda somente a esse lançador acesso a `DEMO_CALLBACK_SECRET` com o mesmo valor, `DEMO_WORKER_URL` com a origem HTTPS e `REDE_SECURITY_ENCRYPTION_KEY` com 32 bytes aleatórios em Base64 padrão. Ao reutilizar instalação, preserve os segredos existentes. O GitHub fornece seu próprio token de execução e as variáveis de encaminhamento. [Gerenciar segredos de Codespaces](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces).

Altere somente `LAUNCH_ENABLED` para true na configuração do lançador privado, revise e envie esse ajuste inicial. Preencha a configuração privada do cenário com repositório, branch, registro, origem e Account ID. Execute `enois-preview setup --config JSON_PRIVADO` localmente e siga o tutorial. O setup valida a infraestrutura existente; a publicação controla imagem, configuração, catálogo e deploy. Após uma falha de publicação, use `resume` para concluir esses estágios.

Esta versão recusa registros Python e removeu `--legacy-verification`. Preserve arquivos e commits anteriores, comece com configuração e catálogo novos no formato `enois-preview-ts-v1` e rode o `setup` desta instalação. Não sobrescreva segredos existentes.

O build do lançador compila a dependência e executa `npm rebuild --ignore-scripts enois-preview` para criar o atalho npm do CLI após a compilação. Os scripts de instalação permanecem desativados.
