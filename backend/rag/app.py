import os
import re
import feedparser
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import chromadb
from chromadb.utils import embedding_functions

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(__file__)
CHROMA_DIR = os.path.join(BASE_DIR, 'chroma_store')
CORPUS_DIR = os.path.join(BASE_DIR, 'corpus')
EMBED_MODEL = os.environ.get('EMBED_MODEL', 'all-MiniLM-L6-v2')
CHROMA_PERSIST = os.environ.get('CHROMA_PERSIST', 'true').lower() in ('1', 'true', 'yes')

# Lazy, memory-friendly singletons
_client = None
_embedding_fn = None
_collection = None

def get_collection():
    global _client, _embedding_fn, _collection
    if _client is None:
        if CHROMA_PERSIST:
            _client = chromadb.PersistentClient(path=CHROMA_DIR)
        else:
            _client = chromadb.Client()
    if _embedding_fn is None:
        # Defer model load until first use
        _embedding_fn = embedding_functions.SentenceTransformerEmbeddingFunction(model_name=EMBED_MODEL)
    if _collection is None:
        _collection = _client.get_or_create_collection(name="news", embedding_function=_embedding_fn)
    return _collection

def get_client():
    global _client
    if _client is None:
        if CHROMA_PERSIST:
            _client = chromadb.PersistentClient(path=CHROMA_DIR)
        else:
            _client = chromadb.Client()
    return _client


class IngestBody(BaseModel):
    rss_url: str
    limit: int = 50


class ScrapeBody(BaseModel):
    rss_urls: list[str] | None = None
    rss_url: str | None = None
    limit: int = 50


def fetch_article_text(url: str) -> str:
    try:
        html = requests.get(url, timeout=10).text
        soup = BeautifulSoup(html, 'html.parser')
        # naive extraction
        paragraphs = [p.get_text(strip=True) for p in soup.find_all('p')]
        return '\n'.join([p for p in paragraphs if len(p.split()) > 5])
    except Exception:
        return ''


def slugify(value: str) -> str:
    value = re.sub(r'[^\w\s-]', '', value).strip().lower()
    return re.sub(r'[\s_-]+', '-', value)[:80] or 'article'


@app.post('/ingest')
def ingest(body: IngestBody):
    os.makedirs(CORPUS_DIR, exist_ok=True)
    # Clear corpus directory so we only keep the current batch
    for fname in os.listdir(CORPUS_DIR):
        try:
            os.remove(os.path.join(CORPUS_DIR, fname))
        except Exception:
            pass

    feed = feedparser.parse(body.rss_url)
    entries = feed.entries[: body.limit]

    saved_files = []
    for i, e in enumerate(entries):
        link = getattr(e, 'link', None)
        title = getattr(e, 'title', '')
        if not link:
            continue
        article = fetch_article_text(link)
        if not article:
            article = getattr(e, 'summary', '')
        if not article:
            continue
        safe = slugify(title if title else f"article-{i}")
        path = os.path.join(CORPUS_DIR, f"{i:03d}-{safe}.txt")
        try:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(f"TITLE: {title}\nSOURCE: {link}\n\n{article}")
            saved_files.append((path, title, link))
        except Exception:
            continue

    # Rebuild Chroma collection strictly from files in corpus dir
    # Drop and recreate collection so it contains only these docs
    col = get_collection()
    try:
        col._client.delete_collection("news")  # type: ignore[attr-defined]
    except Exception:
        pass
    col = get_collection()

    texts, ids, metadatas = [], [], []
    for idx, (path, title, link) in enumerate(saved_files):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            texts.append(content)
            ids.append(f"file_{idx}_{hash(path) % 10_000_000}")
            metadatas.append({"source": link, "title": title, "path": path})
        except Exception:
            continue

    if texts:
        col.add(documents=texts, metadatas=metadatas, ids=ids)

    return {"saved_files": len(saved_files), "indexed": len(texts), "dir": CORPUS_DIR}


def scrape_to_corpus(rss_urls: list[str], limit: int) -> int:
    os.makedirs(CORPUS_DIR, exist_ok=True)
    # Clear corpus directory
    for fname in os.listdir(CORPUS_DIR):
        try:
            os.remove(os.path.join(CORPUS_DIR, fname))
        except Exception:
            pass

    saved = 0
    file_index = 0
    for rss in rss_urls:
        if saved >= limit:
            break
        feed = feedparser.parse(rss)
        for e in feed.entries:
            if saved >= limit:
                break
            link = getattr(e, 'link', None)
            title = getattr(e, 'title', '')
            if not link:
                continue
            article = fetch_article_text(link)
            if not article:
                article = getattr(e, 'summary', '')
            if not article:
                continue
            safe = slugify(title if title else f"article-{file_index}")
            path = os.path.join(CORPUS_DIR, f"{file_index:03d}-{safe}.txt")
            try:
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(f"TITLE: {title}\nSOURCE: {link}\n\n{article}")
                saved += 1
                file_index += 1
            except Exception:
                continue
    return saved


@app.post('/scrape')
def scrape(body: ScrapeBody):
    # Aggregate RSS sources; if only one provided, use it
    sources = []
    if body.rss_urls and isinstance(body.rss_urls, list) and body.rss_urls:
        sources.extend(body.rss_urls)
    if body.rss_url and body.rss_url not in sources:
        sources.append(body.rss_url)
    if not sources:
        # sensible defaults to reach 50 quickly across sections
        sources = [
            'https://feeds.bbci.co.uk/news/world/rss.xml',
            'https://feeds.bbci.co.uk/news/technology/rss.xml',
            'https://feeds.bbci.co.uk/news/business/rss.xml',
            'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
        ]
    saved = scrape_to_corpus(sources, body.limit)
    return {"saved_files": saved, "dir": CORPUS_DIR}


@app.post('/index')
def index_from_corpus():
    # Rebuild collection strictly from files in CORPUS_DIR
    if not os.path.isdir(CORPUS_DIR):
        return {"indexed": 0, "dir": CORPUS_DIR, "error": "corpus directory not found"}

    cli = get_client()
    try:
        cli.delete_collection("news")
    except Exception:
        pass
    col = get_collection()

    texts, ids, metadatas = [], [], []
    files = sorted([f for f in os.listdir(CORPUS_DIR) if f.lower().endswith('.txt')])
    for idx, fname in enumerate(files):
        path = os.path.join(CORPUS_DIR, fname)
        try:
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            # Try to parse title/source from file header
            title = None
            source = None
            try:
                for line in content.splitlines()[:5]:
                    if line.startswith('TITLE: '):
                        title = line[len('TITLE: '):].strip()
                    elif line.startswith('SOURCE: '):
                        source = line[len('SOURCE: '):].strip()
            except Exception:
                pass
            texts.append(content)
            ids.append(f"file_{idx}_{hash(path) % 10_000_000}")
            metadatas.append({"source": source, "title": title, "path": path})
        except Exception:
            continue

    if texts:
        col.add(documents=texts, metadatas=metadatas, ids=ids)
    return {"indexed": len(texts), "dir": CORPUS_DIR}


class RetrieveBody(BaseModel):
    query: str
    top_k: int = 5


@app.post('/retrieve')
def retrieve(body: RetrieveBody):
    col = get_collection()
    qres = col.query(query_texts=[body.query], n_results=body.top_k)
    contexts = []
    docs = qres.get('documents', [[]])[0]
    metas = qres.get('metadatas', [[]])[0]
    for text, meta in zip(docs, metas):
        contexts.append({"text": text, "source": meta.get('source'), "title": meta.get('title')})
    return {"contexts": contexts}


@app.get('/health')
def health():
    return {"ok": True}


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)


