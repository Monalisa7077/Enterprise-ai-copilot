# API contract overview

## Auth endpoints

- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout
- GET /api/v1/auth/me

## Health endpoints

- GET /health
- GET /ready

## Workspace APIs

All workspace endpoints require a bearer access token. Users can access only
their own workspaces.

- GET /api/v1/workspaces
- POST /api/v1/workspaces
- GET /api/v1/workspaces/:id

`POST /api/v1/workspaces` accepts `{ "name": "...", "description": "..." }`.
Names must be 2–100 characters and descriptions are limited to 500 characters.

## Document APIs

All document endpoints require a bearer access token. Document ownership is
checked on every operation. Uploads use `multipart/form-data` with a `file`
field and the target `workspaceId`.

- POST /api/v1/documents/upload
- GET /api/v1/documents
- GET /api/v1/documents/:id
- DELETE /api/v1/documents/:id

Uploads currently accept PDF, DOCX, and UTF-8 TXT files up to 10 MB. The API
checks the declared MIME type and extension, checks file signatures for PDF
and DOCX, and checks UTF-8 validity for TXT. File content is stored locally
under the API upload directory; MongoDB stores metadata, checksum, status, and
the generated storage key. Re-uploading the same content to the same workspace
returns HTTP 409. Successful uploads start in the `PENDING` state. Text
extraction and vector indexing are planned for a later milestone.

The document list supports optional `workspaceId`, `status`, `page`, and
`limit` query parameters. The page defaults to 1 and limit defaults to 20, with
a maximum limit of 100.

## Chat and retrieval APIs

- POST /api/v1/chats
- GET /api/v1/chats/:id
- POST /api/v1/chats/:id/messages
- POST /api/v1/search
- POST /api/v1/feedback
- GET /api/v1/admin/metrics

This contract is intentionally designed to expand incrementally as the ingestion, retrieval, and chat features are implemented.
