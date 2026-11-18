# featuremodel

Feature model metamodels for [Bango](https://github.com/lbdudc/bango) (`@lbdudc/bango`), one folder per kind of file, each named after its grammar.

| Metamodel | Level | What it is |
|---|---|---|
| `featuremodel` | 1 | The features of an SPL as a tree of groups (mandatory, optional, alternative, or, `[m..n]`) plus UVL-style constraints. |
| `featureselection` | 0 | The features a product selects from a feature model. Anything implied by the model need not be written. |

```
grammars/        featuremodel.langium, featureselection.langium, common.langium (shared terminals)
constraints/     validation the grammars cannot express
specs/           instance -> JSON
imports/         JSON -> instance
scopes/          which nodes each reference can point at
visualizations/  UVL, XML and feature-diagram views
cases/           sample instances and what they must report
examples/phones  a small feature model and a selection of it, with the JSON it maps to
```

Select `featuremodel` and `featureselection` in a Bango project; `featureselection` imports `featuremodel`, so it needs it. See Bango's `docs/writing-metamodels.md` and `docs/levels.md`.

The copy shipped with Bango lives in its `examples/seed`; keep the two in sync.
