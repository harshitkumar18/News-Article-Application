RAG Python service
------------------
Create venv and run API:

py -3 -m venv backend\rag\.venv
backend\rag\.venv\Scripts\python.exe -m pip install --upgrade pip
backend\rag\.venv\Scripts\python.exe -m pip install fastapi uvicorn chromadb sentence-transformers beautifulsoup4 feedparser requests python-dotenv tiktoken
backend\rag\.venv\Scripts\python.exe backend\rag\app.py

Ingest 50 articles from an RSS (example: BBC World):
POST http://127.0.0.1:8000/ingest
{
  "rss_url": "https://feeds.bbci.co.uk/news/world/rss.xml",
  "limit": 50
}

Backend Node server
-------------------
Create .env in backend with:
PORT=4000
REDIS_URL=redis://127.0.0.1:6379
RAG_BASE_URL=http://127.0.0.1:8000
GEMINI_API_KEY=YOUR_KEY
GEMINI_MODEL=gemini-1.5-flash

Run backend:
cd backend
npm i
npm run dev

Frontend
--------
cd frontend\frontend-app
npm install
npm run dev





