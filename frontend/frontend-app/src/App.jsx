import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import './app.scss';

const api = axios.create({ baseURL: '/api' });

function App() {
  const [sessionId, setSessionId] = useState('');
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    (async () => {
      const existing = localStorage.getItem('sessionId');
      if (existing) {
        setSessionId(existing);
        const { data } = await api.get(`/history/${existing}`);
        setHistory(data.history || []);
        return;
      }
      const { data } = await api.post('/session');
      localStorage.setItem('sessionId', data.sessionId);
      setSessionId(data.sessionId);
    })();
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [history]);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = { role: 'user', content: input, ts: Date.now() };
    setHistory((h) => [...h, userMsg]);
    setInput('');
    const { data } = await api.post('/chat', { sessionId, message: userMsg.content });
    setHistory((h) => [...h, data]);
  };

  const reset = async () => {
    if (sessionId) await api.delete(`/history/${sessionId}`);
    const { data } = await api.post('/session');
    localStorage.setItem('sessionId', data.sessionId);
    setSessionId(data.sessionId);
    setHistory([]);
  };

  const loadHistory = async () => {
    if (!sessionId) return;
    const { data } = await api.get(`/history/${sessionId}`, { params: { t: Date.now() } });
    setHistory(data.history || []);
  };

  return (
    <div className="container">
      <header>
        <h2>News RAG Chatbot</h2>
        <div className="actions">
          <span style={{ fontSize: 12, color: '#666', marginRight: 8 }}>session: {sessionId?.slice(0, 8)}…</span>
          <button onClick={loadHistory}>Load History</button>
          <button onClick={reset}>Reset Session</button>
        </div>
      </header>
      <div className="chat" ref={listRef}>
        {history.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">
              <div className="content">{m.content}</div>
              {m.contexts?.length ? (
                <details>
                  <summary>Sources ({m.contexts.length})</summary>
                  <ul>
                    {m.contexts.map((c, j) => (
                      <li key={j}><a href={c.source} target="_blank" rel="noreferrer">{c.title || c.source}</a></li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <footer>
        <input
          value={input}
          placeholder="Ask about the latest news..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' ? send() : null}
        />
        <button onClick={send}>Send</button>
      </footer>
    </div>
  );
}

export default App;

