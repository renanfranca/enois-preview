# Destravar o release automático: notas, título sem "v" e timeout do teste

## Purpose and success

O release automático da `0.5.1` (run 43746833272) falhou no job `publish`, no passo `generateNotes`, com esta mensagem: `conventional-changelog-conventionalcommits requires conventional-changelog-writer@9 or newer`. O `package.json` fixa o preset em `10.4.1`, mas o `@semantic-release/release-notes-generator@14.1.1`, a versão estável mais nova, traz o `conventional-changelog-writer@8.4.0`, que não consegue usar o preset 10. Nada foi publicado. O Trusted Publisher do npm precisa de uma publicação via OIDC até **17/11/2026, 18:09 UTC**.

O release automático também daria o título errado: o `@semantic-release/github` usa por padrão `<%= nextRelease.name %>`, e o `semantic-release` define `nextRelease.name = nextRelease.gitTag` (`node_modules/semantic-release/index.js:187`). Então a `0.5.1` sairia com o título `v0.5.1`, enquanto os releases desde a `0.3.7` se chamam só `0.3.7`, `0.4.0`, `0.5.0`.

Além disso, o primeiro `build` da `main` depois do PR #14 falhou porque o helper de `test/publication-journey.test.ts` mata a CLI após 10 s (`timeout: 10_000`). O teste `a refresh with a missing selected identity preserves D1 and gives correction guidance` leva de 7 a 9 s no runner, então recebeu `SIGTERM` (status 143 em vez de 1). Um `build` vermelho na `main` bloqueia o release.

**Sucesso (observável):**

1. Com a configuração real do `release.config.cjs`, o `@semantic-release/release-notes-generator` gera notas para um commit `fix:` sem erro, e as notas contêm o assunto do commit e a versão nova.
2. O título que o `@semantic-release/github` vai dar ao release, renderizado a partir da configuração real, é a versão sem o "v" (versão `1.2.3`, tag `v1.2.3` → título `1.2.3`).
3. O `commitlint` continua com as mesmas regras: `fix: use version` passa, e `Fixed the title.` é barrado.
4. O helper de `test/publication-journey.test.ts` deixa de matar a CLI aos 10 s; os testes desse arquivo continuam verificando o mesmo comportamento.
5. Depois do merge, o release automático publica a `0.5.1` no npm com provenance e cria o GitHub release `0.5.1` (verificado fora da sessão do executor).

## Context and limits

- **Repositório:** `~/projects/enois-preview`, pasta principal, **sem worktree**.
- **Branch:** a branch atual `ci/recover-release-title` já foi mesclada (PR #14). A `main` local está atrás (`e33fb1d`); a `origin/main` está em `9b1b763`. Antes de criar a branch, vá para a `main` e rode `git pull --ff-only`, para a branch nova sair de `9b1b763`. O plano é um arquivo não rastreado e acompanha a troca de branch. Nome sugerido: `fix/release-notes-preset`.
- **Arquivos:**
  - `package.json` e `package-lock.json`: `conventional-changelog-conventionalcommits` passa de `10.4.1` para `9.3.1`, a última da linha 9 e compatível com o writer 8. Use `npm install --save-exact conventional-changelog-conventionalcommits@9.3.1`. O `@commitlint/config-conventional@21.2.4` pede `^10.0.0`; o npm deve deixar uma cópia da versão 10 aninhada só para ele. Confira com `npm ls conventional-changelog-conventionalcommits`.
  - `release.config.cjs`: no plugin `@semantic-release/github`, acrescente `releaseNameTemplate: '<%= nextRelease.version %>'`. Não mude as outras opções.
  - `test/release/release-policy.test.ts`: os testes novos entram aqui. O arquivo já tem o helper `released()`, que carrega o `release.config.cjs` real com `createRequire` e chama o plugin real (`analyzeCommits`). Siga esse padrão.
  - `test/publication-journey.test.ts:45`: `timeout: 10_000` passa para `120_000`, o mesmo valor de `test/cli-journey.test.ts:260` e `test/source-digest.test.ts:15`. O timeout só existe para um teste travado não ficar parado para sempre; ele não mede desempenho.
- **CI:** `.github/workflows/build.yml:69` roda `npm run test:release` em todo PR e push, então os testes novos protegem a `main` antes de qualquer release.
- **Testes sem valores fixos de dependência:** o usuário pediu explicitamente que os testes não quebrem só porque uma versão ou um valor mudou. Nenhum teste pode citar `9.3.1`, `10.4.1`, `0.5.1` ou outra versão de pacote. A versão do release usada no teste é um valor de entrada escolhido pelo próprio teste (por exemplo `1.2.3`), e o resultado esperado é derivado dele.
- **Fora do escopo:** atualizar o `semantic-release` ou o gerador para versões beta, mudanças no `release.yml` e na documentação, e a versão `0.0.0-stage` no npm (o usuário cuida dela).

## Milestones

### M1. Testes vermelhos do release

Em `test/release/release-policy.test.ts`, acrescente um teste de comportamento, por exemplo `the release configuration renders notes and names the GitHub release with the bare version`:

- Carregue o `release.config.cjs` real como o `released()` faz. Pegue as opções do `@semantic-release/release-notes-generator` e do `@semantic-release/github` a partir da lista `plugins`.
- **Notas:** importe `generateNotes` de `require.resolve('@semantic-release/release-notes-generator')` e chame com as opções da configuração e um contexto com `cwd: ROOT`, `options: { repositoryUrl: 'https://github.com/renanfranca/enois-preview.git' }`, `lastRelease: { gitTag: 'v1.2.2', version: '1.2.2' }`, `nextRelease: { gitTag: 'v1.2.3', version: '1.2.3' }`, um commit `fix: keep the release title bare` e um logger mudo. Asserte que as notas contêm `keep the release title bare` e `1.2.3`.
- **Título:** asserte que as opções do plugin github declaram `releaseNameTemplate`, e que ele, renderizado com o mesmo `template` do `lodash-es` que o plugin usa (`node_modules/@semantic-release/github/lib/publish.js:4` e `:53`), com o contexto `{ nextRelease: { version: '1.2.3', gitTag: 'v1.2.3', name: 'v1.2.3' } }`, dá exatamente `1.2.3`. Resolva o `lodash-es` a partir do pacote do plugin github (`createRequire` do caminho de `@semantic-release/github`), sem acrescentar dependência ao `package.json`.
- **Validação:** `npm run test:release` **falha** neste teste. Registre no `Progress` as duas falhas observadas: nas notas, a mensagem `Missing helper: "conventional-changelog-conventionalcommits requires conventional-changelog-writer@9 or newer`; no título, a falta de `releaseNameTemplate`. Se uma falha esconder a outra, registre a que apareceu e confirme a segunda no M2.

### M2. Preset compatível e título sem "v"

- Rode `npm install --save-exact conventional-changelog-conventionalcommits@9.3.1`.
- Acrescente `releaseNameTemplate: '<%= nextRelease.version %>'` ao plugin github em `release.config.cjs`.
- **Validação:**
  - `npm run test:release` passa.
  - Prova de que o teste distingue o errado, uma troca de cada vez, desfazendo depois: com o template `'<%= nextRelease.name %>'` o teste falha no título (`v1.2.3` em vez de `1.2.3`); com o preset de volta em `10.4.1` (`npm install --save-exact conventional-changelog-conventionalcommits@10.4.1`) o teste falha nas notas. Depois de restaurar `9.3.1`, confirme que o `package-lock.json` voltou ao estado do M2 e que o teste passa.
  - `npm ls conventional-changelog-conventionalcommits` mostra `9.3.1` no topo e uma cópia `10.x` sob `@commitlint/config-conventional`.
  - `echo 'fix: use version' | npx --no-install commitlint` sai com 0, e `echo 'Fixed the title.' | npx --no-install commitlint` sai com código diferente de 0.

### M3. Timeout do helper

- Em `test/publication-journey.test.ts:45`, troque `timeout: 10_000` por `timeout: 120_000`.
- **Validação:** `npm test` passa. Não é possível provar localmente a instabilidade do runner; registre isso como observação, não como critério verificado.

## Progress

- [x] M1 testes vermelhos do release. Fontes conferidas antes: `gh run view 43746833272 --log-failed` mostra `Missing helper: "conventional-changelog-conventionalcommits requires conventional-changelog-writer@9 or newer`; `node_modules/semantic-release/index.js:187` tem `nextRelease.name = nextRelease.gitTag`; `gh release list -L 5` mostra `0.5.0`, `0.4.0`, `0.3.8`, `0.3.7` sem "v" (e `v0.3.6` antes). Teste novo `the release configuration renders notes and names the GitHub release with the bare version` em `test/release/release-policy.test.ts`. `npm run test:release` falhou nas notas com `Missing helper ... writer@9 or newer`; essa falha escondeu a do título, confirmada no M2.
- [x] M2 preset `9.3.1`, `releaseNameTemplate`, provas da falha e checagem do commitlint.
  - Só com o preset `9.3.1`: `npm run test:release` falhou com `the github plugin declares releaseNameTemplate` (critério 2 vermelho sem o template).
  - Com `releaseNameTemplate: '<%= nextRelease.version %>'`: `npm run test:release` com 11 pass, 0 fail (critérios 1 e 2 verdes).
  - Prova com `'<%= nextRelease.name %>'`: falhou com `actual: 'v1.2.3'`, `expected: '1.2.3'`. Restaurado.
  - Prova com o preset `10.4.1`: falhou nas notas com `Missing helper`. Restaurado `9.3.1`; `cmp` do `package-lock.json` com a cópia do M2 deu idêntico; teste verde de novo.
  - `npm ls conventional-changelog-conventionalcommits`: `9.3.1` no topo e `10.4.1` sob `@commitlint/config-conventional@21.2.4`.
  - Critério 3: `echo 'fix: use version' | npx --no-install commitlint` saiu com 0; `echo 'Fixed the title.' | npx --no-install commitlint` saiu com 1.
- [x] M3 timeout do helper em `120_000` (`test/publication-journey.test.ts:45`). `npm test` com 133 pass, 0 fail. A instabilidade do runner (critério 4) não é reproduzível localmente; fica como observação, a confirmar no CI do PR.
- [x] Validação final: `prettier:check`, `typecheck`, `npm test` (133/0), `test:release` (11/0), `test:workflows` (4/0), `test:package` (1/0) e `commitlint --from origin/main --to HEAD` saíram com 0. `git status` lista só os cinco arquivos previstos e este plano.
- [ ] Critério 5 (publicação da `0.5.1` com provenance e GitHub release `0.5.1`): **não verificável pelo executor**; só aparece depois do merge.

## Validation

### Validação final (obrigatória antes do commit)

Todos devem sair com 0:

```sh
npm run prettier:check
npm run typecheck
npm test
npm run test:release
npm run test:workflows
npm run test:package
npx --no-install commitlint --from origin/main --to HEAD
git status --porcelain --untracked-files=all
```

O último deve listar só `package.json`, `package-lock.json`, `release.config.cjs`, `test/release/release-policy.test.ts`, `test/publication-journey.test.ts` e este plano. O `commitlint` aqui ainda não vê o commit novo; o CI confere a mensagem no PR.

### Commit

Mensagem sugerida para o `lc`: `fix: render release notes and name releases by version`. Tem que ser `fix:`, porque o merge precisa gerar a `0.5.1` para validar o Trusted Publisher antes do prazo.

### Obrigações do executor

- **Expectativa e prova são verificações separadas.** Confira primeiro que as expectativas batem com as fontes: a mensagem do run 43746833272 (`gh run view 43746833272 --log-failed`), a regra `nextRelease.name = nextRelease.gitTag` em `node_modules/semantic-release/index.js` e o padrão de título dos releases anteriores (`gh release list -L 5`). Depois confira que o teste falha com o preset `10.4.1` e com o template `nextRelease.name`; só um teste que falha nos dois casos prova os critérios 1 e 2.
- **Registre evidência por critério** no `Progress`: comando, resultado observado e a asserção.
- **Não verificável pelo executor:** a publicação real da `0.5.1` com provenance e o título do GitHub release (critério 5) só aparecem depois do merge. Registre isso como não verificado.

### Critérios de aceite (planejados; nada aqui foi observado ainda)

| #   | Fonte                                                                  | Contexto → ação → resultado esperado                                                                                      | Verificação planejada            | Evidência esperada                                    |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| 1   | Run 43746833272, passo `generateNotes`                                 | Configuração real, commit `fix:` e próxima versão `1.2.3` → `generateNotes` → notas sem erro, com o assunto e `1.2.3`     | Teste novo no `test:release`     | Vermelho no M1 e com o preset 10; verde no M2         |
| 2   | `semantic-release/index.js:187`; `gh release list` (`0.3.7` em diante) | Versão `1.2.3`, tag `v1.2.3` → renderizar o `releaseNameTemplate` da configuração → `1.2.3`                               | Teste novo no `test:release`     | Vermelho sem o template e com `nextRelease.name`      |
| 3   | `commitlint.config.cjs`; `build.yml:46`                                | Preset da raiz em 9.3.1 → `commitlint` com `fix: use version` e com `Fixed the title.` → aceita o primeiro, barra o outro | Comandos do M2                   | Códigos de saída 0 e diferente de 0                   |
| 4   | Run 43746049184, status 143 em vez de 1                                | CLI que leva mais de 10 s → helper com `timeout: 120_000` → a CLI termina e o teste vê o status real                      | `npm test` local; CI do PR       | `npm test` verde; instabilidade não reproduzível aqui |
| 5   | Spec §1.3; prazo do Trusted Publisher                                  | Merge na `main` com `build` verde → release automático → `0.5.1` no npm com provenance e GitHub release `0.5.1`           | Depois do merge (fora da sessão) | **Não verificável pelo executor**                     |
