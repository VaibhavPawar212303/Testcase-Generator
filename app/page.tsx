'use client';

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal, 
  Database, 
  Send, 
  Upload, 
  Trash2, 
  Plus, 
  Cpu, 
  ChevronRight,
  Loader2,
  FileText,
  Search,
  Activity,
  User,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Helper for tailwind class merging
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface DocChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    source: string;
    createdAt: number;
  };
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  id: string;
  retrievalContext?: { text: string; source: string; score: number }[];
}

// Gemini Configuration - In Next.js client side, 
// we normally shouldn't expose API keys, but given this specific environment's constraints 
// we continue to use the provided pattern.
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '' });

// Optimization: In Next.js, we should move the API key to server-side if possible,
// but for now I'll stick to the original logic which assumes client-side AI usage for speed.
// Note: I will use NEXT_PUBLIC_ prefix if I decide to keep it client-side or stick to process.env.GEMINI_API_KEY if the env supports it.
// Given the environment constraints, process.env.GEMINI_API_KEY is available.

export default function Page() {
  const [activeTab, setActiveTab] = useState<'chat' | 'stats' | 'profile'>('chat');
  const [knowledgeBase, setKnowledgeBase] = useState<DocChunk[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: 'system', content: '// KNOWLEDGE TERMINAL v1.0.4 READY TO PROCESS.' }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [uploadSource, setUploadSource] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocText, setEditingDocText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    fetchKnowledge();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchKnowledge = () => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem('knowledge_base');
      if (stored) {
        setKnowledgeBase(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load knowledge base from storage", e);
    }
  };

  const saveKnowledge = (docs: DocChunk[]) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('knowledge_base', JSON.stringify(docs));
      setKnowledgeBase(docs);
    } catch (e) {
      console.error("Failed to save knowledge base to storage", e);
    }
  };

  // Embeddings Logic
  const getEmbedding = async (text: string) => {
    try {
      const result = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: [text],
      });
      return result.embeddings[0].values;
    } catch (err) {
      console.error("Embedding generation failed", err);
      return [];
    }
  };

  const cosineSimilarity = (vecA: number[], vecB: number[]) => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  const handleIngestUrl = async () => {
    if (!urlInput.trim()) return;
    setIsFetchingUrl(true);
    try {
      const response = await fetch('/api/fetch-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput })
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `// ANALYZING CONTENT FROM: ${urlInput}` }]);
      
      const extraction = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Extract the most important technical or factual information from this raw text and format it as 3-5 distinct paragraphs. Each paragraph should be a self-contained "fact" or "knowledge piece".\n\nRAW TEXT:\n${data.text}`,
        config: {
          systemInstruction: "You are a data extraction specialist. Convert messy website text into clean, factual paragraphs for a knowledge base."
        }
      });
      
      const textResponse = extraction.text;

      const chunks = textResponse.split('\n\n').filter(p => p.trim());
      const newDocs: DocChunk[] = [];
      
      for (const chunkText of chunks) {
        const embedding = await getEmbedding(chunkText);
        newDocs.push({
          id: crypto.randomUUID(),
          text: chunkText,
          embedding,
          metadata: {
            source: urlInput,
            createdAt: Date.now()
          }
        });
      }

      const updatedKB = [...knowledgeBase, ...newDocs];
      await saveKnowledge(updatedKB);
      setUrlInput('');
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `// SUCCESSFULLY INGESTED ${newDocs.length} CHUNKS FROM WEB.` }]);
    } catch (err) {
      console.error("URL Ingestion failed", err);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `// ERROR: INGESTION FAILED [${(err as Error).message}]` }]);
    } finally {
      setIsFetchingUrl(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadText || !uploadSource) return;
    setIsProcessing(true);
    
    const chunks = uploadText.split('\n\n').filter(p => p.trim());
    const newDocs: DocChunk[] = [];
    
    for (const chunkText of chunks) {
      const embedding = await getEmbedding(chunkText);
      newDocs.push({
        id: crypto.randomUUID(),
        text: chunkText,
        embedding,
        metadata: {
          source: uploadSource,
          createdAt: Date.now()
        }
      });
    }

    const updatedKB = [...knowledgeBase, ...newDocs];
    await saveKnowledge(updatedKB);
    setUploadText('');
    setUploadSource('');
    setIsProcessing(false);
  };

  const handleDeleteDoc = async (id: string) => {
    const updated = knowledgeBase.filter(d => d.id !== id);
    await saveKnowledge(updated);
  };

  const handleUpdateDoc = async (id: string) => {
    const updated = await Promise.all(knowledgeBase.map(async (doc) => {
      if (doc.id === id) {
        const embedding = await getEmbedding(editingDocText);
        return { ...doc, text: editingDocText, embedding };
      }
      return doc;
    }));
    
    await saveKnowledge(updated);
    setEditingDocId(null);
  };

  const handleUpdateMessage = (id: string) => {
    setMessages(prev => prev.map(msg => msg.id === id ? { ...msg, content: editingMessageText } : msg));
    setEditingMessageId(null);
  };

  const handleChatRequest = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsProcessing(true);

    try {
      const queryEmbedding = await getEmbedding(userMsg.content);
      
      const rankedDocs = knowledgeBase
        .map(doc => ({
          ...doc,
          score: cosineSimilarity(queryEmbedding, doc.embedding)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const context = rankedDocs.length > 0 
        ? rankedDocs.map(d => `[SOURCE: ${d.metadata.source}]\n${d.text}`).join('\n\n')
        : "No relevant documents found in knowledge base.";

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `You are a RAG Knowledge Terminal. Answer the user prompt based strictly on the provided knowledge base context. If the answer is not in the context, say you don't know based on human data.\n\nCONTEXT:\n${context}\n\nUSER PROMPT:\n${userMsg.content}`,
        config: {
          systemInstruction: "You are a professional retrieval system. Provide citations like [Source: X]. Use clear, structured monochrome-friendly formatting."
        }
      });

      const assistantMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: response.text,
        retrievalContext: rankedDocs.map(d => ({ text: d.text, source: d.metadata.source, score: d.score }))
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      console.error("Chat failure", err);
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'system', 
        content: `// ERROR: UNABLE TO PROCESS REQUEST [${(err as Error).message}]` 
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto p-4 sm:p-6 md:p-8 selection:bg-accent selection:text-bg-primary">
      {/* Header Tabs */}
      <div className="flex items-center justify-between border-b border-border-main mb-8 overflow-hidden">
        <div className="flex gap-8 overflow-x-auto">
          {(['chat', 'stats', 'profile'] as const).map((tab) => (
            <button
              key={tab}
              id={`tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "pb-4 px-2 text-xs font-bold uppercase tracking-[0.2em] transition-all relative",
                activeTab === tab ? "text-text-active" : "text-text-dim hover:text-text-active"
              )}
            >
              {tab}
              {activeTab === tab && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-accent"
                />
              )}
            </button>
          ))}
        </div>
        <button 
          onClick={toggleTheme}
          className="pb-4 px-4 text-text-dim hover:text-text-active transition-colors flex items-center gap-2 text-[10px] uppercase font-black tracking-widest"
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          {theme}
        </button>
      </div>

      <main className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col h-full gap-6"
            >
              {/* Chat View */}
              <div className="flex-1 overflow-y-auto pr-4 space-y-8 scroll-smooth">
                {messages.map((msg) => (
                  <div key={msg.id} className="group">
                    {msg.role === 'system' ? (
                      <div className="text-text-dim text-[10px] font-mono tracking-widest border-l-2 border-border-main/10 pl-3 py-1 uppercase">{msg.content}</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 text-[9px] font-bold tracking-widest opacity-40 uppercase">
                          {msg.role === 'user' ? (
                            <span className="text-text-active flex items-center gap-1"><User size={10} /> AUTH_USER</span>
                          ) : (
                            <span className="text-text-active flex items-center gap-1"><Cpu size={10} /> KNOWLEDGE_CORE</span>
                          )}
                          <span>/</span>
                          <span>{new Date().toLocaleTimeString()}</span>
                        </div>
                        <div className={cn(
                          "text-[15px] markdown-body leading-relaxed relative group/msg",
                          msg.role === 'user' ? "text-text-active pl-0" : "text-text-active pl-4 border-l border-border-main"
                        )}>
                          {editingMessageId === msg.id ? (
                            <div className="space-y-2 mt-2">
                              <textarea
                                value={editingMessageText}
                                onChange={(e) => setEditingMessageText(e.target.value)}
                                className="w-full bg-bg-primary border-2 border-accent p-3 text-sm font-mono text-text-active outline-none min-h-[150px]"
                              />
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => handleUpdateMessage(msg.id)}
                                  className="px-3 py-1 bg-text-active text-bg-primary text-[10px] font-bold uppercase tracking-widest"
                                >
                                  Update
                                </button>
                                <button 
                                  onClick={() => setEditingMessageId(null)}
                                  className="px-3 py-1 border border-border-main text-text-dim text-[10px] font-bold uppercase tracking-widest"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <ReactMarkdown>{msg.content}</ReactMarkdown>
                              {msg.role === 'assistant' && (
                                <button 
                                  onClick={() => {
                                    setEditingMessageId(msg.id);
                                    setEditingMessageText(msg.content);
                                  }}
                                  className="absolute top-0 right-0 opacity-0 group-hover/msg:opacity-100 p-2 text-text-dim hover:text-text-active transition-all"
                                >
                                  <Plus size={12} className="rotate-45" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        {msg.retrievalContext && msg.retrievalContext.length > 0 && (
                          <div className="mt-4 pl-4">
                            <details className="group/details">
                              <summary className="text-[9px] font-bold text-text-dim uppercase tracking-[0.2em] cursor-pointer hover:text-text-active list-none flex items-center gap-2">
                                <Search size={10} /> 
                                VECTOR_RETRIEVAL_CONTEXT ({msg.retrievalContext.length} chunks)
                                <span className="group-open/details:rotate-180 transition-transform">▼</span>
                              </summary>
                              <div className="mt-4 grid grid-cols-1 gap-2 pt-2 border-t border-border-main/5">
                                {msg.retrievalContext.map((ctx, i) => (
                                  <div key={i} className="p-3 bg-bg-secondary border border-border-main/5 text-[11px] leading-relaxed">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-[9px] font-black bg-text-active text-bg-primary px-1.5 py-0.5 uppercase tracking-tighter">
                                        {ctx.source}
                                      </span>
                                      <span className="text-[9px] font-mono opacity-50">SCORE: {ctx.score.toFixed(4)}</span>
                                    </div>
                                    <p className="text-text-dim line-clamp-3">"{ctx.text}"</p>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {isProcessing && (
                  <div className="flex items-center gap-3 text-text-active text-[10px] font-bold tracking-[0.2em]">
                    <Loader2 className="animate-spin" size={14} />
                    <span>RETRIEVING DATA...</span>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <div className="mt-auto pt-6">
                <form onSubmit={handleChatRequest} className="relative flex items-center bg-bg-secondary border-2 border-border-main group overflow-hidden transition-colors">
                  <div className="pl-4 text-text-active">
                    <ChevronRight size={20} strokeWidth={3} />
                  </div>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="QUERY THE KNOWLEDGE BASE..."
                    className="w-full bg-transparent p-5 text-sm font-bold uppercase tracking-widest focus:outline-none placeholder:text-text-dim/30"
                    autoFocus
                  />
                  <button 
                    type="submit"
                    disabled={isProcessing || !input.trim()}
                    className="p-5 text-bg-primary bg-text-active hover:bg-bg-primary hover:text-text-active transition-all disabled:opacity-30 border-l-2 border-border-main"
                  >
                    <Send size={18} />
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {activeTab === 'stats' && (
            <motion.div 
              key="stats"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col gap-10 overflow-y-auto pr-4 pb-12"
            >
              <div className="space-y-4">
                <div className="flex items-center gap-3 text-text-active">
                  <Activity size={18} strokeWidth={2.5} />
                  <h2 className="text-sm font-black uppercase tracking-[0.3em]">Knowledge Ingestion Pipeline</h2>
                </div>

                {/* URL Injection */}
                <div className="terminal-card p-6 space-y-4 border-2 border-border-main/10">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black uppercase tracking-widest text-text-dim">External Resource URL</label>
                    <div className="flex gap-2">
                      <input 
                        type="url" 
                        value={urlInput}
                        onChange={e => setUrlInput(e.target.value)}
                        placeholder="https://example.com/docs"
                        className="flex-1 bg-bg-primary border-2 border-border-main/10 p-3 text-sm focus:border-accent transition-all outline-none font-bold text-text-active"
                      />
                      <button 
                        onClick={handleIngestUrl}
                        disabled={isFetchingUrl || !urlInput}
                        className="px-6 bg-text-active text-bg-primary hover:bg-bg-primary hover:text-text-active border-2 border-border-main transition-all text-xs font-black uppercase tracking-widest disabled:opacity-20 flex items-center gap-2"
                      >
                        {isFetchingUrl ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                        Fetch & Vectorize
                      </button>
                    </div>
                  </div>
                </div>

                {/* Manual Injection */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                  <div className="space-y-4">
                    <div className="p-6 border-2 border-border-main/10 bg-bg-secondary">
                      <div className="text-[10px] font-black uppercase tracking-widest text-text-dim mb-4">Manual Entry</div>
                      <div className="space-y-4">
                        <input 
                          type="text" 
                          value={uploadSource}
                          onChange={e => setUploadSource(e.target.value)}
                          placeholder="Doc Source Name"
                          className="w-full bg-bg-primary border-2 border-border-main/10 focus:border-accent p-3 text-sm outline-none font-bold text-text-active placeholder:font-normal placeholder:text-text-dim/30"
                        />
                        <textarea 
                          value={uploadText}
                          onChange={e => setUploadText(e.target.value)}
                          rows={4}
                          placeholder="Paste content here..."
                          className="w-full bg-bg-primary border-2 border-border-main/10 focus:border-accent p-3 text-sm outline-none resize-none font-mono text-text-active placeholder:font-sans placeholder:text-text-dim/30"
                        />
                        <button 
                          onClick={handleUpload}
                          disabled={isProcessing || !uploadText || !uploadSource}
                          className="w-full py-3 bg-text-active text-bg-primary font-black uppercase text-[10px] tracking-[0.2em] hover:bg-bg-primary hover:text-text-active border-2 border-border-main transition-all flex items-center justify-center gap-2"
                        >
                          <Plus size={14} /> Commit Chunks
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Stats */}
                  <div className="space-y-4">
                    <div className="p-6 border-2 border-border-main bg-text-active text-bg-primary">
                      <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-4">Core Metrics</div>
                      <div className="space-y-6">
                        <div className="flex justify-between items-end border-b border-bg-primary/20 pb-2">
                          <span className="text-[10px] uppercase font-bold tracking-widest">Knowledge Points</span>
                          <span className="text-3xl font-black">{knowledgeBase.length}</span>
                        </div>
                        <div className="flex justify-between items-end border-b border-bg-primary/20 pb-2">
                          <span className="text-[10px] uppercase font-bold tracking-widest">Similarity Engine</span>
                          <span className="text-xl font-bold">COSINE_RETRIEVAL</span>
                        </div>
                        <div className="flex justify-between items-end">
                          <span className="text-[10px] uppercase font-bold tracking-widest">Processing Node</span>
                          <span className="text-xs font-mono opacity-80">GEMINI_1.5_FLASH</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Fragment List */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black uppercase tracking-[0.3em] flex items-center gap-2 text-text-active">
                    <FileText size={14} /> Knowledge Fragments
                  </h3>
                  <span className="text-[9px] font-bold opacity-30 uppercase tracking-widest">{knowledgeBase.length} ITEMS TOTAL</span>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  {knowledgeBase.length === 0 ? (
                    <div className="border-2 border-dashed border-border-main/10 p-12 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-text-dim">
                      AWAITING DATA INJECTION
                    </div>
                  ) : (
                    knowledgeBase.map((doc, idx) => (
                      <div key={doc.id} className="group p-4 border-2 border-border-main/10 hover:border-accent transition-all bg-bg-secondary flex items-start gap-6">
                        <span className="text-[10px] font-black text-text-dim group-hover:text-text-active">{(idx + 1).toString().padStart(2, '0')}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-[9px] font-black text-bg-primary bg-text-active px-2 py-0.5 uppercase tracking-widest truncate max-w-[200px]">
                              {doc.metadata.source}
                            </span>
                          </div>
                          {editingDocId === doc.id ? (
                            <div className="space-y-3">
                              <textarea
                                value={editingDocText}
                                onChange={(e) => setEditingDocText(e.target.value)}
                                className="w-full bg-bg-primary border border-accent p-3 text-sm font-mono text-text-active outline-none min-h-[100px]"
                              />
                              <div className="flex gap-2">
                                <button 
                                  onClick={() => handleUpdateDoc(doc.id)}
                                  className="px-4 py-1.5 bg-text-active text-bg-primary text-[10px] font-black uppercase tracking-widest"
                                >
                                  Commit Update
                                </button>
                                <button 
                                  onClick={() => setEditingDocId(null)}
                                  className="px-4 py-1.5 border border-border-main text-text-dim text-[10px] font-black uppercase tracking-widest"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[13px] text-text-dim leading-relaxed">
                              {doc.text}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {!editingDocId && (
                            <button 
                              onClick={() => {
                                setEditingDocId(doc.id);
                                setEditingDocText(doc.text);
                              }}
                              className="p-2 text-text-dim hover:text-text-active transition-colors"
                            >
                              <Plus size={16} className="rotate-45" />
                            </button>
                          )}
                          <button 
                            onClick={() => handleDeleteDoc(doc.id)}
                            className="p-2 text-text-dim hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-10"
            >
              <div className="flex flex-col md:flex-row items-center gap-12 pt-8">
                <div className="w-48 h-48 border-4 border-border-main bg-bg-secondary flex items-center justify-center">
                  <User size={80} strokeWidth={1} className="text-text-active" />
                </div>
                <div className="text-center md:text-left space-y-4">
                  <h2 className="text-5xl font-black uppercase tracking-tighter text-text-active">ACCESS_NODE</h2>
                  <div className="flex flex-wrap gap-4 justify-center md:justify-start">
                    <span className="border-2 border-border-main px-4 py-1 text-xs font-black uppercase tracking-widest text-text-active">Status: ACTIVE</span>
                    <span className="border-2 border-border-main px-4 py-1 text-xs font-black uppercase tracking-widest text-text-active">Level: ADMIN_ROOT</span>
                  </div>
                  <p className="text-text-dim text-xs font-mono uppercase tracking-widest pt-2">System initialized May 12, 2026</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6">
                <div className="p-8 border-2 border-border-main bg-bg-secondary space-y-6">
                  <h3 className="text-xs font-black uppercase tracking-[0.3em] pb-2 border-b-2 border-border-main text-text-active">System Architecture</h3>
                  <div className="space-y-4 text-[11px] leading-relaxed uppercase font-bold tracking-widest text-text-active">
                    <div className="flex justify-between">
                      <span className="text-text-dim">Memory Cluster</span>
                      <span>JSON_LOCAL_STORE</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-dim">Vector Dimensions</span>
                      <span>76Dimensions</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-text-dim">RAG Controller</span>
                      <span>GEMINI_FLASH_1.5</span>
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-text-active text-bg-primary space-y-6 border-2 border-border-main">
                   <h3 className="text-xs font-black uppercase tracking-[0.3em] pb-2 border-b-2 border-bg-secondary/20">Security Protocol</h3>
                   <div className="space-y-4 text-[13px] leading-relaxed font-bold">
                      <p>All knowledge fragments are vectorized locally. Web ingestion uses secure proxy headers to prevent node tracking. Multi-chunk retrieval ensures contextual accuracy.</p>
                      <button className="w-full py-4 border-2 border-bg-primary text-bg-primary font-black uppercase tracking-widest text-[10px] hover:bg-bg-primary hover:text-text-active transition-all">
                        Reset Access Tokens
                      </button>
                   </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="mt-8 flex justify-between items-center text-[9px] font-black tracking-[0.3em] uppercase border-t-2 border-border-main/10 pt-6">
        <div className="flex items-center gap-8 text-text-active">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-text-active rounded-full animate-pulse" />
            NODE_01: STABLE
          </div>
          <div className="flex items-center gap-2">
             ENCRYPTION: AES_256
          </div>
        </div>
        <div className="opacity-40 text-text-active">
          NODE_ID: REMOTE_SYSTEM_01
        </div>
      </footer>
    </div>
  );
}
