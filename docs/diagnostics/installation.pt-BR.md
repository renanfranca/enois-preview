# Preparar a infraestrutura privada do operador

Este procedimento único de infraestrutura complementa o [tutorial canônico](../pt-BR/TUTORIAL.md). Os dois roteiros canônicos foram concluídos com infraestrutura existente e conferida. A criação de outra conta nas plataformas não foi exercitada; consulte [o escopo da validação](../../VALIDATION.md). Use o terminal local e suas próprias contas. Preserve a conferência inicial dos planos gratuitos e do bloqueio de gastos; o setup registra essa confirmação sem renovação. Não adicione forma de pagamento nem ative serviços pagos.

Comece por um commit público publicado da ferramenta. Substitua os nomes e o SHA completo antes de executar:

```sh
git clone https://github.com/renanfranca/enois-preview.git
cd enois-preview
git checkout COMMIT_PUBLICO_DA_FERRAMENTA
npm ci
npx playwright install chromium
npm link
gh auth login
gh auth setup-git
npx wrangler login
python3 scripts/prepare-launcher.py /caminho/novo/lancador-privado --repository SEU_USUARIO/SEU_LANCADOR_PRIVADO --tool-commit COMMIT_PUBLICO_DA_FERRAMENTA --worker-name NOME_DO_SEU_WORKER
```

O gerador cria um catálogo privado vazio e um Worker que importa o pacote público fixado. Ele não cria contas, repositórios, segredos, imagens ou Workers. Mantenha o checkout público limpo. Preencha `toolCommit` na configuração privada do exemplo com o mesmo SHA.

No diretório do lançador gerado, execute `npm install --ignore-scripts`, `npm test` e `npm run check`. Revise `package.json`, `package-lock.json`, `tool.lock.json`, `launcher.mjs` e `wrangler.jsonc`. Crie seu repositório privado com `gh repo create SEU_USUARIO/SEU_LANCADOR_PRIVADO --private`. Inicialize o Git local, comite os arquivos revisados na branch de publicação escolhida e envie essa branch. Confirme que `gh repo view SEU_USUARIO/SEU_LANCADOR_PRIVADO --json isPrivate` informa true. Não adicione capturas de trabalho nem bancos.

Execute `npx wrangler deploy` nesse lançador com `LAUNCH_ENABLED` ainda false. Anote a origem HTTPS estável e o Account ID de `npx wrangler whoami`. Isso reserva o endereço sem iniciar Codespaces. A configuração de desenvolvimento da ferramenta pública é desabilitada; não faça deploy pelo checkout público.

Autentique o Docker no GHCR com um token clássico de escopo `write:packages`, usando seu gerenciador de credenciais ou `docker login ghcr.io --username SEU_USUARIO --password-stdin`; nunca passe o token como argumento. O pacote de destino precisa existir antes da verificação do setup. Para reservá-lo, crie um diretório vazio com somente um `Dockerfile` contendo `FROM scratch`, construa com o nome do registro privado e a tag `bootstrap`, e envie essa tag. A primeira publicação tem visibilidade privada por padrão; confira Private nas configurações e conceda ao lançador **Manage Codespaces access**. Não torne o pacote público. [Autenticação e visibilidade no GitHub](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry), [acesso dos Codespaces](https://docs.github.com/en/codespaces/reference/allowing-your-codespace-to-access-a-private-registry).

Crie um token GitHub fine-grained restrito a esse lançador, com Contents read, Codespaces read/write e Codespaces metadata read. Cadastre somente no Worker por `npx wrangler secret put GITHUB_TOKEN`. Essas permissões atendem aos [endpoints de Codespaces](https://docs.github.com/en/rest/codespaces/codespaces) e à [consulta de máquinas](https://docs.github.com/en/rest/codespaces/machines). Não reutilize o token de publicação do registro como token de gerenciamento do Worker.

Gere um segredo exclusivo de callback e guarde no gerenciador de senhas. Cadastre `CALLBACK_SECRET` no Worker com `npx wrangler secret put CALLBACK_SECRET`. Nos segredos de Codespaces da conta GitHub, conceda somente a esse lançador acesso a `DEMO_CALLBACK_SECRET` com o mesmo valor, `DEMO_WORKER_URL` com a origem HTTPS e `REDE_SECURITY_ENCRYPTION_KEY` com 32 bytes aleatórios em Base64 padrão. Ao reutilizar instalação, preserve os segredos existentes. O GitHub fornece seu próprio token de execução e as variáveis de encaminhamento. [Gerenciar segredos de Codespaces](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces).

Altere somente `LAUNCH_ENABLED` para true na configuração do lançador privado, revise e envie esse ajuste inicial. Preencha a configuração privada do cenário com repositório, branch, registro, origem, Account ID e commit da ferramenta. Execute `enois-preview setup --config JSON_PRIVADO` localmente e siga o tutorial. O setup valida a infraestrutura existente; a publicação controla imagem, configuração, catálogo e deploy. Após uma falha de publicação, use `resume` para concluir esses estágios.

Somente para lançadores antigos, `setup --legacy-verification REGISTRO_PRIVADO_ANTERIOR` migra uma conferência inicial correspondente sem avançar sua data. Registro ausente ou incompatível exige confirmação inicial interativa. As instruções antigas de validade de 24 horas não se aplicam.
