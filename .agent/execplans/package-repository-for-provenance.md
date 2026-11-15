# Declarar o repositório do pacote npm para a provenance

## Purpose and success

O `package.json` não tem o campo `repository`. Provenance é o atestado que o npm grava dizendo qual repositório e qual workflow publicaram o pacote. Numa publicação com Trusted Publishing e `NPM_CONFIG_PROVENANCE=true`, o npm compara `repository.url` do pacote com o repositório do workflow e recusa a publicação (erro E422, "repository.url" vazio) quando eles não batem. A primeira versão sai à mão, sem provenance, e passa. A segunda release automática e o job `recover` falhariam.

**Sucesso (observável):**

1. O `package.json` declara `"repository": { "type": "git", "url": "git+https://github.com/renanfranca/enois-preview.git" }`.
2. O pacote instalado a partir do tarball do `npm pack` traz esse mesmo `repository`, e ele aponta para o mesmo repositório que a guarda de release (`REPOSITORY` em `scripts/release-policy.ts`).
3. `npm run test:package` falha quando o campo falta ou aponta para outro repositório, e passa com o campo certo.

## Context and limits

- **Repositório:** `~/projects/enois-preview`, pasta principal, **sem worktree**.
- **Branch:** continue na `feat/guided-setup-npm-distribution`. Ela já está no remoto e o PR ainda não foi aberto; a correção precisa entrar antes do merge. **Não crie branch nova.**
- **Arquivos:**
  - `package.json`: acrescente o campo `repository` logo depois de `license`. O `prettier-plugin-packagejson` pode reordenar os campos; aceite a ordem que ele der.
  - `package-lock.json`: não deve mudar (o campo `repository` não entra no lockfile). Se mudar, confira por quê antes de seguir.
  - `test/package/package.test.ts`: o teste único `the npm tarball installs globally, runs --version and --help, and contains exactly the run-time allowlist` já lê o `package.json` instalado em `installed`. A asserção nova entra nele.
  - `scripts/release-policy.ts:5` exporta `REPOSITORY = 'renanfranca/enois-preview'`, a guarda usada pelo `qualify` e pelo `recover`. O `.github/workflows/release.yml` repete o mesmo valor em `github.repository == 'renanfranca/enois-preview'`.
- **Padrão dos imports nos testes:** os testes compilados rodam de `dist/test/...` e os scripts de `dist/scripts/...`. Para usar `REPOSITORY`, importe `../../scripts/release-policy.js` a partir de `test/package/package.test.ts` (confira como `test/release/release-policy.test.ts` importa o mesmo módulo e siga igual).
- **Formato da URL:** `git+https://github.com/<owner>/<repo>.git` é a forma que o `npm pkg fix` normaliza e que a verificação de provenance aceita para repositórios do GitHub. Use exatamente essa.
- **Fora do escopo:** `description`, `keywords`, `homepage`, `bugs`, mudanças nos workflows e na documentação. O `docs/{pt-BR,en}/RELEASING.md` já descreve o Trusted Publisher; não há instrução que mude.

## Milestones

### M1. Teste vermelho do campo `repository`

- Em `test/package/package.test.ts`, depois de ler o `package.json` instalado, acrescente a asserção:
  - `repository` é exatamente `{ type: 'git', url: \`git+https://github.com/${REPOSITORY}.git\` }` (`assert.deepEqual`), com `REPOSITORY`importado de`scripts/release-policy.ts`.
  - A mensagem da asserção explica a consequência, por exemplo `package.json repository must match the release repository, or npm provenance rejects the publication`.
- Leia o `package.json` instalado uma vez e reuse o objeto na asserção de `--version` e na nova, em vez de ler duas vezes.
- **Validação:** `npm run test:package` **falha** na asserção nova (o campo ainda não existe). Registre a mensagem observada no `Progress`.

### M2. Campo no `package.json`

- Acrescente `"repository": { "type": "git", "url": "git+https://github.com/renanfranca/enois-preview.git" }`.
- Rode `npm run prettier:format` só se o `prettier:check` reclamar do `package.json`.
- **Validação:** `npm run test:package` passa. Prove que o teste distingue o errado: troque temporariamente a URL para `git+https://github.com/example/other.git`, rode `npm run test:package` e confirme a falha na asserção nova; desfaça e confirme que volta a passar. Registre as duas observações.

## Progress

- [x] M1 teste vermelho do campo `repository`. Valor esperado vem de `REPOSITORY` em `scripts/release-policy.ts` (importado de `../../scripts/release-policy.js`), não do próprio `package.json`. `npm run test:package` sem o campo: exit 1, `AssertionError [ERR_ASSERTION]: package.json repository must match the release repository, or npm provenance rejects the publication` (critério 2). O `package.json` instalado é lido uma vez em `manifest` e reusado no `--version`.
- [x] M2 campo no `package.json`, com a prova da falha com outra URL. Com o campo certo: exit 0, `pass 1 fail 0` (critério 1). Com `git+https://github.com/example/other.git`: exit 1, `pass 0 fail 1`, mesma `AssertionError` (critério 3). URL restaurada: exit 0, `pass 1 fail 0`. O `prettier:check` reclamou do `package.json`; `npm run prettier:format` moveu `repository` para antes de `license` (ordem do `prettier-plugin-packagejson`, aceita).
- [x] Validação final. `prettier:check`, `typecheck`, `test:package`, `test:release` e `commitlint --from v0.4.0 --to HEAD` saíram com 0. `git status` lista só `package.json`, `test/package/package.test.ts` e este plano; `package-lock.json` não mudou.
- Não verificado: aceitação real da provenance pelo npm (critério 4); só aparece na segunda release automática.

## Validation

### Validação final (obrigatória antes do commit)

Todos devem sair com 0:

```sh
npm run prettier:check
npm run typecheck
npm run test:package
npm run test:release
npx --no-install commitlint --from v0.4.0 --to HEAD
git status --porcelain --untracked-files=all
```

O último deve listar só `package.json`, `test/package/package.test.ts` e este plano. `package-lock.json` não deve aparecer. `npm test` completo não é necessário: nenhum código de execução muda.

### Commit

Uma mensagem sugerida para o `lc`: `fix: declare the repository for npm provenance`. O tipo `fix` é aceito pelo `commitlint`; a branch já tem um `feat`, então a versão calculada continua `0.5.0`.

### Obrigações do executor

- **Expectativa e prova são verificações separadas.** Confira primeiro que o valor esperado é o repositório real da guarda de release (`REPOSITORY`), não um valor copiado do próprio `package.json`. Depois confira que o teste falha sem o campo (M1) e com outra URL (M2): só um teste que falha nesses dois casos prova o critério.
- **Registre evidência por critério** no `Progress`: comando, resultado observado e a asserção.
- **Não verificável localmente:** a aceitação real da provenance pelo npm só aparece na segunda release automática (a primeira sai à mão, sem provenance). Registre isso como não verificado.

### Critérios de aceite (planejados; nada aqui foi observado ainda)

| #   | Fonte                                         | Contexto → ação → resultado esperado                                                                                    | Verificação planejada                       | Evidência esperada                                   |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------- |
| 1   | Revisão de 2026-11-15; spec §1.3 (provenance) | Tarball do `npm pack` instalado num prefixo → ler `package.json` instalado → `repository` igual ao da guarda de release | Asserção nova no `test:package`             | Teste verde com o campo certo                        |
| 2   | Idem                                          | `package.json` sem `repository` → `npm run test:package` → falha na asserção nova                                       | M1, antes de acrescentar o campo            | Mensagem de falha registrada                         |
| 3   | Idem                                          | `repository` apontando para outro repositório → `npm run test:package` → falha                                          | M2, troca temporária da URL                 | Mensagem de falha registrada e volta ao verde depois |
| 4   | spec §1.3                                     | Segunda release pelo workflow com provenance → publicação aceita pelo npm                                               | Depois da primeira release (fora da sessão) | **Não verificável pelo executor**                    |
