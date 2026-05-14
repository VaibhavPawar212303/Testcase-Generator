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
  ArrowRight,
  X,
  CheckCircle2,
  Loader2,
  FileText,
  Search,
  Activity,
  User,
  Sun,
  Moon,
  Settings,
  Info,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import MindmapView from '@/components/MindmapView';

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
  const [activeTab, setActiveTab] = useState<'chat' | 'stats' | 'mindmap' | 'profile' | 'settings'>('chat');
  const [knowledgeBase, setKnowledgeBase] = useState<DocChunk[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', role: 'system', content: '// KNOWLEDGE TERMINAL v1.1.0 READY. SELECT PROCESSING NODE.' }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadText, setUploadText] = useState('');
  const [uploadSource, setUploadSource] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocText, setEditingDocText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  
  // Model Settings
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash-preview');
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [currentProcessingUrl, setCurrentProcessingUrl] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState({
    promptTokens: 0,
    candidatesTokens: 0,
    totalTokens: 0
  });
  
  // Pipeline States
  const [pipelineStep, setPipelineStep] = useState<'idle' | 'fetching' | 'review_root' | 'crawling' | 'review_crawl' | 'processing_ai' | 'review_ai' | 'finished'>('idle');
  const [processedAiText, setProcessedAiText] = useState('');
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [scrapingScreenshot, setScrapingScreenshot] = useState<string | null>(null);
  const [crawlLogs, setCrawlLogs] = useState<string[]>([]);
  const [selectedLinksForCrawl, setSelectedLinksForCrawl] = useState<Set<string>>(new Set());

  const addLog = (msg: string) => {
    setCrawlLogs(prev => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Advanced Mapping & Crawling States
  const [crawledData, setCrawledData] = useState<Map<string, { 
    url: string; 
    title: string; 
    text: string; 
    links: { href: string; text: string }[]; 
    processedText: string; 
    chunks: { id: string; text: string }[];
    screenshot?: string;
  }>>(new Map());
  const [selectedNodeUrl, setSelectedNodeUrl] = useState<string | null>(null);
  const [visitedUrls, setVisitedUrls] = useState<Set<string>>(new Set());
  const [currentCrawlingUrl, setCurrentCrawlingUrl] = useState<string | null>(null);
  const [isCrawlingFinished, setIsCrawlingFinished] = useState(false);

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

  const fetchKnowledge = async () => {
    try {
      const res = await fetch('/api/knowledge');
      if (!res.ok) {
        let errorMessage = `Server error: ${res.status}`;
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // Response was not JSON
        }
        throw new Error(errorMessage);
      }
      const data = await res.json();
      if (data.documents) {
        setKnowledgeBase(data.documents);
      }
    } catch (e) {
      console.error("Failed to load knowledge base from TiDB", e);
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'system', 
        content: `// DATABASE_OFFLINE: FAILED TO LOAD KNOWLEDGE BASE [${(e as Error).message}]` 
      }]);
    }
  };

  const fetchModels = async () => {
    setIsFetchingModels(true);
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.models) {
        setAvailableModels(data.models);
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
      setMessages(prev => [...prev, { 
        id: Date.now().toString(), 
        role: 'system', 
        content: `// NODE_DISCOVERY_FAILED: [${(e as Error).message}]` 
      }]);
    } finally {
      setIsFetchingModels(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'settings' && availableModels.length === 0) {
      fetchModels();
    }
  }, [activeTab]);

  const saveKnowledge = async (docs: DocChunk[]) => {
    try {
      await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: docs })
      });
      setKnowledgeBase(docs);
    } catch (e) {
      console.error("Failed to save knowledge base to TiDB", e);
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

  const fetchWithRetry = async (url: string, retries = 1): Promise<any> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch('/api/fetch-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const data = await response.json();
        
        // If text is suspiciously short, it might be a loading screen or failed render
        if ((!data.text || data.text.length < 200) && i < retries) {
          addLog(`PARTIAL_CONTENT_DETECTED: ${url}. ATTEMPTING_RECOVERY_${i+1}/${retries}...`);
          await new Promise(r => setTimeout(r, 2000)); // Wait before retry
          continue;
        }
        return data;
      } catch (err) {
        if (i === retries) throw err;
        addLog(`NETWORK_FLAKE_DETECTED: ${url}. RETRYING...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  };

  const handleIngestUrl = async () => {
    let targetUrl = urlInput.trim();
    if (!targetUrl) return;
    
    // Ensure protocol
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
      setUrlInput(targetUrl);
    }

    setPipelineStep('fetching');
    setShowPipelineModal(true);
    setPipelineError(null);
    setProcessedAiText('');
    setScrapingScreenshot(null);
    
    // Reset crawl states
    setCrawledData(new Map());
    setVisitedUrls(new Set());
    setIsCrawlingFinished(false);

    try {
      addLog(`INITIATING_CORE_PIPELINE: TARGET=${targetUrl}`);
      addLog("LAUNCHING_PLAYWRIGHT_INSTANCE...");
      // 1. Initial Fetch
      const data = await fetchWithRetry(targetUrl);

      addLog(`SUCCESSFULLY_NAVIGATED: ${targetUrl}`);
      addLog(`TITLE: ${data.title}`);
      addLog(`DISCOVERED_LINKS: ${data.links?.length || 0}`);
      addLog(`CRAWL_READY: SELECT_TARGET_NODES`);

      // Store initial page
      const rootUrl = urlInput;
      const initialEntry = {
        url: rootUrl,
        title: data.title || rootUrl,
        text: data.text,
        links: data.links || [],
        processedText: '',
        chunks: [],
        screenshot: data.screenshot
      };
      
      if (data.screenshot) setScrapingScreenshot(data.screenshot);
      
      // Update data immediately for mindmap visibility
      const newMap = new Map();
      newMap.set(rootUrl, initialEntry);
      setCrawledData(newMap);
      setVisitedUrls(new Set([rootUrl]));
      setSelectedLinksForCrawl(new Set((data.links || []).map((l: any) => l.href)));

      addLog(`ROOT_DISCOVERY_COMPLETE. AWAITING_USER_CONFIRMATION.`);
      setPipelineStep('review_root');
    } catch (err) {
      addLog(`CRITICAL_PIPELINE_ERROR: ${(err as Error).message}`);
      console.error("URL Ingestion failed", err);
      setPipelineError((err as Error).message);
    }
  };

  const startMultiCrawl = async (initialQueue: string[], rootUrl: string) => {
    // Deduplicate targets by normalized URL to avoid redundant fetches
    const deduplicatedQueue = Array.from(new Set(initialQueue.map(u => u.split('#')[0].replace(/\/$/, ''))));
    const maxPages = 100; // Allow more nodes if discovered later
    const visited = new Set([rootUrl]);
    const normalizedVisited = new Set([rootUrl.split('#')[0].replace(/\/$/, '')]);
    const newDataMap = new Map(crawledData);
    
    addLog(`STARTING_CRAWL: TARGETING_${deduplicatedQueue.length}_UNIQUE_NODES`);
    
    for (const url of deduplicatedQueue) {
      if (!url) continue;
      const normalizedUrl = url.split('#')[0].replace(/\/$/, '');
      
      if (normalizedVisited.has(normalizedUrl)) {
         // Already processed this page (or a variant of it)
         continue;
      }
      
      if (visited.size >= maxPages) {
        addLog(`REACHED_VIRTUAL_LIMIT_OF_${maxPages}_NODES. HALTING.`);
        break;
      }
      
      setCurrentCrawlingUrl(url);
      addLog(`PLAYWRIGHT_DISPATCH: TARGET=${url}`);
      
      // Increased throttle: slower crawl is more reliable in serverless and less likely to trigger rate limits
      await new Promise(r => setTimeout(r, 1500));

      try {
        const data = await fetchWithRetry(url);
        
        if (data.error) throw new Error(data.error);
        
        visited.add(url);
        normalizedVisited.add(normalizedUrl);
        newDataMap.set(url, {
          url,
          title: data.title || url,
          text: data.text,
          links: data.links || [],
          processedText: '',
          chunks: [],
          screenshot: data.screenshot
        });
        
        addLog(`NODE_INGESTED: ${data.title} || ${data.links?.length || 0}_LINKS`);
        
        // Progressively update state for UI feedback
        setCrawledData(new Map(newDataMap));
        setVisitedUrls(new Set(visited));
      } catch (err) {
        addLog(`STREAMS_ERROR_AT_NODE: ${url} - ${(err as Error).message}`);
        // Even on error, we mark as visited to avoid looping/retrying this specific URL
        normalizedVisited.add(normalizedUrl);
        console.error(`Crawl failed for ${url}`, err);
      }
    }
    
    addLog(`CRAWL_FINISHED: ${newDataMap.size}_SUCCESSFUL_NODES_IN_GRAPH`);
    setCurrentCrawlingUrl(null);
    setIsCrawlingFinished(true);
    setPipelineStep('review_crawl');
  };

  const handleProceedToAi = async () => {
    await processAllCrawledData(crawledData);
  };

  const processAllCrawledData = async (dataMap: Map<string, any>) => {
    setPipelineStep('processing_ai');
    addLog("SHRINKING_KNOWLEDGE_SURFACE: AI_RESTRUCTURING...");
    const processedMap = new Map(dataMap);
    
    for (const [url, entry] of processedMap.entries()) {
      setCurrentProcessingUrl(url);
      addLog(`AI_AGENT_ANALYZING: ${entry.title}`);
      try {
        const result = await ai.models.generateContent({
          model: selectedModel,
          contents: `Extract technical facts from this text. SOURCE: ${url}\n\nRAW:\n${entry.text}`,
          config: {
            systemInstruction: "You are a data extraction specialist. Convert website text into clean knowledge facts."
          }
        });
        
        if (result.usageMetadata) {
          setTokenUsage(prev => ({
            promptTokens: prev.promptTokens + (result.usageMetadata?.promptTokenCount || 0),
            candidatesTokens: prev.candidatesTokens + (result.usageMetadata?.candidatesTokenCount || 0),
            totalTokens: prev.totalTokens + (result.usageMetadata?.totalTokenCount || 0)
          }));
        }

        const extractedText = result.text || "";
        entry.processedText = extractedText;
        
        // Automated Chunking for this entry
        const chunks = extractedText.split('\n\n').filter((p: string) => p.trim()).map((text: string) => ({
          id: crypto.randomUUID(),
          text: text
        }));
        entry.chunks = chunks;
        
        processedMap.set(url, { ...entry });
        setCrawledData(new Map(processedMap));
        addLog(`AI_EXTRACTION_COMPLETE: ${chunks.length}_FACTS_STORED`);
      } catch (err) {
        addLog(`AI_PROCESSING_FAILURE_AT: ${url}`);
        console.error(`AI processing failed for ${url}`, err);
      }
    }
    
    addLog("KNOWLEDGE_INTEGRATION_SYNCED. STANDING_BY.");
    setCurrentProcessingUrl(null);
    setPipelineStep('review_ai');
  };

  const handleSavePipelineChunks = async () => {
    setIsProcessing(true);
    try {
      const newDocs: DocChunk[] = [];
      
      // Iterate through all crawled data
      for (const [url, entry] of crawledData.entries()) {
        for (const chunk of entry.chunks) {
          const embedding = await getEmbedding(chunk.text);
          newDocs.push({
            id: chunk.id,
            text: chunk.text,
            embedding,
            metadata: {
              source: url,
              createdAt: Date.now()
            }
          });
        }
      }

      const updatedKB = [...knowledgeBase, ...newDocs];
      await saveKnowledge(updatedKB);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'system', content: `// PIPELINE_COMPLETED: ADDED ${newDocs.length} CHUNKS FROM ${crawledData.size} PAGES` }]);
      setShowPipelineModal(false);
      setUrlInput('');
      setPipelineStep('idle');
    } catch (err) {
      console.error("Saving chunks failed", err);
      setPipelineError((err as Error).message);
    } finally {
      setIsProcessing(false);
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
    try {
      await fetch(`/api/knowledge?id=${id}`, { method: 'DELETE' });
      setKnowledgeBase(prev => prev.filter(d => d.id !== id));
    } catch (e) {
      console.error("Failed to delete from TiDB", e);
    }
  };

  const handleUpdateDoc = async (id: string) => {
    try {
      const docToUpdate = knowledgeBase.find(d => d.id === id);
      if (!docToUpdate) return;

      const embedding = await getEmbedding(editingDocText);
      await fetch('/api/knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, text: editingDocText, embedding })
      });

      setKnowledgeBase(prev => prev.map(d => d.id === id ? { ...d, text: editingDocText, embedding } : d));
      setEditingDocId(null);
    } catch (e) {
      console.error("Failed to update in TiDB", e);
    }
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

      const result = await ai.models.generateContent({
        model: selectedModel,
        contents: `You are a RAG Knowledge Terminal. Answer the user prompt based strictly on the provided knowledge base context. If the answer is not in the context, say you don't know based on human data.\n\nCONTEXT:\n${context}\n\nUSER PROMPT:\n${userMsg.content}`,
        config: {
          systemInstruction: "You are a professional retrieval system. Provide citations like [Source: X]. Use clear, structured monochrome-friendly formatting."
        }
      });

      if (result.usageMetadata) {
        setTokenUsage(prev => ({
          promptTokens: prev.promptTokens + (result.usageMetadata?.promptTokenCount || 0),
          candidatesTokens: prev.candidatesTokens + (result.usageMetadata?.candidatesTokenCount || 0),
          totalTokens: prev.totalTokens + (result.usageMetadata?.totalTokenCount || 0)
        }));
      }

      const assistantMsg: ChatMessage = { 
        id: (Date.now() + 1).toString(), 
        role: 'assistant', 
        content: result.text || "No response generated.",
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
          {(['chat', 'stats', 'mindmap', 'profile', 'settings'] as const).map((tab) => (
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

          {activeTab === 'mindmap' && (
            <motion.div 
              key="mindmap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col gap-6"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-text-active">
                  <Share2 size={18} strokeWidth={2.5} />
                  <h2 className="text-sm font-black uppercase tracking-[0.3em]">Knowledge Structure Mindmap</h2>
                </div>
                <div className="text-[10px] font-bold text-text-dim uppercase tracking-widest">
                  {crawledData.size} Connected Nodes
                </div>
              </div>

              <div className="flex-1 overflow-hidden">
                <MindmapView data={crawledData} />
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
                        disabled={pipelineStep === 'fetching' || !urlInput}
                        className="px-6 bg-text-active text-bg-primary hover:bg-bg-primary hover:text-text-active border-2 border-border-main transition-all text-xs font-black uppercase tracking-widest disabled:opacity-20 flex items-center gap-2"
                      >
                        {pipelineStep === 'fetching' ? <Loader2 className="animate-spin" size={16} /> : <Activity size={16} />}
                        Start Pipeline
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

          {activeTab === 'settings' && (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full flex flex-col gap-10 overflow-y-auto pr-4 pb-12"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border-main pb-4">
                  <div className="flex items-center gap-3 text-text-active">
                    <Settings size={18} strokeWidth={2.5} />
                    <h2 className="text-sm font-black uppercase tracking-[0.3em]">Processing Control Center</h2>
                  </div>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={fetchModels}
                      disabled={isFetchingModels}
                      className="text-[10px] font-black underline uppercase tracking-widest text-accent hover:text-text-active disabled:opacity-30"
                    >
                      {isFetchingModels ? "DISCOVERING_NODES..." : "RESYNC_ACTIVE_NODES"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Active Processing Node Selection */}
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Active Intelligence Node (Top 5)</h3>
                    <div className="space-y-2">
                      {isFetchingModels ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="h-16 border-2 border-border-main/10 bg-bg-secondary animate-pulse" />
                        ))
                      ) : (
                        availableModels.slice(0, 5).map((model) => (
                          <button
                            key={model.name}
                            onClick={() => setSelectedModel(model.name)}
                            className={cn(
                              "w-full p-4 border-2 transition-all text-left flex items-center justify-between group",
                              selectedModel === model.name 
                                ? "bg-bg-secondary border-accent" 
                                : "bg-bg-primary border-border-main/5 hover:border-border-main"
                            )}
                          >
                            <div className="flex flex-col gap-1">
                              <span className={cn(
                                "text-[12px] font-black tracking-widest uppercase",
                                selectedModel === model.name ? "text-accent" : "text-text-active"
                              )}>
                                {model.name}
                              </span>
                              <span className="text-[9px] text-text-dim font-mono line-clamp-1 opacity-60">
                                {model.displayName}
                              </span>
                            </div>
                            <div className={cn(
                              "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all",
                              selectedModel === model.name ? "bg-accent border-accent" : "border-border-main"
                            )}>
                              {selectedModel === model.name && <div className="w-1.5 h-1.5 bg-bg-primary rounded-full transition-transform" />}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Node Diagnostics */}
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Intelligence Node Diagnostics</h3>
                    <div className="bg-bg-secondary border-2 border-border-main p-6 space-y-6">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 text-accent">
                          <Activity size={14} />
                          <span className="text-[10px] font-black uppercase tracking-widest underline">NODE_STATUS: STABLE</span>
                        </div>

                        {/* Usage Statistics */}
                        <div className="space-y-3 pt-2">
                          <h4 className="text-[9px] font-black uppercase tracking-widest text-text-active flex items-center gap-2">
                            <Send size={10} /> Usage Statistics
                          </h4>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-3 bg-bg-primary border border-border-main/20">
                              <div className="text-[8px] font-bold text-text-dim uppercase mb-1">Total Tokens Used</div>
                              <div className="text-sm font-black text-text-active">{tokenUsage.totalTokens.toLocaleString()}</div>
                            </div>
                            <div className="p-3 bg-bg-primary border border-border-main/20">
                              <div className="text-[8px] font-bold text-text-dim uppercase mb-1">Pending Capacity</div>
                              <div className="text-sm font-black text-accent">
                                {availableModels.find(m => m.name === selectedModel) 
                                  ? (availableModels.find(m => m.name === selectedModel).inputTokenLimit - tokenUsage.promptTokens).toLocaleString()
                                  : "---"
                                }
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-4 px-1">
                            <div className="flex flex-col">
                              <span className="text-[8px] font-bold text-text-dim uppercase">Prompt</span>
                              <span className="text-[10px] font-mono text-text-active">{tokenUsage.promptTokens.toLocaleString()}</span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[8px] font-bold text-text-dim uppercase">Candidates</span>
                              <span className="text-[10px] font-mono text-text-active">{tokenUsage.candidatesTokens.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        
                        {availableModels.find(m => m.name === selectedModel) && (
                          <div className="space-y-4">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-text-dim uppercase tracking-tighter">Selected Processing Node</label>
                              <div className="text-xs font-black text-text-active uppercase">{selectedModel}</div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-text-dim uppercase tracking-tighter">Node Capabilities</label>
                              <div className="grid grid-cols-2 gap-2 mt-2">
                                <div className="p-2 border border-border-main/10 bg-bg-primary">
                                  <div className="text-[8px] font-bold text-text-dim uppercase mb-1">Input Limit</div>
                                  <div className="text-[10px] font-black text-accent">{availableModels.find(m => m.name === selectedModel)?.inputTokenLimit.toLocaleString()} TKNS</div>
                                </div>
                                <div className="p-2 border border-border-main/10 bg-bg-primary">
                                  <div className="text-[8px] font-bold text-text-dim uppercase mb-1">Output Limit</div>
                                  <div className="text-[10px] font-black text-accent">{availableModels.find(m => m.name === selectedModel)?.outputTokenLimit.toLocaleString()} TKNS</div>
                                </div>
                              </div>
                            </div>
                            <div className="p-3 bg-bg-primary border border-border-main/10 text-[10px] italic leading-relaxed text-text-dim font-mono">
                              {availableModels.find(m => m.name === selectedModel)?.description}
                            </div>
                          </div>
                        )}
                        
                        {!availableModels.length && !isFetchingModels && (
                          <div className="py-10 text-center space-y-4">
                            <Info size={24} className="mx-auto text-text-dim opacity-20" />
                            <p className="text-[10px] font-bold text-text-dim uppercase tracking-widest leading-relaxed">
                              No processing nodes detected.<br/>Synchronize with Gemini Network.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="pt-6 border-t border-border-main">
                        <div className="flex items-center gap-2 text-text-active mb-4">
                          <CheckCircle2 size={12} />
                          <span className="text-[10px] font-black uppercase tracking-widest">Environment Variables</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          <div className="flex items-center justify-between p-2 border border-border-main text-[10px] font-mono">
                            <span className="text-text-dim">GEMINI_API_KEY</span>
                            <span className="text-accent">ENCRYPTED</span>
                          </div>
                          <div className="flex items-center justify-between p-2 border border-border-main text-[10px] font-mono">
                            <span className="text-text-dim">DB_PROVIDER</span>
                            <span className="text-accent">TiDB_SERVERLESS</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
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
                      <span>TiDB_CLOUD_SERVERLESS</span>
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

      {/* Pipeline Modal Overlay */}
      <AnimatePresence>
        {showPipelineModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg-primary/95 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-2xl bg-bg-secondary border-2 border-border-main p-6 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b-2 border-border-main pb-4 mb-6">
                <div className="flex items-center gap-3">
                  <Activity size={18} className="text-accent" />
                  <h3 className="text-sm font-black uppercase tracking-[0.3em] text-text-active">Knowledge Pipeline</h3>
                </div>
                <button 
                  onClick={() => setShowPipelineModal(false)}
                  className="p-1 hover:text-accent transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Progress Steps */}
              <div className="flex items-center justify-between mb-8 px-4">
                {[
                  { step: 'fetching', label: 'FETCH' },
                  { step: 'review_root', label: 'SELECT_LINKS' },
                  { step: 'crawling', label: 'CRAWL' },
                  { step: 'review_crawl', label: 'VERIFY_GRAPH' },
                  { step: 'processing_ai', label: 'EXTRACT' },
                  { step: 'review_ai', label: 'APPROVE_FACTS' },
                ].map((s, idx, arr) => {
                  const stepOrder = ['idle', 'fetching', 'review_root', 'crawling', 'review_crawl', 'processing_ai', 'review_ai', 'finished'];
                  const currentIdx = stepOrder.indexOf(pipelineStep);
                  const sIdx = stepOrder.indexOf(s.step as any);
                  const isActive = currentIdx >= sIdx && pipelineStep !== 'idle';
                  
                  return (
                    <React.Fragment key={s.step}>
                      <div className="flex flex-col items-center gap-2">
                        <div className={cn(
                          "w-8 h-8 rounded-full border-2 flex items-center justify-center text-[10px] font-black transition-all",
                          isActive ? "bg-accent border-accent text-bg-primary" : "border-border-main text-text-dim"
                        )}>
                          {idx + 1}
                        </div>
                        <span className={cn("text-[8px] font-black tracking-widest uppercase", isActive ? "text-accent" : "text-text-dim")}>
                          {s.label}
                        </span>
                      </div>
                      {idx < arr.length - 1 && (
                        <div className={cn("flex-1 h-[2px] mb-4", isActive ? "bg-accent" : "bg-border-main")} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Modal Content */}
              <div className="flex-1 overflow-y-auto mb-6 pr-2">
                {pipelineError ? (
                  <div className="p-4 border-2 border-red-500 bg-red-500/10 text-red-500 text-xs font-bold uppercase tracking-widest">
                    // ERROR: {pipelineError}
                    <button 
                      onClick={handleIngestUrl}
                      className="block mt-4 text-bg-primary bg-red-500 px-4 py-2 hover:bg-bg-primary hover:text-red-500 border-2 border-red-500 transition-all font-black"
                    >
                      Retry Pipeline
                    </button>
                  </div>
                ) : (
                  <>
                    {pipelineStep === 'fetching' && (
                      <div className="flex flex-col items-center justify-center py-10 gap-6">
                        <div className="relative w-full max-w-lg aspect-video bg-bg-primary border-2 border-border-main/20 flex flex-col items-center justify-center overflow-hidden">
                          <Loader2 className="animate-spin text-accent absolute z-10" size={32} />
                          <div className="w-full h-full bg-bg-secondary opacity-50 flex items-center justify-center flex-col gap-2">
                             <Search size={48} className="text-text-dim opacity-20" />
                             <span className="text-[10px] font-mono text-text-dim uppercase">Initializing Headless Node...</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <span className="text-xs font-black uppercase tracking-[0.3em] text-text-active">Playwright_Navigation_Active</span>
                          <span className="text-[9px] font-mono text-text-dim uppercase tracking-tighter transition-all">Target: {urlInput}</span>
                        </div>
                      </div>
                    )}

                    {pipelineStep === 'crawling' && (
                      <div className="space-y-6">
                        <div className="flex flex-col items-center justify-center py-6 gap-2">
                          <Loader2 className="animate-spin text-accent" size={24} />
                          <span className="text-xs font-black uppercase tracking-[0.3em] text-text-active">Recursive_Crawl_In_Progress</span>
                          <span className="text-[9px] font-mono text-accent animate-pulse truncate max-w-md">VISITING: {currentCrawlingUrl}</span>
                        </div>
                        
                        <div className="space-y-3">
                          <div className="flex justify-between items-center px-1">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Discovered Nodes</h4>
                            <span className="text-[10px] font-mono text-accent">{visitedUrls.size} Found</span>
                          </div>
                          <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-2">
                            {Array.from(crawledData.values()).map((page, i) => (
                              <motion.div 
                                initial={{ x: -10, opacity: 0 }}
                                animate={{ x: 0, opacity: 1 }}
                                key={page.url} 
                                className="p-3 border-2 border-border-main/10 bg-bg-primary flex items-center gap-4 group"
                              >
                                <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">
                                  {i + 1}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                  <div className="text-[11px] font-bold text-text-active truncate uppercase tracking-tight">{page.title}</div>
                                  <div className="text-[9px] font-mono text-text-dim truncate">{page.url}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                  <span className="text-[8px] font-black uppercase text-green-500 tracking-widest">Fetched</span>
                                </div>
                              </motion.div>
                            ))}
                            {currentCrawlingUrl && (
                               <div className="p-3 border-2 border-dashed border-accent/20 bg-accent/5 flex items-center gap-4 animate-pulse">
                                  <div className="w-6 h-6 rounded-full border border-accent flex items-center justify-center text-[10px] font-bold text-accent">
                                    <Loader2 size={12} className="animate-spin" />
                                  </div>
                                  <div className="flex-1 overflow-hidden opacity-50">
                                    <div className="text-[11px] font-bold text-accent truncate uppercase tracking-tight">Accessing Resource...</div>
                                    <div className="text-[9px] font-mono text-accent truncate">{currentCrawlingUrl}</div>
                                  </div>
                               </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {pipelineStep === 'review_root' && (
                      <div className="space-y-6">
                        <div className="p-4 border-2 border-accent/20 bg-accent/5 flex items-center gap-4">
                           <div className="w-12 h-12 rounded-full bg-accent flex items-center justify-center text-bg-primary">
                             <Share2 size={24} />
                           </div>
                           <div className="flex-1">
                             <h4 className="text-sm font-black uppercase text-accent tracking-widest">Discovery Phase Complete</h4>
                             <p className="text-[10px] font-mono text-text-dim">Discovered {crawledData.get(urlInput)?.links.length || 0} candidate links for crawling.</p>
                           </div>
                        </div>

                        {scrapingScreenshot && (
                          <div className="space-y-2">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Root Node Preview</h4>
                            <div className="border-2 border-border-main/10 aspect-video overflow-hidden">
                              <img src={scrapingScreenshot} className="w-full h-full object-cover" />
                            </div>
                          </div>
                        )}

                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Discovered Links ({selectedLinksForCrawl.size} Selected)</h4>
                            <div className="flex gap-2">
                               <button 
                                 onClick={() => setSelectedLinksForCrawl(new Set((crawledData.get(urlInput)?.links || []).map(l => l.href)))}
                                 className="text-[8px] font-black uppercase text-accent underline"
                               >
                                 Select All
                               </button>
                               <button 
                                 onClick={() => setSelectedLinksForCrawl(new Set())}
                                 className="text-[8px] font-black uppercase text-text-dim underline"
                               >
                                 Deselect All
                               </button>
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto border border-border-main/10 bg-bg-primary p-2 space-y-1">
                            {crawledData.get(urlInput)?.links.map((link, i) => (
                              <div 
                                key={i} 
                                className="flex items-center gap-2 py-1 border-b border-border-main/5 group cursor-pointer"
                                onClick={() => {
                                  const next = new Set(selectedLinksForCrawl);
                                  if (next.has(link.href)) next.delete(link.href);
                                  else next.add(link.href);
                                  setSelectedLinksForCrawl(next);
                                }}
                              >
                                <div className={cn(
                                  "w-3 h-3 border transition-colors flex items-center justify-center flex-shrink-0",
                                  selectedLinksForCrawl.has(link.href) ? "bg-accent border-accent" : "border-border-main"
                                )}>
                                  {selectedLinksForCrawl.has(link.href) && <div className="w-1.5 h-1.5 bg-bg-primary" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                   <div className={cn(
                                     "text-[10px] font-bold uppercase truncate",
                                     selectedLinksForCrawl.has(link.href) ? "text-text-active" : "text-text-dim"
                                   )}>
                                     {link.text}
                                   </div>
                                   <div className="text-[8px] font-mono text-text-dim/50 truncate">
                                     {link.href}
                                   </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                          <button 
                            onClick={() => {
                              const links = Array.from(selectedLinksForCrawl);
                              setPipelineStep('crawling');
                              startMultiCrawl(links, urlInput);
                            }}
                            disabled={selectedLinksForCrawl.size === 0}
                            className="flex-1 py-4 bg-accent text-bg-primary font-black uppercase tracking-[0.2em] text-[10px] hover:scale-[1.02] transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                          >
                            <Activity size={14} /> Start Global Crawl
                          </button>
                          <button 
                            onClick={() => processAllCrawledData(crawledData)}
                            className="flex-1 py-4 bg-bg-secondary border-2 border-border-main text-text-active font-black uppercase tracking-[0.2em] text-[10px] hover:bg-border-main/10 transition-all flex items-center justify-center gap-2"
                          >
                            <ArrowRight size={14} /> Skip to AI Extraction
                          </button>
                        </div>
                      </div>
                    )}

                    {pipelineStep === 'review_crawl' && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="text-green-500" size={18} />
                            <h4 className="text-sm font-black uppercase tracking-widest text-text-active">Crawl Operation Finalized</h4>
                          </div>
                          <span className="text-[10px] font-mono text-accent bg-accent/10 px-2 py-1">{visitedUrls.size} Nodes Verified</span>
                        </div>

                        <div className="grid grid-cols-2 gap-4 max-h-64 overflow-y-auto pr-2">
                           {Array.from(crawledData.values()).map(page => (
                             <div 
                               key={page.url} 
                               className={cn(
                                 "p-3 border transition-all cursor-pointer flex items-center gap-3",
                                 selectedNodeUrl === page.url ? "border-accent bg-accent/5" : "border-border-main/20 bg-bg-primary hover:border-border-main"
                               )}
                               onClick={() => setSelectedNodeUrl(page.url === selectedNodeUrl ? null : page.url)}
                             >
                               <div className="w-8 h-8 rounded bg-bg-secondary flex-shrink-0 flex items-center justify-center">
                                 {page.screenshot ? <img src={page.screenshot} className="w-full h-full object-cover opacity-50" /> : <FileText size={14} className="text-text-dim" />}
                               </div>
                               <div className="flex-1 overflow-hidden">
                                 <div className="text-[10px] font-bold truncate uppercase">{page.title}</div>
                                 <div className="text-[8px] font-mono text-text-dim truncate">{page.url}</div>
                               </div>
                             </div>
                           ))}
                        </div>

                        {selectedNodeUrl && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-4 border-2 border-accent bg-bg-primary space-y-4"
                          >
                            <div className="flex items-center justify-between">
                              <h5 className="text-[9px] font-black uppercase tracking-[0.2em] text-accent">Node_Payload_Preview</h5>
                              <button onClick={() => setSelectedNodeUrl(null)}><X size={14} /></button>
                            </div>
                            <div className="text-[10px] font-mono text-text-dim leading-relaxed h-32 overflow-y-auto">
                              {crawledData.get(selectedNodeUrl)?.text}
                            </div>
                          </motion.div>
                        )}

                        <div className="p-4 bg-accent/5 border border-accent/20 rounded">
                           <p className="text-[10px] font-mono leading-relaxed text-text-active">
                             Ready to fragment and process these nodes through the Gemini Neural Network.
                             This will extract technical facts and build your local knowledge base.
                           </p>
                        </div>

                        <button 
                          onClick={handleProceedToAi}
                          className="w-full py-4 bg-accent text-bg-primary font-black uppercase tracking-[0.3em] text-[11px] hover:scale-[1.01] transition-all flex items-center justify-center gap-2 shadow-xl"
                        >
                          <Cpu size={16} /> Execute Neural Extraction
                        </button>
                      </div>
                    )}

                    {pipelineStep === 'processing_ai' && (
                      <div className="flex flex-col items-center justify-center py-20 gap-8 text-center">
                        <div className="relative w-24 h-24 mx-auto">
                           <div className="absolute inset-0 rounded-full border-4 border-accent animate-ping opacity-20" />
                           <div className="absolute inset-2 rounded-full border-4 border-accent animate-pulse opacity-50" />
                           <div className="absolute inset-0 flex items-center justify-center">
                              <Cpu size={32} className="text-accent" />
                           </div>
                        </div>
                        <div className="flex flex-col items-center gap-3">
                           <span className="text-xs font-black uppercase tracking-[0.4em] text-text-active animate-pulse">Autonomous_Content_Extraction</span>
                           <span className="text-[10px] font-mono text-accent uppercase">NODE: {currentProcessingUrl}</span>
                        </div>
                        <div className="w-full max-w-sm mx-auto h-1 bg-bg-secondary rounded-full overflow-hidden border border-border-main/20">
                           <motion.div 
                              className="h-full bg-accent"
                              initial={{ width: 0 }}
                              animate={{ width: '100%' }}
                              transition={{ duration: 3, repeat: Infinity }}
                           />
                        </div>
                        <div className="flex items-center justify-center gap-4 text-[10px] font-black uppercase tracking-widest text-text-dim bg-bg-secondary/50 px-4 py-2 rounded-full mx-auto">
                           <Activity size={12} className="text-accent" />
                           {Array.from(crawledData.values()).filter(d => d.processedText).length} / {crawledData.size} NODES_FINALIZED
                        </div>
                      </div>
                    )}

                    {pipelineStep === 'review_ai' && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-black uppercase tracking-widest text-text-active">Extracted Facts Approval</h4>
                          <span className="text-[10px] font-mono text-accent">{Array.from(crawledData.values()).reduce((acc, curr) => acc + curr.chunks.length, 0)} Total Facts</span>
                        </div>

                        <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
                           {Array.from(crawledData.values()).map((page, pIdx) => (
                             <div key={page.url} className="space-y-3 p-4 border-2 border-border-main/10 bg-bg-primary">
                               <div className="flex items-center justify-between border-b border-border-main/5 pb-2">
                                 <h5 className="text-[10px] font-black uppercase text-accent truncate max-w-[70%]">{page.title}</h5>
                                 <span className="text-[8px] font-mono opacity-50">{page.chunks.length} chunks</span>
                               </div>
                               <div className="grid grid-cols-1 gap-2">
                                 {page.chunks.map((chunk, cIdx) => (
                                   <div key={chunk.id} className="p-2 bg-bg-secondary text-[10px] leading-relaxed group relative">
                                      <span className="font-bold text-accent">#{cIdx+1}:</span> {chunk.text}
                                      <button 
                                        onClick={() => {
                                           const next = new Map(crawledData);
                                           const pageData = next.get(page.url);
                                           if (pageData) {
                                              pageData.chunks = pageData.chunks.filter(c => c.id !== chunk.id);
                                              setCrawledData(next);
                                           }
                                        }}
                                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 transition-all"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                   </div>
                                 ))}
                               </div>
                               {page.chunks.length === 0 && <p className="text-[9px] italic text-red-500/50 text-center">No facts extracted for this node.</p>}
                             </div>
                           ))}
                        </div>

                        <div className="flex gap-4">
                           <button 
                             onClick={() => setPipelineStep('finished')}
                             className="flex-1 py-4 bg-accent text-bg-primary font-black uppercase tracking-[0.2em] text-[10px] hover:scale-[1.01] transition-all flex items-center justify-center gap-2 shadow-xl"
                           >
                             <CheckCircle2 size={14} /> Approve All & Finalize
                           </button>
                           <button 
                             onClick={() => setPipelineStep('review_crawl')}
                             className="px-8 py-4 bg-bg-secondary border-2 border-border-main text-text-dim font-black uppercase tracking-[0.2em] text-[10px] hover:text-text-active transition-all"
                           >
                             Back
                           </button>
                        </div>
                      </div>
                    )}

                    {pipelineStep === 'finished' && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-text-dim">Generated Knowledge Fragments</h4>
                          <span className="text-[9px] font-black bg-accent text-bg-primary px-2 py-0.5">{Array.from(crawledData.values()).reduce((acc, curr) => acc + curr.chunks.length, 0)} TOTAL CHUNKS</span>
                        </div>
                        <div className="space-y-6">
                          {Array.from(crawledData.values()).map((page, pIdx) => (
                            <div key={page.url} className="space-y-2">
                               <div className="flex items-center gap-2">
                                 <div className="px-2 py-0.5 bg-bg-secondary border border-border-main text-[9px] font-black uppercase tracking-tighter text-text-dim">
                                   Source_{pIdx+1}: {page.title}
                                 </div>
                               </div>
                               <div className="space-y-2 pl-4 border-l-2 border-border-main/20">
                                {page.chunks.map((chunk, i) => (
                                  <div key={chunk.id} className="p-3 border border-border-main/10 bg-bg-primary text-[11px] leading-relaxed text-text-dim">
                                    <span className="font-black text-accent mr-2">CH_{i+1}:</span> {chunk.text.slice(0, 200)}{chunk.text.length > 200 ? '...' : ''}
                                  </div>
                                ))}
                               </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Modal Footer Controls */}
              {!pipelineError && (
                <div className="flex justify-end pt-6 border-t-2 border-border-main gap-4">
                  {pipelineStep === 'finished' && (
                    <button 
                      onClick={handleSavePipelineChunks}
                      disabled={isProcessing}
                      className="px-8 py-3 bg-accent text-bg-primary hover:bg-bg-white hover:text-bg-primary border-2 border-accent transition-all text-xs font-black uppercase tracking-widest flex items-center gap-2"
                    >
                      {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                      Commit to TiDB
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
