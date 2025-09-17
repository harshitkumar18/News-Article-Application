import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { store } from '../services/store.js';

dotenv.config();

const router = Router();
const RAG_BASE_URL = process.env.RAG_BASE_URL || 'http://127.0.0.1:8000';

router.post('/session', async (_req, res) => {
  const sessionId = uuidv4();
  await store.clear(sessionId);
  res.json({ sessionId });
});

router.get('/history/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const history = await store.getHistory(sessionId);
  res.json({ history });
});

router.delete('/history/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  await store.clear(sessionId);
  res.json({ ok: true });
});

router.post('/chat', async (req, res) => {
  const { sessionId, message, topK = 5 } = req.body || {};
  if (!sessionId || !message) return res.status(400).json({ error: 'sessionId and message required' });

  await store.append(sessionId, { role: 'user', content: message, ts: Date.now() });

  const { data: retr } = await axios.post(`${RAG_BASE_URL}/retrieve`, { query: message, top_k: topK });
  const contexts = retr?.contexts || [];

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });

  const prompt = `You are a news assistant. Use the provided context passages to answer the user question. If unsure, say you don't know.\n\nContext:\n${contexts.map((c, i) => `(${i + 1}) ${c.text}\nSource: ${c.source}`).join('\n\n')}\n\nQuestion: ${message}\nAnswer:`;

  async function callWithRetry(maxAttempts = 2, baseDelayMs = 500) {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await model.generateContent(prompt);
        return result?.response?.text?.() || result?.response?.text?.call?.(result?.response) || '';
      } catch (err) {
        attempt += 1;
        const isRetryable = err?.status === 503 || err?.status === 429 || /overloaded|try again later/i.test(String(err?.message || ''));
        if (!isRetryable || attempt >= maxAttempts) throw err;
        const wait = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  try {
    const text = (await callWithRetry()) || 'Sorry, I could not generate an answer.';
    const botMsg = { role: 'assistant', content: text, contexts, ts: Date.now() };
    await store.append(sessionId, botMsg);
    res.json(botMsg);
  } catch (err) {
    // Fallback: respond with an extractive summary from contexts
    // eslint-disable-next-line no-console
    console.error('Gemini error:', err?.status, err?.message);
    const top = contexts.slice(0, Math.max(1, Math.min(3, contexts.length)));
    const stitched = top.map((c, i) => `(${i + 1}) ${c.text}\nSource: ${c.source}`).join('\n\n');
    const msg = `I couldn't reach the model right now. Here are the most relevant sources I found:\n\n${stitched}`;
    const botMsg = { role: 'assistant', content: msg, contexts: top, ts: Date.now(), fallback: true };
    await store.append(sessionId, botMsg);
    res.status(200).json(botMsg);
  }
});

export default router;


