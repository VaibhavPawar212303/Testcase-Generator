'use client';

import React from 'react';
import { motion } from 'motion/react';
import { ExternalLink, FileText, Share2 } from 'lucide-react';

interface PageData {
  url: string;
  title: string;
  text: string;
  links: { href: string; text: string }[];
  processedText: string;
  chunks: { id: string; text: string }[];
}

interface MindmapViewProps {
  data: Map<string, PageData>;
}

export default function MindmapView({ data }: MindmapViewProps) {
  const entries = Array.from(data.values());
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full border-2 border-dashed border-border-main/10 rounded-xl p-12 opacity-50">
        <Share2 size={48} className="mb-4 text-text-dim" />
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-text-dim">No Knowledge Map Generated</p>
      </div>
    );
  }

  // Find the root (first entry)
  const root = entries[0];

  return (
    <div className="relative w-full h-full overflow-auto p-8 bg-bg-secondary/30 rounded-2xl border-2 border-border-main/5">
      <div className="flex flex-col items-center gap-12 min-w-max">
        {/* Root Node */}
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative z-10 p-6 bg-text-active text-bg-primary rounded-xl shadow-2xl border-4 border-bg-primary max-w-sm text-center"
        >
          <div className="text-[10px] font-black uppercase tracking-widest opacity-50 mb-1">Knowledge Root</div>
          <h3 className="text-sm font-black uppercase leading-tight truncate">{root.title}</h3>
          <p className="text-[9px] font-mono mt-2 opacity-70 truncate">{root.url}</p>
        </motion.div>

        {/* Connections Layer (SVG) */}
        <div className="flex flex-wrap justify-center gap-8 md:gap-12 w-full pt-4">
          {entries.slice(1).map((page, idx) => (
            <motion.div
              key={page.url}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: idx * 0.1 }}
              className="relative p-5 bg-bg-primary border-2 border-border-main/20 hover:border-accent transition-all group max-w-[280px] rounded-lg shadow-lg"
            >
              {/* Connector line simplified as a divider in layout */}
              <div className="absolute -top-12 left-1/2 w-0.5 h-12 bg-border-main/20 -z-10" />
              
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-text-dim">Node_{idx + 1}</span>
                </div>
                <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-text-dim hover:text-text-active">
                  <ExternalLink size={12} />
                </a>
              </div>

              <h4 className="text-[12px] font-black text-text-active mb-4 line-clamp-2 uppercase tracking-tight leading-tight">
                {page.title}
              </h4>

              <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-border-main/10">
                <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-text-dim uppercase tracking-tighter">Content Size</span>
                  <span className="text-[10px] font-mono text-text-active">{(page.text.length / 1024).toFixed(1)} KB</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-text-dim uppercase tracking-tighter">AI Chunks</span>
                  <span className="text-[10px] font-mono text-accent">{page.chunks.length} Fragments</span>
                </div>
              </div>

              {/* Peek into content */}
              <div className="mt-4 p-2 bg-bg-secondary/50 rounded border border-border-main/5">
                <p className="text-[9px] text-text-dim line-clamp-3 italic leading-relaxed">
                  {page.processedText || page.text.slice(0, 100) + '...'}
                </p>
              </div>

              <div className="mt-4 flex items-center gap-1.5 overflow-hidden">
                <FileText size={10} className="text-text-dim shrink-0" />
                <span className="text-[8px] font-mono text-text-dim opacity-50 truncate">
                  {page.links.length} INTERNAL_EDGES
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
