# linea-ci

CI steps for LINEA SPLs and the products they generate. The pipelines that use it are templates of `linea-core`
(`src/line/templates/pipeline/`): `.gitlab-ci.yml` (for products, derived with their code) and `spl-gitlab-ci.yml` (the root of an SPL
repository). `linea-core` holds the logic that needs no process or network (`checkLeftovers`, `validateSelection`, `selectProducts`,
`ablateFeature`, `activateFeature`, `renderChildPipeline`, ...); this package is the command line around it, which does spawn `git` and
`lizard`, and talks to the git host.

```
linea-ci check-leftovers <productDir> [--line <lineDir>]        annotations left in a derived product
linea-ci validate-specs --line <lineDir> <spec.json | folder>   feature selections of real products against the feature model
linea-ci derive --line <lineDir> --spec <spec.json> --out <dir>
linea-ci check-determinism --line <lineDir> --spec <spec.json>  two derivations must give the same product
linea-ci fetch-specs --line <lineDir> --out <dir>               .linea/spec.json (+ models) of each product in products.json
linea-ci select-products --line <lineDir> --specs <dir> (--base <sha> --head <sha> | --changed <file>,...) [--pipeline-out child.yml]
linea-ci metrics <dir> [--max-ccn <n>]                          cyclomatic complexity of a derived product (lizard)
linea-ci mr-metrics ...                                         base vs head complexity per product, and per touched feature
linea-ci mr-note <file.md>                                      post or update a note on the merge request
linea-ci commit-lint [--title <t>] [--base <sha> --head <sha>] [--strict]   commits and MR title follow Conventional Commits
linea-ci release-tag --line <lineDir>                           tag v<version> + release with changelog, if they do not exist
```

Exit code: 0 ok, 1 the check found problems (or failed), 2 used wrong.

## Two kinds of line

- **Platform layout** (`src/platform/model.uvl`, `config.json`, `code/`...): read as it is.
- **Made of modules / feature metamodel** (`spl.json`, `models/`, no `model.uvl` in the repository): the platform is composed from the
  registry of the git host (`--server`/`$CI_SERVER_URL` and a token) with bango and `linea-git`, and then treated as the first kind. The
  models of each product (`.linea/models/*`) travel with its spec: `fetch-specs` puts them in `<name>.models/`.

## Environment

| Variable | Used for |
|---|---|
| `CI_SERVER_URL`, `LINEA_CI_TOKEN` | reading products and the registry; the token also comments on merge requests |
| `CI_JOB_TOKEN` | fallback to read product repositories when there is no `LINEA_CI_TOKEN` |
| `LINEA_CI_LIZARD` | the command that runs lizard (default `lizard`; `pip install lizard`) |

## What a touched feature is measured on

The annotated code of an SPL cannot be measured as it is. `select-products` says which features the changed files test (file level, from
the engine's annotation analysis), and `mr-metrics` derives the selected products from the proposed code and from the target branch. A
touched feature that none of them has is measured on the smallest product with that feature added (`activateFeature`), and what each
touched feature brings is found by deriving a product with and without it (`ablateFeature`): what only the first has is the feature's.

## Commit convention and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope)!: description`, with `feat`, `fix`, `perf`,
`refactor`, `docs`, `chore`, `ci`, `test`, `build`, `style`, `revert`. The release notes are built from them (`feat` goes under
«Novedades», `fix` under «Correcciones», `!` or `BREAKING CHANGE:` under «Cambios incompatibles»; `chore`, `ci`, `test` and `docs` are
left out). With squash merge, the merge request title is the commit, so it must follow the convention too. What LINEA itself commits
uses `chore(generate):`, `chore(sync):` and `chore(release):`.

- `commit-lint` only warns (exit 0) unless `--strict`. It reads `$CI_MERGE_REQUEST_TITLE` and the commits of
  `$CI_MERGE_REQUEST_DIFF_BASE_SHA..$CI_COMMIT_SHA` (or `--title`, `--base`, `--head`). Merges, reverts and fixups are not checked.
- `release-tag` runs on `main` of an SPL. It takes the version of `spl.json`; if no release exists for that version in the
  project, it creates the tag (if missing) and the release, with the notes of the changelog generator of `linea-git` (the one LINEA uses). If LINEA
  already created the release, or the job runs again, it does nothing; a tag left without release by a failed run only gets its release. Needs `LINEA_CI_TOKEN` and `CI_SERVER_URL`, `CI_PROJECT_ID`, `CI_COMMIT_SHA`.

Pipeline jobs for the SPL template (`spl-gitlab-ci.yml`, in `linea-core`):

```yaml
commit-lint:
  rules: [{ if: $CI_PIPELINE_SOURCE == "merge_request_event" }]
  variables: { GIT_DEPTH: "0" }   # the base of the merge request must be in the clone
  script: [linea-ci commit-lint]
  allow_failure: true
release:
  rules: [{ if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH }]
  script: [linea-ci release-tag --line .]
```

## Tests

`npm test` (Node >= 20.11; the metrics tests are skipped when lizard is not installed).
