# News RAG Chatbot

A full-stack chatbot that answers queries over a news corpus using Retrieval-Augmented Generation (RAG) pipeline.

## Architecture

- **Frontend**: React + Vite + SCSS
- **Backend**: Node.js + Express (REST API)
- **RAG Service**: Python + FastAPI + ChromaDB + sentence-transformers
- **LLM**: Google Gemini API
- **Sessions**: Redis (optional) or in-memory with TTL
- **Vector DB**: ChromaDB (persistent)

## Features

- ✅ Scrape ~50 news articles from RSS feeds
- ✅ Store articles as .txt files in `backend/rag/corpus/`
- ✅ Embed with sentence-transformers and store in ChromaDB
- ✅ Retrieve top-k relevant passages for queries
- ✅ Generate answers using Gemini API with retrieved context
- ✅ Session-based chat history with TTL
- ✅ Reset session functionality
- ✅ Source attribution for answers
- ✅ Graceful fallback when Gemini is overloaded

## Quick Start (Local)

### Prerequisites
- Node.js 20.19+ or 22.12+
- Python 3.10+
- Redis (optional - falls back to in-memory)

### 1. RAG Service (Python)
```bash
# Create virtual environment
cd backend/rag
py -3 -m venv .venv
.venv\Scripts\Activate.ps1  # Windows PowerShell
# source .venv/bin/activate  # Linux/Mac

# Install dependencies
python -m pip install --upgrade pip
pip install fastapi uvicorn chromadb sentence-transformers beautifulsoup4 feedparser requests python-dotenv tiktoken

# Start RAG service
python app.py
```
Health: http://127.0.0.1:8000/health

### 2. Populate Corpus
```bash
# Scrape 50 articles into corpus
curl -X POST http://127.0.0.1:8000/scrape -H "Content-Type: application/json" -d '{"limit":50}'

# Build vector index from corpus files
curl -X POST http://127.0.0.1:8000/index
```

### 3. Backend (Node.js)
```bash
cd backend

# Create .env file
echo "PORT=4000
RAG_BASE_URL=http://127.0.0.1:8000
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-1.5-flash
SESSION_TTL_SECONDS=86400
# REDIS_URL=redis://127.0.0.1:6379" > .env

# Install and start
npm install
npm run dev
```
Health: http://localhost:4000/api/health

### 4. Frontend (React)
```bash
cd frontend/frontend-app
npm install
npm run dev
```
Open: http://localhost:5173

## Free Deployment

### 1. Redis (Upstash)
- Create free Redis at [Upstash](https://upstash.com/)
- Copy the `rediss://` URL

### 2. RAG Service (Render)
- Create new Web Service
- Root directory: `backend/rag`
- Build: `pip install --upgrade pip && pip install fastapi uvicorn chromadb sentence-transformers beautifulsoup4 feedparser requests python-dotenv tiktoken`
- Start: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Env: `EMBED_MODEL=all-MiniLM-L6-v2`

After deploy, warm up:
```bash
curl -X POST https://your-rag.onrender.com/scrape -H "Content-Type: application/json" -d '{"limit":50}'
curl -X POST https://your-rag.onrender.com/index
```

### 3. Backend (Render)
- Create new Web Service
- Root directory: `backend`
- Build: `npm install`
- Start: `node src/server.js`
- Environment:
  - `PORT=$PORT`
  - `RAG_BASE_URL=https://your-rag.onrender.com`
  - `GEMINI_API_KEY=your_key`
  - `GEMINI_MODEL=gemini-1.5-flash`
  - `REDIS_URL=rediss://:password@host:port`
  - `SESSION_TTL_SECONDS=86400`

### 4. Frontend (Vercel)
- Import repo, set root to `frontend/frontend-app`
- Build: `npm run build`
- Output: `dist`
- Environment: `VITE_API_BASE=https://your-backend.onrender.com`

Update `frontend/frontend-app/src/App.jsx`:
```js
const api = axios.create({ 
  baseURL: import.meta.env.VITE_API_BASE || '/api' 
});
```

## API Endpoints

### RAG Service (Port 8000)
- `POST /scrape` - Scrape articles to corpus
- `POST /index` - Build vector index from corpus
- `POST /retrieve` - Retrieve top-k contexts
- `GET /health` - Health check

### Backend (Port 4000)
- `POST /api/session` - Create new session
- `GET /api/history/:sessionId` - Get session history
- `DELETE /api/history/:sessionId` - Clear session
- `POST /api/chat` - Send message and get response

## Configuration

### TTL and Caching
- `SESSION_TTL_SECONDS`: How long sessions persist (default: 86400 = 24h)
- Sessions auto-expire after TTL; new messages recreate the session
- Redis TTL is refreshed on each write

### Cache Warming
- Free hosts reset ChromaDB on restarts
- Call `/scrape` then `/index` after each RAG service restart
- Consider adding a `/warmup` endpoint for automation

### Performance
- `topK=3` for faster retrieval (configurable in chat endpoint)
- Fallback responses when Gemini is overloaded
- In-memory session fallback when Redis unavailable

## File Structure
```
├── backend/
│   ├── src/
│   │   ├── server.js          # Express server
│   │   ├── routes/chat.js     # Chat endpoints
│   │   └── services/store.js  # Redis/in-memory storage
│   ├── rag/
│   │   ├── app.py             # FastAPI RAG service
│   │   ├── corpus/            # Raw .txt articles
│   │   └── chroma_store/      # Vector database
│   └── package.json
├── frontend/frontend-app/
│   ├── src/
│   │   ├── App.jsx            # Chat UI
│   │   └── app.scss           # Styles
│   └── vite.config.js        # Proxy config
└── README.md
```

## Tech Stack Justification

- **Embeddings**: sentence-transformers (open-source, no API limits)
- **Vector DB**: ChromaDB (persistent, easy setup)
- **LLM**: Google Gemini (free tier, good quality)
- **Backend**: Node.js + Express (fast, familiar)
- **Sessions**: Redis (optional) + in-memory fallback
- **Frontend**: React + Vite (modern, fast dev)

## Troubleshooting

- **PowerShell blocks npm**: Use `npm.cmd` or `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`
- **Vite requires Node 20+**: Upgrade Node or downgrade Vite deps
- **Redis connection errors**: Remove `REDIS_URL` to use in-memory
- **Gemini 503 errors**: App has retry + fallback responses
- **Empty history**: Click "Reset Session", send message, then "Load History"
