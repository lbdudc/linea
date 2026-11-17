# LINEA System Documentation

LINEA is a Software Product Line ALM (Application Lifecycle Management) platform. It manages the lifecycle of a **Software Product Line (SPL)**: a shared code base (the *line*) that generates multiple concrete software products, each configured by a feature selection.

---

## Core Concepts

| Term | Meaning |
|------|---------|
| **Line** | The SPL itself — a GitLab repository containing platform templates, a feature model, and generation logic |
| **Product** | A concrete variant derived from a line — its own GitLab repo, a feature selection, and a spec |
| **Feature Model** | A UVL or XML file (`src/platform/model.uvl`) that declares optional/mandatory features and their constraints |
| **Generation** | The process of transforming the platform templates + product spec into real code on the product repo |
| **bigbang** | The dedicated branch in a product repo that receives generated commits; merged into `main` |
| **Conflict** | When `bigbang → main` has merge conflicts (manual edits on `main` vs. new generated code) |

---

## Documentation Index

| File | What it covers |
|------|----------------|
| [architecture.md](architecture.md) | Module layout, data model, tech stack, how services talk to each other |
| [api-reference.md](api-reference.md) | Full REST API surface |

---

## Quick Start

1. Ensure MongoDB (with replica set) and a GitLab instance are running
2. `cp server/.env.example server/.env` (not in git) and fill it in — the required vars are `GITLAB_HOSTNAME`, `GITLAB_CLIENT_ID`, `GITLAB_SECRET_ID`, `JWT_SIGN_KEY`, `ANTHROPIC_API_KEY`, and `GITLAB_WEBHOOK_SECRET`
3. `docker compose -f deploy/docker-compose.yml up -d` (or `npm run dev` locally)
4. Log in via GitLab OAuth
5. Create a Line (points at an existing GitLab group/repo)
6. Create Products under that line; generate them; resolve conflicts

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node 20, Express, TypeDI (DI container) |
| Database | MongoDB 7 via Mongoose 8 (replica set required for transactions) |
| Real-time | Socket.IO 4 |
| LLM | Anthropic Claude via `@anthropic-ai/sdk` (model `claude-sonnet-4-6`, 8192 max tokens) |
| GitLab | `gitlab-commando` library for all GitLab REST calls |
| SPL engine | `spl-js-engine` for `completeFeatureSelection` validation |
| FM analysis | `flamapy-server` — dedicated Python 3.11 / FastAPI service; called by the Node server over HTTP (`FLAMAPY_API_URL`) |
| Client | Vue 3 + Quasar, `<script setup>`, Composition API |
