import React, { useRef, useState } from 'react';
import { Upload, BookOpen, Sparkles, Trash2, ArrowRight } from 'lucide-react';
import { LibraryItem } from '../../engine/storage/libraryStorage';

interface LibraryDropzoneProps {
  library: LibraryItem[];
  onFileSelected: (file: File) => void;
  onLoadSample: (sampleType: 'fiction' | 'academic') => void;
  onSelectBook: (book: LibraryItem) => void;
  onDeleteBook: (id: string) => void;
}

export const LibraryDropzone: React.FC<LibraryDropzoneProps> = ({
  library,
  onFileSelected,
  onLoadSample,
  onSelectBook,
  onDeleteBook,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelected(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto p-10 flex flex-col items-center justify-start max-w-5xl mx-auto select-none">
      {/* Hero Title */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Local Kokoro-82M Audio Engine</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight sm:text-4xl">
          Convert Any Document to a Studio Audiobook
        </h1>
        <p className="text-sm text-slate-400 mt-2 max-w-xl mx-auto">
          Drag and drop your PDFs, EPUBs, Markdown notes, or plain text. Cleaned, chapterized, and voiced 100% locally on your computer.
        </p>
      </div>

      {/* Drag & Drop Card */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`w-full max-w-2xl p-10 rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center ${
          isDragging
            ? 'border-indigo-500 bg-indigo-500/10 scale-[1.01]'
            : 'border-white/10 hover:border-indigo-500/50 bg-slate-900/40 hover:bg-slate-900/60'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onFileSelected(e.target.files[0]);
            }
          }}
          accept=".pdf,.epub,.md,.txt"
          className="hidden"
        />

        <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-4 shadow-inner">
          <Upload className="w-8 h-8" />
        </div>

        <h3 className="text-base font-semibold text-slate-100">
          Drop your document here or <span className="text-indigo-400 underline underline-offset-4">browse files</span>
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Supports PDF, EPUB, Markdown (.md), and Plain Text (.txt)
        </p>

        {/* Quick Sample Buttons */}
        <div className="flex items-center gap-3 mt-6 pt-6 border-t border-white/5 w-full justify-center">
          <span className="text-xs text-slate-500">Or try instant sample:</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLoadSample('fiction');
            }}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors border border-white/5"
          >
            📖 Fiction (Dialogue & Quotes)
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onLoadSample('academic');
            }}
            className="px-3 py-1 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors border border-white/5"
          >
            📑 Academic Paper (Hyphen & Header Cleaning)
          </button>
        </div>
      </div>

      {/* Bookshelf / Recent Library */}
      {library.length > 0 && (
        <div className="w-full max-w-4xl mt-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-400" />
              <span>Your Library ({library.length})</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {library.map((item) => (
              <div
                key={item.id}
                onClick={() => onSelectBook(item)}
                className="p-4 rounded-xl glass-panel-interactive flex items-start justify-between gap-4 cursor-pointer group"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-12 rounded-lg bg-indigo-950/60 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 font-bold text-xs uppercase">
                    {item.document.format}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
                      {item.document.title}
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {item.document.author} • {item.document.chapters.length} chapters
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1 font-mono">
                      {item.document.totalWordCount.toLocaleString()} words
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteBook(item.id);
                    }}
                    className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Delete book"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <div className="p-2 rounded-lg bg-indigo-600/10 text-indigo-400 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                    <ArrowRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
