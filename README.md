# RAgent AI Platform

An enterprise AI agent platform (智能体中台) built with Next.js. It lets organizations build and operate AI agent applications on top of their own knowledge and business processes — from RAG-powered knowledge bases and intelligent Q&A to visual workflow orchestration, process management, and multi-tenant administration.

## Core Features

- 🤖 **AI Agent Apps** — build, configure, and publish agent applications, including embeddable chatbots
- 📚 **Knowledge Base Management** — document upload, vector indexing, access control, RAG-powered Q&A with streaming responses
- 🔄 **Workflow Orchestration** — visual workflow editor for multi-step automation
- 📋 **Process Management** — business process trees, document review and revision flows, handbook generation
- 🧰 **Prompts & Tools** — centralized prompt library and tool management for agents
- 👥 **Multi-tenant Support** — organization management with a complete RBAC permission system
- 📄 **Document Preview & Editing** — Office file preview (kkFileView) and online editing (OnlyOffice)
- 📊 **Monitoring** — usage and license status dashboards
- 🌐 **i18n** — Simplified Chinese and English out of the box

## Architecture

This repository is the **web frontend**. A full deployment consists of:

| Service | Role | Configured via |
|---|---|---|
| ragent (this repo) | Next.js web app + API routes | — |
| ragent-service | FastAPI backend (RAG pipeline, LLM calls) | `EXTERNAL_API_BASE_URL` |
| PostgreSQL + pgvector | Data and vector storage | `DATABASE_URL` |
| OnlyOffice Document Server | Online editing, docx→PDF conversion | `ONLYOFFICE_INTERNAL_URL`, `ONLYOFFICE_JWT_SECRET` |
| kkFileView | File preview | `KKFILEVIEW_BASE_URL` |
| markdown-to-pdf | PDF report generation | `PDF_SERVICE_URL` |

The auxiliary services are wired together in `docker/docker-compose.yml` (production) and `docker/docker-compose.dev.yml` (development).

## Tech Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS, Radix UI
- **Backend**: Next.js API routes, PostgreSQL (pgvector)
- **AI**: OpenAI-compatible embeddings, multiple LLM providers via ragent-service

## Quick Start

### Prerequisites

- Node.js 20+ and pnpm
- PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension
- Docker (optional, for the auxiliary services)

### Environment Setup

```bash
cp env.example .env
# Edit .env — see inline comments in env.example for every variable
```

Required variables (the app fails fast when they are missing instead of falling back to insecure defaults):

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — session token signing key. **Must be identical to `JWT_SECRET_KEY` in ragent-service**, otherwise logins are rejected with 401
- `ONLYOFFICE_JWT_SECRET` — required by the OnlyOffice-related API routes; must match the `JWT_SECRET` passed to the OnlyOffice container

### Local Development

```bash
pnpm install
pnpm dev
```

### Tests & Checks

```bash
pnpm test        # node --test
pnpm check:ci    # biome lint + format check
```

## Deployment

For detailed instructions see [deploy/README.md](./deploy/README.md).

```bash
# PM2 deployment
./deploy/start.sh

# Docker deployment (pulls image and starts the compose stack)
./deploy/start-docker.sh

# Pin the running image to a specific build tag (short git SHA)
./deploy/pull-tag.sh <tag>

# Roll back to a previous image
./deploy/rollback.sh
```

## Project Structure

```
app/          # Next.js App Router pages and components
pages/api/    # API routes (auth, knowledge, chat, internal services)
lib/          # Shared server-side logic (db, auth, document versions…)
components/   # Shared UI components
messages/     # i18n resources (zh-CN, en)
docker/       # Compose files for the full service stack
deploy/       # Deployment scripts
scripts/      # Data import / maintenance scripts
```

## Author

squarezw
www.ragents.net
