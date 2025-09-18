# Frontend (React + Vite) – News RAG Chatbot

This is the chat UI for the News RAG app. It displays messages, lets users ask questions, shows sources for answers, and provides controls to load history and reset the session.

## Scripts
```
npm install
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

## API base
- Dev: Vite proxy forwards `/api` → `http://localhost:4000` (see `vite.config.js`).
- Prod: Set `VITE_API_BASE=https://your-backend.example.com` and update axios creation:
```
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE || '/api' });
```

## UI behavior
- On mount:
  - If `localStorage.sessionId` exists → set it and auto‑load history (`GET /api/history/:sessionId`).
  - Else → `POST /api/session`, store `sessionId` in `localStorage`.
- Send:
  - Append a user message locally, call `POST /api/chat` ({ sessionId, message }).
  - Append assistant message on response (includes optional `contexts` with sources).
- Load History button:
  - Calls `GET /api/history/:sessionId` with a cache‑buster param, then renders messages.
- Reset Session button:
  - `DELETE /api/history/:sessionId` then `POST /api/session`, updates `localStorage` and clears UI history.

## How the frontend calls API and handles responses
- Axios is used for HTTP.
- Endpoints:
  - `POST /api/session` → `{ sessionId }`
  - `GET /api/history/:sessionId` → `{ history: Message[] }`
  - `DELETE /api/history/:sessionId` → `{ ok: true }`
  - `POST /api/chat` → assistant message with optional `contexts`
- Messages are rendered in order; assistant replies show an expandable Sources section with links.

## Noteworthy design decisions
- LocalStorage keeps a single current session to survive reloads.
- Manual Load History is provided as a pull‑to‑sync, since there’s no streaming or subscription.
- Minimal SCSS for a clean, readable chat UI.

## Potential improvements
- Streaming responses (SSE/WebSocket) with a typing indicator.
- Session picker and transcript export.
- UI for scraping/indexing status from the RAG service.
- Error toasts when Gemini returns a fallback or the backend is unreachable.
