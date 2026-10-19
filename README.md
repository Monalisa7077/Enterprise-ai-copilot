# Enterprise Knowledge Copilot

This repository is a monorepo for an enterprise knowledge assistant built with React, TypeScript, Express, MongoDB, Qdrant, and AI-grounded document retrieval.

## Assumptions and architecture decisions

- Authentication uses JWT access + refresh tokens with token rotation.
- MongoDB stores relational metadata while Qdrant stores vector documents and chunk metadata.
- Retrieval is grounded and answer generation is citation-aware.
- The project uses a junior-friendly structure to make learning easier without sacrificing professional patterns.

## Monorepo structure

```text
.
├── apps
│   ├── api
│   │   ├── src
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web
│       ├── src
│       ├── .env.example
│       ├── package.json
│       ├── vite.config.ts
│       └── tailwind.config.js
├── packages
│   ├── config
│   │   └── src
│   └── shared
│       └── src
├── docs
│   ├── architecture.md
│   ├── api-contract.md
│   └── implementation-plan.md
├── .github
│   └── workflows
│       └── ci.yml
├── docker-compose.yml
├── .gitignore
├── .prettierrc
├── README.md
├── package.json
├── tsconfig.base.json
└── LICENSE (optional)
```

## Quick start

1. Install dependencies:
   npm install
2. Start local infrastructure:
   docker compose up -d mongo qdrant redis
3. Copy environment files if needed.
4. Start the API:
   npm run dev
5. In a separate terminal, start the document ingestion worker:
   npm run dev:worker --workspace apps/api
6. Start the web app:
   npm run dev:web

## Environment variables

Backend:

- PORT
- NODE_ENV
- JWT_SECRET
- JWT_REFRESH_SECRET
- MONGODB_URI
- QDRANT_URL
- REDIS_URL
- UPLOAD_DIR
- EMBEDDING_PROVIDER
- EMBEDDING_MODEL
- OPENAI_API_KEY or GEMINI_API_KEY (required by the ingestion worker for the selected provider)
- CLIENT_URL
- CORS_ORIGINS
- LOG_LEVEL

The worker uses MongoDB, Redis, Qdrant, the configured upload directory, and
the selected embedding provider. Start local services with
`docker compose up -d mongo qdrant redis`. The API worker can be run for
development with `npm run dev:worker --workspace apps/api`; a compiled worker
can be started with `npm run worker --workspace apps/api`.

Frontend:

- VITE_API_BASE_URL

## Verification

The repository currently passes the project build and test checks with the commands below:

- npm run build
- npm run test

## Milestone status

- Milestone 0: Architecture and planning complete
- Milestone 1: Monorepo setup complete
- Milestone 2: Backend foundation complete
- Milestone 3: Authentication and RBAC complete
- Milestone 4: Workspace and document metadata APIs, owner authorization, upload validation, and duplicate detection complete
- Milestone 8: Frontend foundation complete
- Document extraction, ingestion, retrieval, and chat milestones remain as the next implementation phases

## Security notes

- Secrets are managed through environment variables.
- JWT refresh tokens are rotated on refresh.
- Document content is treated as untrusted input.
- Role checks are required for every protected operation.
