# Releases e CI

[English](../en/RELEASING.md) · [README](../../README.md)

Este guia é para quem mantém o enois-preview. Operadores só precisam de `npm install -g enois-preview`.

## Versão

O `package.json` e o `package-lock.json` ficam sempre em `0.0.0-SNAPSHOT`. As tags `v<versão>` são a única fonte das versões lançadas, e a release nunca comita nada de volta no repositório. A versão é calculada pelo semantic-release a partir dos Conventional Commits desde a última tag `v*` da `main`:

| Commits desde a última tag                                       | Release |
| ---------------------------------------------------------------- | ------- |
| `fix`, `perf` ou `revert`                                        | patch   |
| `feat`                                                           | minor   |
| `!` no cabeçalho ou rodapé `BREAKING CHANGE:`                    | major   |
| só `docs`, `chore`, `test`, `ci`, `refactor`, `style` ou `build` | nenhuma |

Não há regra que segure o projeto abaixo da `1.0.0`. Exemplo: depois de `v0.5.0`, um `fix: ...` e um `feat(setup): ...` geram `v0.6.0`.

Todo commit precisa seguir os [Conventional Commits](https://www.conventionalcommits.org/); o CI roda o `commitlint` no intervalo do push ou do PR. Os limites de tamanho de cabeçalho, corpo e rodapé estão desligados.

## CI

O workflow `build` (`.github/workflows/build.yml`) roda em push e PR para a `main` e por `workflow_dispatch`, com `contents: read`, nesta ordem: `actionlint` com sha256 conferido, Node da família do `.nvmrc` e Java 25, `npm ci`, `npm run prettier:check`, `commitlint`, `npm run typecheck`, `npm test` com o H2 2.5.252 baixado do Maven Central e conferido por sha256 (`ENOIS_H2_JAR`), `npm run test:release`, `npm run test:workflows` e `npm run test:package`. As suítes de integração (Docker, imagens e aplicações reais) não rodam no CI.

Para conferir os workflows localmente, rode `./tests-ci/lint-workflows.sh`. A política dos workflows (`npm run test:workflows`) exige actions fixadas por SHA completo, permissões explícitas mínimas e `id-token: write` só nos jobs `publish` e `recover` do `release.yml`.

## Release

O workflow `release` (`.github/workflows/release.yml`) tem três jobs, todos restritos a `renanfranca/enois-preview`, num grupo de concorrência que nunca cancela uma release em andamento:

- **`qualify`** (`contents: read`, `actions: read`): confere que o commit candidato é o head atual da `main`, tem um `build` de push verde e ainda não tem tag `v*`.
- **`publish`** (`contents: write`, `id-token: write`): confere de novo que o checkout ainda é a `origin/main` e roda o semantic-release, que ajusta a versão só no checkout efêmero, roda `test:package` e `npm pack --dry-run`, publica no npm com provenance (Trusted Publishing, sem token salvo), cria a tag e a release do GitHub com as notas geradas.
- **`recover`** (`contents: write`, `id-token: write`): completa uma release que falhou no meio (abaixo).

**Automática:** todo `build` verde de push na `main` dispara a release. Sem commit que gere versão, nada é publicado.

**Manual:** em Actions, rode `release` com `operation=release` a partir da `main`, com `version` vazio. Se há commits desde a última tag mas nenhum gera versão, sai um patch. Num head já lançado, o `qualify` para e manda usar `recover`.

**Recuperação:** rode `release` com `operation=recover` e `version=<x.y.z>`. A tag `v<x.y.z>` precisa existir. O job faz checkout dessa tag e publica só o que falta: o pacote npm dessa versão, a release do GitHub, ou os dois. Ele nunca cria tag nem versão nova.

**Versão ruim:** use `npm deprecate enois-preview@<versão> "<motivo>"` e lance um `fix`. Não use `npm unpublish`.

## Primeira versão e Trusted Publisher (uma vez)

O npm só aceita um Trusted Publisher num pacote que já existe, e sem ele o semantic-release para antes de criar a tag. Por isso o primeiro run automático depois do merge falha sem publicar nada, e a primeira versão sai à mão:

1. Com o `build` verde no head da `main`, calcule a versão pela tabela acima (desde a `v0.4.0` há `feat`, então `0.5.0`).
2. Crie e envie a tag nesse commit: `git tag v0.5.0 <sha-do-head>` e `git push origin v0.5.0`.
3. Num checkout limpo da tag: `npm ci`, `npm version 0.5.0 --no-git-tag-version`, `npm run test:package`, `npm pack --dry-run` e `npm publish`, com 2FA. Essa versão sai sem provenance, que só existe numa publicação feita pelo CI.
4. No npm, nas configurações do pacote `enois-preview`, adicione um Trusted Publisher do GitHub Actions com o repositório `renanfranca/enois-preview` e o workflow `release.yml`.
5. Rode `release` com `operation=recover` e `version=0.5.0`: o pacote já existe, então o job só cria a release do GitHub.

Daí em diante, toda release é automática, com provenance e sem token salvo.

## Regra de compatibilidade

Com a refixação automática, uma atualização da ferramenta troca o Worker que atende todos os cenários do catálogo, inclusive os de imagens com runtime antigo. Uma release que muda de forma incompatível o contrato entre o Worker e o runtime dentro da imagem precisa mudar o `FORMAT` e sair com um commit de breaking change. Um Worker continua atendendo toda entrada do catálogo no `FORMAT` que ele aceita.

## Formatação e histórico

O repositório segue o Prettier (`npm run prettier:check`); o hook de pre-commit formata os arquivos alterados. O commit `style: format with prettier` está em `.git-blame-ignore-revs`; use `git config blame.ignoreRevsFile .git-blame-ignore-revs` para o `git blame` pulá-lo. Por isso, o PR que trouxe esse commit precisa ser integrado com merge commit: squash ou rebase trocam o SHA e invalidam o arquivo. Se isso acontecer, atualize o arquivo com o SHA novo num commit `chore:`.
