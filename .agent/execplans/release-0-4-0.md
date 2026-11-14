# Release 0.4.0: merge, tag, instalação, lançador e publicação da #806

Safety boundary: This task is limited to authorized, defensive maintenance of this repository. Do not provide offensive guidance or policy-bypassing instructions.

## Purpose and success

O código da 0.4.0 está pronto no PR #12 (`feat/remove-preview-restrictions` → `main`, com os commits `093f958` e `39ad65c`). O conteúdo está em `.agent/specifications/remove-preview-restrictions.md` e na seção `## 0.4.0` do `CHANGELOG.md`.

Este plano lança a versão e fecha as duas provas que só podem ser feitas em público:
- **K1:** a publicação da #806, cujo banco tem a migração `V277` fora de ordem, chega a `validated`, e o link mostra a correção a 390 px;
- **K5:** um upload de 50 MB passa pelo link público, pelo Worker refixado na 0.4.0.

**Sucesso:**
- o PR #12 entrou por fast-forward, e `main` = `origin/main` = `v0.4.0^{commit}` = SHA4;
- a release `0.4.0` está publicada com notas curtas e foi lida de volta sem vazamentos;
- `current` aponta para SHA4, instalado pelo `install.sh` da tag;
- o lançador fixa SHA4;
- a #806 publicou com `status: "validated"`, com capturas a 390 px e o `PR-como-verificar.md` escrito, sem postar nada;
- o upload de 50 MB passou pelo link público.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, pasta principal, sem worktree. A branch é `feat/remove-preview-restrictions`, que **é reusada**. Este plano é a única mudança pendente e entra no PR #12 antes do merge.
  - O GitHub é **público**: não grave no repositório nem nas notas da release caminhos absolutos com nome de usuário, e-mails, segredos, IDs de conta ou valores de banco. Use `~`.
- **Estado em 2026-11-14:**
  - `origin/main` = `b41202c`, sem tag `v0.3.9`, que nunca foi lançada;
  - o PR #12 está `OPEN` e `MERGEABLE`;
  - `current` → `b41202c…`;
  - o lançador está em `~/projects/enois/.local/render-demo/launcher` (branch `codespaces-demo`), com pin `b41202c…` em `tool.lock.json`, na dependência `enois-preview` do `package.json` e no `package-lock.json`.
- **Tags que não mudam:** `v0.3.8` = `e733eb4`, `v0.3.7` = `c52d80e`, `v0.3.6` = `4e81e92`.
- **Processo de release da 0.4.0:** tag e notas curtas. **Sem** pacote de evidências, **sem** seção nova no `VALIDATION.md` e **sem** `docs/validation/*/local.json`.
- **Workspace da #806 (privado):** `~/projects/enois/.local/issue806/`.
  - Roteiro de conferência: `HANDOFF-enois-preview.md`, seção "Como conferir no link".
  - Plano privado: `EXECPLAN-publish-preview-806.md`, com M7.
  - Home da ferramenta: `ENOIS_PREVIEW_HOME=~/projects/enois/.local/issue806/.preview/installation`.
  - A config tem `service`, `toolCommit` e `installation`. **Não edite.** A 0.4.0 ignora esses campos com o aviso `ignored-config-fields`.
  - **Aplicações em 2026-11-14:**
    - backend `~/projects/enois/enois-backend`, em `qa` = `a3a6da97`, 75 commits atrás de `upstream/qa`, com 22 migrações novas (`V288` a `V316`);
    - design system `~/projects/enois/enois-design-system`, em `qa` = `68f08d0`, 30 atrás;
    - frontend principal `~/projects/enois/enois-frontend`, em `qa` = `227ffb93`, 23 atrás;
    - a correção da #806 está no worktree `~/projects/enois/enois-frontend/.claude/worktrees/806-mobile-price-title-squeeze`, na branch `fix/806-mobile-price-title-squeeze` = `595914bd`: um commit sobre `qa`, igual a `origin/fix/806-mobile-price-title-squeeze` e sem PR aberto no upstream.
    - Todos estão limpos, e o fast-forward para `upstream/qa` é possível nos três `qa`.
    - `upstream/qa` não mexeu em nenhum dos três arquivos da correção (`src/routes/servicos.tsx`, `src/routes/meus-servicos.tsx` e `src/routes/-servicos.price-room.test.tsx`).
    - O `package-lock.json` do frontend mudou no upstream.
    - A config da #806 aponta para esses quatro caminhos.
  - O `publish` lê o `HEAD` atual de cada aplicação (`preview/capture.ts`) e reaproveita os dados congelados da #806 (`preview/publication.ts`). **Não use** `--refresh-data`. As migrações novas rodam no boot sobre os dados congelados, com `out-of-order` ligado.
  - A operação falha `ad7ac648…` da 0.3.9 fica onde está.
  - O `.preview/publish-result.json` atual está vazio, sobra da 0.3.9.
- **Lease remoto:** a ref `refs/heads/enois-preview-publication-lease` do lançador precisa estar ausente (`gh api repos/<lançador>/git/refs/heads/enois-preview-publication-lease` → 404). Se existir, pare e pergunte. **Não use** `--force-lease`.
- **Evidências:** `$EV` = `~/projects/enois/.local/preview-typescript-evidence/node24-consolidation`. Grave em `$EV/release-0.4.0/delivery/`.
- **Nas aplicações, só o L7:** atualizar as branches atuais com o `upstream/qa` mais novo, sem enviar nada. Fora isso, **não toque** nas aplicações, nos bancos, nos workspaces `public-walkthrough-*`, na config padrão nem em releases e tags anteriores.

**Autorização (dada no handoff):**
- **Concedida:**
  - `lc` e `lp` neste repositório e no lançador;
  - merge **só por fast-forward** pelo `luna`, com fallback por `git merge --ff-only` e `git push origin main`, registrado;
  - criar e enviar a tag `v0.4.0`;
  - `gh release create v0.4.0`;
  - instalação pelo `install.sh`;
  - no lançador, só o pin;
  - L7:
    - `git fetch upstream`;
    - fast-forward local dos três `qa` para `upstream/qa`;
    - rebase local de `fix/806-mobile-price-title-squeeze` sobre `upstream/qa`;
    - `npm ci` no worktree da #806;
    - **sem push** para `origin` ou `upstream` (o push da branch da #806 reescrita exigiria force push);
  - `enois-preview publish issue-806-precos-longos` e no máximo um `resume`;
  - o upload de prova do K5 no link da #806, apagado no fim;
  - apagar a branch já incorporada.
- **Exige parar e perguntar:**
  - force push;
  - merge que não seja fast-forward;
  - reescrever a `main` ou tags;
  - editar releases anteriores;
  - conta, plano pago, Worker novo ou segredo;
  - `wrangler deploy` manual;
  - `--refresh-data` ou `--force-lease`;
  - editar a config da #806;
  - tocar nas aplicações além do L7 ou nos bancos;
  - qualquer conflito no rebase, ou mudança no código das aplicações para fazer o build ou o boot passar;
  - postar qualquer coisa no PR da #806.

## Milestones

### L0. Baseline
Grave em `delivery/baseline.json`:
- branch, `git status` e `HEAD` = `39ad65c`;
- `gh pr view 12 --json state,mergeable,headRefOid`;
- `origin/main` = `b41202c`;
- `git ls-remote --tags origin | sort` → `tags-before.txt`;
- `readlink ~/.local/share/enois-preview/current`;
- pin do lançador, `git status` do lançador e `HEAD` = `origin/codespaces-demo`;
- ausência da ref de lease (404);
- branch, `HEAD` e o `git status --porcelain --untracked-files=all` vazio dos quatro checkouts das aplicações listados em Context;
- o sha256 de `~/projects/enois/.local/issue806/.preview/installation/config.json`, para provar no fim que ele não mudou.

Qualquer divergência é parada.

### L1. Validação, commit do plano e push
- Rode a Validation (seção abaixo) sobre o tree com este plano.
- Depois, `lc` e `lp`. O commit novo entra no PR #12. SHA4 = o `HEAD` depois do `lp`.
- Confira que o diff de `39ad65c..SHA4` toca só `.agent/execplans/release-0-4-0.md`.

### L2. Merge por fast-forward
- Rode:

  `luna "Na branch feat/remove-preview-restrictions de ~/projects/enois-preview, o PR #12 para main já existe. Faça o merge SOMENTE por fast-forward: git switch main && git pull --ff-only && git merge --ff-only feat/remove-preview-restrictions && git push origin main. Não use squash, rebase nem merge commit; se o fast-forward não for possível, pare e reporte. Ao final deixe main limpo e igual a origin/main e informe o SHA e o estado do PR."`
- Se o `luna` for bloqueado, faça o mesmo fast-forward com git e registre.
- **Confira:**
  - `main` = `origin/main` = SHA4;
  - `gh pr view 12 --json state` = `MERGED`;
  - `git status` limpo.

### L3. Tag
- `git tag -a v0.4.0 -m "0.4.0" <SHA4>` e `git push origin v0.4.0`.
- **Confira:**
  - `git ls-remote --tags origin` = `tags-before.txt` mais as duas linhas da `v0.4.0` (a tag anotada e o `^{}`);
  - as tags anteriores não mudaram.
- Grave `tags-after.txt`.

### L4. Release
- `gh release create v0.4.0 --title 0.4.0 --notes-file <arquivo em delivery/>`, sem anexos.
- **Notas curtas, em PT e EN:**
  - a ferramenta deixa de impor política e troca bloqueios por avisos;
  - o build sem testes das aplicações;
  - a captura sem parar o backend;
  - as migrações fora de ordem;
  - `--accounts` e `--force-lease`;
  - o limite de 100 MB;
  - a `v0.3.9` nunca lançada;
  - o aviso de que o lançador precisa ser refixado uma vez;
  - um link para a seção `## 0.4.0` do `CHANGELOG.md` e do `docs/en/CHANGELOG.md` na tag.
- **Leitura de volta:**
  - `gh release view v0.4.0 --json tagName,name,body,assets`;
  - confira a tag, o título `0.4.0` e zero anexos;
  - procure no corpo `/home/`, `@` (e-mail) e padrões de token (`gh[pousr]_`, `github_pat_`). Não pode haver nenhum.
- Grave `release-readback.json`.

### L5. Instalação
- Rode:

  ```sh
  COMMIT=<SHA4>
  curl -fsSL "https://raw.githubusercontent.com/renanfranca/enois-preview/$COMMIT/install.sh" | bash -s -- "$COMMIT"
  ```

  A saída vai para `delivery/install.log`.
- **Confira:**
  - `current` → SHA4;
  - o comando global aponta para `<SHA4>/dist/preview/cli.js`;
  - `install.json` tem `commit` = SHA4;
  - o JSON final traz `browser: true`;
  - as instalações `d2c2bbb`, `e733eb4` e `b41202c` continuam presentes.

### L6. Lançador
No checkout do lançador:
1. `git pull --ff-only`;
2. pin SHA4 em `tool.lock.json` (`commit`) e na dependência `enois-preview` do `package.json` (`https://codeload.github.com/renanfranca/enois-preview/tar.gz/<SHA4>`);
3. `npm install --package-lock-only --ignore-scripts`;
4. `npm ci --ignore-scripts && npm run build && npm test && npm run check`. Se falhar, pare e reporte;
5. o `git diff --stat` toca só `tool.lock.json`, `package.json` e `package-lock.json`;
6. `lc` e `lp`, na branch `codespaces-demo`. Confira `HEAD` = `origin/codespaces-demo`.

Não rode `wrangler deploy`: o próprio `publish` implanta no L8.

### L7. Aplicações em `upstream/qa`
1. Em cada um dos três repositórios, rode `git fetch upstream`. Grave `upstream/qa` em `delivery/apps.json`.
2. Nos checkouts principais de backend, design system e frontend: `git switch qa` (já está) e `git merge --ff-only upstream/qa`. Se não for fast-forward, pare.
3. No worktree da #806: `git rebase upstream/qa`.
   - Se houver qualquer conflito, rode `git rebase --abort` e pare.
   - **Esperado:**
     - um único commit `fix(servicos): limita preços longos nos cards` sobre `upstream/qa`;
     - `git diff upstream/qa..HEAD --stat` tocando só os três arquivos da correção;
     - `git range-diff` com o patch igual ao de `595914bd`.
   - Grave o SHA novo como `FIX806`.
4. No worktree: `npm ci`, `npx vitest run src/routes/-servicos.price-room.test.tsx` e `npm run typecheck`, todos com saída 0. As saídas vão para `delivery/apps/`.
   - Se o teste da correção falhar, pare. Não conserte.
   - Se `npm ci` ou `typecheck` falharem por motivo que não tenha a ver com a correção, registre e pare: um `qa` quebrado no upstream é decisão do usuário.
5. **Confira:**
   - backend, design system e frontend principal com `HEAD` = `upstream/qa`;
   - o worktree com `HEAD~1` = `upstream/qa` do frontend;
   - `git status` limpo nos quatro;
   - a branch `origin/fix/806-mobile-price-title-squeeze` continua em `595914bd`, porque não houve envio. Registre que ela ficou divergente.

### L8. Publicação da #806 (K1, parte 1)
1. Confira de novo que a ref de lease não existe.
2. Renomeie o `.preview/publish-result.json` vazio para `.preview/publish-result-0.3.9.json`.
3. Rode, em segundo plano, e espere terminar (de 20 a 40 min):

   `ENOIS_PREVIEW_HOME=~/projects/enois/.local/issue806/.preview/installation enois-preview publish issue-806-precos-longos`

   O stdout vai para `.preview/publish-result.json`, o stderr para `.preview/publish-0.4.0.log` e o código de saída para `.preview/publish-0.4.0.exit`.
4. **Esperado:**
   - saída 0, `status: "validated"`, uma `url` e um slug `issue-806-precos-longos-…`;
   - `warnings` contém `ignored-config-fields` e **não** contém `launcher-pin`;
   - qualquer outro aviso é registrado;
   - os commits de origem gravados na revisão (`inputs`, no journal) são `upstream/qa` do backend, `upstream/qa` do design system e `FIX806`.
5. **Se falhar:**
   - no máximo um `enois-preview resume <revision>`, com o mesmo `ENOIS_PREVIEW_HOME`;
   - se falhar de novo, ou se a causa for erro da aplicação (Flyway, compilação, boot), pare e reporte com o trecho do log da operação;
   - se a JVM cair com `SIGSEGV` no JIT, registre o `hs_err` e conte isso como a única retomada.

### L9. Conferência a 390 px (K1, parte 2)
Siga o M7 do `EXECPLAN-publish-preview-806.md`:
1. Abra a `url` e espere a página de credenciais. O único login oferecido é `issue806.dona@enois.invalid`.
2. A 390 × 844, siga os passos 3 a 5 do "Como conferir no link" do handoff:
   - o título de "Identidade visual completa…" fica visível, com largura maior que zero;
   - o orçamento termina em "…";
   - "Site completo com loja virtual…" aparece em Ofertas e em `/meus-servicos`.
3. Use um script Playwright headless **fora do repositório**, no `delivery/` ou em `.preview/`. Leia as credenciais da página na hora e não grave a senha. As capturas vão para `.preview/evidence/0.4.0/`.
4. Escreva `.preview/PR-como-verificar.md` pelo modelo da receita 9, com o link, a conta, as páginas e os resultados esperados, **sem senha**. **Não poste.**

### L10. Upload de 50 MB pelo link público (K5)
Use um script fora do repositório, em `delivery/k5/`, contra a `url` da #806:
1. Use um `Session` com o slug. As credenciais vêm de `/__demo/access.json`.
2. Login com a conta da #806.
3. Aloque `audio/wav` de 50 000 000 bytes, com propósito `POST_AUDIO`, e envie um WAV válido com `PUT` no `uploadUrl` pela origem pública. O Worker fragmenta acima de 8 MiB.
4. **Esperado:** sucesso no `PUT`. Um `GET` com `Range: bytes=0-77` no `cdnUrl` responde 206 e começa com `RIFF`.
5. Apague a mídia com `DELETE /api/media/<id>`.
6. Grave `k5.json` com os bytes, os status e a confirmação da exclusão, sem credenciais.
- **Discriminação:** com o Worker da 0.3.9, o mesmo `PUT` responderia `413 Limite de 20 MiB por arquivo.`

### L11. Limpeza e registros
- Confira que `feat/remove-preview-restrictions` é ancestral da `main` e apague a branch local e a remota (`cleanup.json`).
- Se o publish avançou o origin do lançador, faça fast-forward no checkout local.
- Confira que o sha256 da config da #806 é igual ao do L0.
- Atualize o Progress do `EXECPLAN-publish-preview-806.md` privado (M6 e M7), com os commits novos das aplicações e `FIX806`.
- No relatório, deixe para o usuário a decisão sobre enviar a branch da #806 reescrita. Isso é um force push para `origin/fix/806-mobile-price-title-squeeze`.
- Escreva `delivery/executor-report.md`: o estado de cada critério com comando, resultado e artefato, os desvios, a `url` e o slug da #806.

## Critérios de aceitação

Fontes:
- **[S]** a especificação, nos cenários 1 e 5;
- **[C]** `CHANGELOG.md`, seção `## 0.4.0`;
- **[H]** o `HANDOFF-enois-preview.md` da #806, seção "Como conferir no link";
- **[U]** o pedido do usuário: release, instalação, lançador e #806.

Para cada critério, o executor confere **separadamente**:
1. se a expectativa está certa frente às fontes;
2. se a prova a demonstra.

Registre comando, resultado e artefato. Lacuna fica escrita como lacuna.

**D1. Entrega** [U, C]
- `main` = `origin/main` = `v0.4.0^{commit}` = SHA4;
- PR #12 `MERGED`;
- tags anteriores iguais a `tags-before.txt`;
- release `0.4.0` lida de volta sem vazamentos e sem anexos;
- `current` → SHA4 pelo `install.sh`;
- o lançador fixa SHA4, sincronizado com o origin, e o diff toca só os 3 arquivos;
- a branch foi apagada.

**K1. A #806 publica e mostra a correção** [S cenário 1, H]
- **Contexto:** os mesmos dados congelados da tentativa da 0.3.9, com o banco que tem a `V277` fora de ordem. As aplicações agora estão em `upstream/qa`, com a correção rebaseada (`FIX806`), e trazem também as migrações `V288` a `V316`, que ainda não estão nesse banco.
- **Esperado:**
  - `validated`;
  - capturas a 390 px com o título de "Identidade visual completa…" visível e o orçamento terminando em "…";
  - só a conta da #806 com login;
  - `PR-como-verificar.md` escrito e não postado.
- **Discriminação:** a 0.3.9 falhava nessa mesma publicação com `Detected resolved migration not applied to database: 277` (operação `ad7ac648…`). Um link `validated` sem as capturas não fecha o K1.

**K5. Upload de 50 MB no link público** [S cenário 5]
- **Esperado:** `PUT` aceito, `GET` com `Range` respondendo 206 e `RIFF`, e a mídia apagada no fim.
- **Discriminação:** o Worker da 0.3.9 responde 413 acima de 20 MiB. O `k5.json` registra que o tamanho passou de 20 MiB.

**D2. Nada privado mudou** [U]
- O sha256 da config da #806 é igual ao do L0.
- As aplicações estão exatamente nos `HEAD`s do L7, com `git status` vazio, e nada foi enviado aos remotos delas (`origin/qa` e `origin/fix/806-mobile-price-title-squeeze` estão iguais ao L0).
- Nenhum arquivo foi tocado nos workspaces `public-walkthrough-*`.

## Progress

- [ ] L0 baseline
- [ ] L1 validação, commit e push (este arquivo congela aqui; o restante vai para `delivery/executor-report.md`)
- [ ] L2 merge por fast-forward
- [ ] L3 tag
- [ ] L4 release
- [ ] L5 instalação
- [ ] L6 lançador
- [ ] L7 aplicações em `upstream/qa`
- [ ] L8 publicação da #806
- [ ] L9 conferência a 390 px
- [ ] L10 upload de 50 MB
- [ ] L11 limpeza e registros

## Validation

Antes do `lc` do L1, sobre o tree exato com este plano, todos devem sair com 0:
1. `npm ci --ignore-scripts`
2. `npm run build`
3. `npm run typecheck`
4. `npm test`: 119 testes, 0 fail e 0 skip
5. `npm run check`

O código não muda neste plano. As suítes de integração (`test:image`, `test:media`, `test:flows` e as demais) já passaram em `39ad65c` e não são repetidas. Grave as saídas em `delivery/validation/`.

**Paradas:**
- qualquer divergência no L0;
- qualquer validação falha;
- o merge não é fast-forward;
- a ref de lease existe;
- a instalação, o consumer do lançador ou o `publish` da #806 falham depois de no máximo uma retomada;
- fast-forward impossível ou conflito no L7;
- o teste da correção falha depois do rebase;
- qualquer necessidade de tocar nas aplicações além do L7, nos bancos, na config da #806 ou nos walkthroughs.
