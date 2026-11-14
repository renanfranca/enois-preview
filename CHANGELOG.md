# Histórico de versões

[English](docs/en/CHANGELOG.md) · [README](README.md)

Este arquivo registra o que mudou em cada versão, da mais nova para a mais antiga. Os guias ([README](README.md), [tutorial](docs/pt-BR/TUTORIAL.md), [receitas](docs/pt-BR/RECIPES.md)) descrevem só o comportamento atual. As evidências de cada versão estão em [VALIDATION.md](VALIDATION.md).

## 0.4.0 (2026-11-14)

A `v0.3.9` nunca foi lançada: os commits dela entram nesta versão. A 0.4.0 deixa de impor política ao banco e às aplicações descartáveis do operador. Só param a operação: falha de build ou de execução da aplicação, falha em identificar a revisão construída e publicada, e conta selecionada que não consegue entrar. Todo o resto vira aviso.

- **Avisos.** O JSON final de `publish`, `resume`, `setup` e `source-digest` sempre traz `warnings: [{code, message}]`, vazio quando nada foi observado. Cada aviso também sai numa linha do stderr com o prefixo `warning:`. Exemplo: `{"code":"database-in-use","message":"..."}`.
- **Build da imagem.** O build não roda mais testes das aplicações: o design system faz build e pack sem `test:dist`, o frontend compila sem `typecheck` e sem `npm test`, e o backend empacota com `./mvnw -B -DskipTests package`. `recipe/test/` foi removido. O CI de cada aplicação cuida dos testes dela.
- **Sem patches de restrição.** A receita não aplica mais o `StrictMediaSanitizer`, a mudança de tamanho do `MediaService`, as mudanças do `MediaStorageProxyController`, a mudança do `EmailService`, o `SIGNUP_OPEN`, as mudanças do `entrar.tsx` nem o stub de `navigator`. A propriedade `enois.preview.demo` sumiu da receita e do `runtime/start.ts`. O e-mail continua desligado por `spring.mail.*` e o cadastro por `rede.auth.signup-enabled=false`. Ficam só as adaptações funcionais (armazenamento local, prefixos de mídia, origem pública e dependência do design system). O `test:effects`, que provava a troca do envio de e-mail feita pelo patch, foi removido.
- **Migrações fora de ordem.** `application-demo.properties` passa a ter `spring.flyway.out-of-order=true` e `spring.flyway.validate-on-migrate=false`, como os perfis `qa`, `hml` e `prd` do backend. Uma migração fora de ordem roda no primeiro boot do Codespace.
- **Captura sem orquestrar o backend.** A captura não para, não inicia e não espera mais o backend do operador. Saíram o bloco `service` (`status`, `identity`, `stop`, `start`, `ready`, `released`), o `expectedIdentity`, o `restoration.json` e a exigência de `fuser`. O arquivo H2 é copiado com o backend rodando. Arquivo em uso (relatado pelo `fuser` ou por `rede.lock.db`) gera `database-in-use`; arquivo alterado durante a cópia gera `database-changed-during-copy`, e a cópia é usada mesmo assim.
- **Sanitizador.** Uma coluna desconhecida com cara de credencial gera o aviso `credential-column` com `TABELA.COLUNA` e não para a captura. Senhas desativadas, e-mails reescritos e logins das contas selecionadas continuam. O `sanitizerSha256` mudou, então a próxima captura não reaproveita dados congelados por versões anteriores.
- **Repositório sujo.** Gera o aviso `source-dirty`, dizendo que só o `HEAD` commitado é publicado, e não para mais a publicação.
- **Contas.** Pelo menos uma conta, sem o teto de 20. O `email` ficou opcional: sem ele, a ferramenta gera `account<N>@enois.invalid`. Qualquer e-mail válido e único na seleção é aceito. `publish --accounts ID[,ID...]` escolhe as contas sem terminal; os rótulos vêm da listagem capturada e um ID desconhecido falha. Sem terminal e sem contas, a mensagem cita `--accounts`.
- **Espaço em disco.** Pouco espaço livre para a captura vira o aviso `storage-low`.
- **`source-digest`.** Funciona com o backend rodando e emite `database-in-use` quando for o caso.
- **Commit da ferramenta.** `toolCommit` não é mais exigido nem faz parte da identidade da revisão. O journal e o resultado final registram o commit da ferramenta em execução (`toolCommit`, ou `null`) e `toolVerified`. Uma ferramenta que não é instalação verificada, como um checkout de desenvolvimento, publica com o aviso `unverified-tool`.
- **Lançador.** Um `tool.lock.json` ou dependência `enois-preview` diferente da ferramenta em execução gera o aviso `launcher-pin` com os dois commits; o lançador não é refixado automaticamente. A implantação do lançador roda só `npm ci --ignore-scripts` e `npm run build`. As checagens de `wrangler.jsonc` e do repositório configurado continuam bloqueando.
- **Lease remoto.** `publish` e `resume` ganharam `--force-lease`, que apaga o lease de outra operação, registra isso em `journal.intents.remoteLease.forced` e gera o aviso `lease-forced`. Sem a flag, nada muda.
- **Configuração da 0.3.x.** Continua carregando. `service`, `toolCommit`, `installation` e outros campos que não são mais usados são ignorados e preservados, com um único aviso `ignored-config-fields` que lista os nomes. Revisões criadas pela 0.3.x não têm `resume` garantido; um `publish` novo cria uma revisão nova.
- **Setup.** A confirmação do plano gratuito virou o aviso `free-plan`. O registro `installation` não é mais gravado nem exigido. Repositório do lançador ou pacote GHCR que não é privado gera aviso.
- **Validação.** Só bloqueiam: prontidão `UP`, identidade da revisão e login de cada conta selecionada com `/api/me` devolvendo o ID dela. Bytes, hash e MIME da mídia congelada, decodificação no Chromium, permissões, cookies seguros, leituras externas e as checagens de `verifyImage` (avisos de licença, inventários e design system) viraram avisos.
- **Worker.** Um Codespace cuja máquina não informa exatamente 2 CPUs é registrado com log, não recusado. Isso só vale depois de refixar o lançador nesta versão.
- **Gateway.** As rotas da aplicação não são mais bloqueadas. `/__demo/` continua reservado e um caminho com `;` continua recusado. Visitantes compartilham as contas e podem trocar a senha de uma delas até o Codespace ser reciclado; isso é aceito.
- **Uploads.** O limite por arquivo é de 100 MB no Worker, no `upload-transport` do runtime e no `DemoLocalStore`, o teto de corpo do plano gratuito da Cloudflare. O teto do próprio backend continua valendo. O limite compartilhado de 256 MiB e o `test:capacity` foram removidos; o disco do Codespace é o limite.
- **Exemplo.** O `test:example` confere as contagens e não confere mais o `canonicalDataSha256`. A config gerada sai sem `service`, `expectedIdentity` e `toolCommit`. O exemplo fixa os heads do `qa` público de 2026-11-13: backend `3fe25eaf`, frontend `35e498b3` e design system `ecb8545`.
- Instalação com um comando: `COMMIT=<SHA>; curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"`. O `install.sh` do próprio commit prepara o instalador num diretório temporário, apagado no fim, e não substitui a verificação: o instalador continua baixando o commit só de `codeload.github.com` e gravando os hashes em `install.json`.
- Novo comando `enois-preview install <SHA>`. Com a ferramenta já instalada, ele instala outro commit público verificado e aponta `current` e o comando para ele, sem clone nem build manual.
- O instalador passa a instalar o Chromium usado na validação pública e informa `browser: true` no JSON final. Se o navegador falhar, a instalação continua completa, o JSON traz `browser: false` e a mensagem mostra o comando para repetir só esse passo.
- O caminho manual (clone, `npm ci`, `npm run build`, `install-tool`) continua funcionando e é o único para commits anteriores a esta versão. Veja [a receita](docs/pt-BR/RECIPES.md#1-instalar-ou-trocar-a-ferramenta-para-outro-commit-fixado).
- `publish` e `resume` antes do `setup` passam a responder `Configuration missing. Run enois-preview setup --config PRIVATE_JSON first.`, em vez da lista de comandos.

## 0.3.8 (2026-11-12)

- A captura aceita bancos com a agenda privada e com criptografia de ponta a ponta por mensagem. A tabela `CALENDAR_SUBSCRIPTIONS` (links `.ics` da agenda) fica vazia na cópia sanitizada, e `MESSAGES.ENCRYPTED_KEYS` fica `NULL` em todas as mensagens, que continuam com o conteúdo. Até a 0.3.7, essas colunas paravam a captura com `Unrecognized authentication or integration column`.
- Uma coluna desconhecida com cara de credencial continua parando a captura, sem promover dados.
- O `sanitizerSha256` mudou. Por isso, a próxima captura com `--refresh-data` não reaproveita dados congelados por versões anteriores.

## 0.3.7 (2026-11-11)

- O adaptador de serviço do exemplo (`service.js`) não responde mais `Backend ownership mismatch` para um backend que está terminando. `status` e `start` passam a tratar esse processo como parado, e a captura deixa de falhar nesse intervalo.
- Mensagens, códigos de saída e formato do pidfile continuam iguais.

## 0.3.6 (2026-11-10)

- Um `stop` que ficou órfão (porque o CLI foi morto) espera só o backend que ele mesmo sinalizou. Ele não espera mais um backend novo iniciado depois nem apaga o pidfile desse backend novo.

## 0.3.5 (2026-11-10)

- Sem mudança de comportamento para o operador. O código de produção é igual ao da 0.3.4.
- `npm run test:capture` passa a provar, com Spring e H2 reais, que um segundo CLI conclui a parada aceita por um CLI interrompido antes de confiar na prontidão do backend.

## 0.3.4 (2026-11-10)

- Novo comando `enois-preview source-digest`. Ele só lê: com o backend de origem parado e liberado, copia o banco H2 para um diretório privado e imprime em JSON `databaseSha256`, `logicalSha256` (o `SCRIPT` do H2 sem as linhas `CREATE USER`, com sha256) e as contagens por tabela. Veja [a receita](docs/pt-BR/RECIPES.md#7-conferir-se-o-banco-mudou).
- Os pontos de entrada do runtime, da receita e do exemplo passam a funcionar também pelo link `current`, como os do CLI já funcionavam na 0.3.3.

## 0.3.3 (2026-11-10)

- O `service.js` instalado e os scripts funcionam quando chamados pelo link `~/.local/share/enois-preview/current`. Na 0.3.2, por esse caminho, eles não faziam nada e saíam com código 0.
- Use 0.3.3 ou mais nova no lugar da 0.3.2.

## 0.3.2 (2026-11-09)

- A tag existe, mas a versão não foi lançada: o `service.js` instalado não funcionava pelo link `current`. Use 0.3.3.
- Novo instalador `node dist/scripts/install-tool.js --commit <SHA>`. Ele baixa o commit público só de `codeload.github.com`, compila fora dos seus checkouts e grava os hashes da fonte e do `dist` em `install.json`. `publish` e `resume` recusam uma instalação diferente desse registro.
- Um checkout de desenvolvimento deixa de publicar. Revisões congeladas pela 0.3.1 ou anteriores só são retomadas pelo executor original: um checkout limpo no commit delas, compilado com `npm run build`.
- Quando um CLI morre durante uma parada aceita do backend, o próximo CLI espera essa parada terminar antes de confiar na prontidão.

## 0.3.1 (2026-11-07)

- `Ctrl+C` (`SIGINT`) e `SIGTERM` cancelam comandos ativos e impedem novas etapas. O primeiro sinal define a saída: `130` ou `143`.
- A restauração do backend não é interrompida por sinais adicionais. Se ela falhar, `restoration.json` fica guardado e a próxima execução de `publish` ou `resume` tenta a recuperação antes de olhar as fontes.
- Um push ou deploy já aceito pode precisar de reconciliação por `resume`, porque cancelar a espera local não desfaz o efeito remoto.

## 0.3.0 (2026-11-07)

- Node 24.x (`>=24 <25`) passa a ser a versão qualificada; `.nvmrc` seleciona a família 24. Node 22 deixa de ser qualificado.
- O timeout de um comando gerenciado encerra todo o grupo de processos dele com `SIGKILL`, incluindo descendentes que ficaram no grupo.
- Catálogos, links e registros anteriores são preservados. A retomada de operações criadas antes dessa atualização exige o executor original e não foi validada.
- O build do lançador executa `npm rebuild --ignore-scripts enois-preview` depois da compilação para criar o atalho npm do CLI. Os scripts de instalação continuam desativados.

## 0.2.0 (2026-11-07)

- Migração da automação para TypeScript estrito e ESM. Python deixa de ser requisito.
- Configuração, dados, journals, proveniência e catálogo usam `format: "enois-preview-ts-v1"`. Registros antigos com `schema` ou sem esse `format` são recusados antes de qualquer alteração; crie uma instalação e um catálogo novos.
- A instalação padrão fica em `~/.config/enois-preview-ts`.

### Execução observada da versão 0.2.0

Em 7 de novembro de 2026, o tutorial foi executado na infraestrutura existente com a ferramenta fixada em `a95d9862bea0b5076b311600d6f0ebec939cfbd5`, sem alterar planos ou segredos. As revisões são temporárias e iniciam outro ambiente automaticamente após a exclusão por inatividade.

| Etapa | Revisão pública verificada | Dados |
| --- | --- | --- |
| Primeira publicação e retomada | [34fab05937743573](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-pt-34fab05937743573) | D1 |
| Código atualizado | [a787a8b14663c307](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-pt-a787a8b14663c307) | Mesma D1, H2 e mídias locais indisponíveis durante o comando |
| Refresh explícito | [6c1183df4fe6acca](https://enois-demo-launcher.renan-andradefranca.workers.dev/preview/exemplo-typescript-pt-6c1183df4fe6acca) | D2, mesmos commits da etapa anterior |

A retomada preservou a revisão enquanto os três repositórios fictícios e os dados locais estavam indisponíveis. O caso começou com uma falha local de JVM registrada no aceite; a causa permanece desconhecida. [Recibos e limites](VALIDATION.md) incluem verificações públicas independentes dos marcadores de código e dados, imagens em desktop e emulação móvel e restauração após inatividade.
