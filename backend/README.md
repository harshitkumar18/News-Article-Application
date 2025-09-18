# Backend (Node.js Express) – News RAG Chatbot

This service exposes the REST API used by the React frontend. It manages chat sessions, retrieves top‑k context from the RAG service, calls Gemini for final answers, and stores per‑session chat history in Redis (or an in‑memory fallback).

## Structure

- `src/server.js` – Express app, middleware, health
- `src/routes/chat.js` – Chat/session/history endpoints, RAG + Gemini logic
- `src/services/store.js` – Redis/in‑memory session store with TTL

## Environment

Create `backend/.env`:
```
PORT=4000
RAG_BASE_URL=http://127.0.0.1:8000
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-1.5-flash
SESSION_TTL_SECONDS=86400
# Optional. If omitted or unreachable, in‑memory fallback is used.
# REDIS_URL=redis://127.0.0.1:6379
```

## Run locally
```
cd backend
npm install
npm run dev
# Health: http://localhost:4000/api/health
```

## API

- `POST /api/session` → `{ sessionId }` – creates a new session and clears any prior history
- `GET /api/history/:sessionId` → `{ history: Message[] }` – returns stored messages
- `DELETE /api/history/:sessionId` → `{ ok: true }` – clears a session’s messages
- `POST /api/chat` – body: `{ sessionId, message, topK? }` returns assistant message with sources

Message shape:
```
{ role: 'user' | 'assistant', content: string, ts: number, contexts?: Context[], error?: boolean, fallback?: boolean }
```

## How embeddings are created, indexed, and stored
- The backend does not embed directly. It calls the Python RAG service (`RAG_BASE_URL`).
- The RAG service:
  - Scrapes ~50 news articles as `.txt` files into `corpus/`
  - Builds embeddings via `sentence-transformers` (default `all-MiniLM-L6-v2`)
  - Stores vectors + metadata in ChromaDB (collection `news`)
  - `POST /retrieve` returns top‑k passages for a query

## How Redis caching & session history works
- Key format: `chat:{sessionId}`
- Write path:
  - Redis: `RPUSH chat:{sessionId} <json>` and `EXPIRE chat:{sessionId} SESSION_TTL_SECONDS`
  - In‑memory: a Map holds `items: string[]` and a `setTimeout` deletes after TTL
- Read path:
  - Redis: `LRANGE` → parse each JSON
  - Memory: read and parse from Map
- TTL refreshes on each write. After TTL, the key disappears and history becomes `[]` until new messages arrive.
- Auto‑selection:
  - If `REDIS_URL` connects at startup, Redis is used
  - Otherwise an in‑memory adapter is used immediately (no retry spam)

## How the backend calls the RAG service and Gemini
1. Store the user message to history
2. `POST { RAG_BASE_URL }/retrieve` to get top‑k contexts
3. Build a grounded prompt with the contexts + user question
4. Call Gemini via `@google/generative-ai`
5. Store assistant reply and return it to the client
6. If Gemini returns 503/429, reply with a fallback message listing the top sources

## Frontend integration
- Frontend sends `POST /api/chat` with the current `sessionId` (kept in `localStorage`)
- “Load History” calls `GET /api/history/:sessionId`
- “Reset Session” deletes history and creates a new `sessionId`

## Noteworthy design decisions
- Decoupled pipeline: Python handles ingestion/embeddings/ANN; Node handles sessioning/LLM
- In‑memory fallback ensures local dev and free-tier deploys work without Redis
- Graceful Gemini fallback prevents 503s from crashing the server
- `topK=3` by default to reduce latency; configurable per request

## Potential improvements
- SSE/WebSocket streaming for partial tokens
- Conditional chunking for very long articles (e.g., 1,000–1,500 chars, 150–200 overlap)
- SQL persistence for transcripts; endpoint to list/reopen old sessions
- Caching of retrieval per (sessionId, query) to speed repeated questions
