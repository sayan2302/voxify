import React from 'react';
import { ParsedChapter } from '../../engine/parser/documentParser';
import { BookOpen, CheckSquare, Square, Clock, FileText } from 'lucide-react';

interface ChapterSidebarProps {
  chapters: ParsedChapter[];
  activeChapterIndex: number;
  onSelectChapter: (index: number) => void;
  onToggleChapterInclusion: (index: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export const ChapterSidebar: React.FC<ChapterSidebarProps> = ({
  chapters,
  activeChapterIndex,
  onSelectChapter,
  onToggleChapterInclusion,
  onSelectAll,
  onDeselectAll,
}) => {
  const includedCount = chapters.filter(c => c.included).length;
  const totalWords = chapters.filter(c => c.included).reduce((acc, c) => acc + c.wordCount, 0);
  // Average speaking rate: ~150 words per minute
  const totalEstMinutes = Math.round(totalWords / 150);

  return (
    <div className="w-80 h-full flex flex-col glass-panel border-r border-white/5 select-none">
      {/* Header */}
      <div className="p-4 border-b border-white/5 bg-slate-900/40">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold tracking-wide text-slate-200">Chapters & Content</h2>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 font-medium">
            {includedCount} of {chapters.length}
          </span>
        </div>

        {/* Stats & Quick Actions */}
        <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>~{totalEstMinutes} mins audio</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onSelectAll}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              All
            </button>
            <span className="text-slate-600">|</span>
            <button
              onClick={onDeselectAll}
              className="text-[11px] text-slate-400 hover:text-slate-300 transition-colors"
            >
              None
            </button>
          </div>
        </div>
      </div>

      {/* Chapter List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {chapters.map((chap, idx) => {
          const isActive = idx === activeChapterIndex;
          return (
            <div
              key={chap.id}
              onClick={() => onSelectChapter(idx)}
              className={`group flex items-center gap-2.5 p-2.5 rounded-lg text-xs cursor-pointer transition-all ${
                isActive
                  ? 'bg-indigo-600/20 border border-indigo-500/30 text-white shadow-sm'
                  : 'hover:bg-slate-800/40 text-slate-300 border border-transparent'
              }`}
            >
              {/* Inclusion Checkbox */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleChapterInclusion(idx);
                }}
                className="text-slate-400 hover:text-indigo-400 transition-colors"
                title={chap.included ? 'Included in audiobook' : 'Excluded from audiobook'}
              >
                {chap.included ? (
                  <CheckSquare className="w-4 h-4 text-indigo-400" />
                ) : (
                  <Square className="w-4 h-4 text-slate-500" />
                )}
              </button>

              {/* Title & Index */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className={`font-medium truncate ${!chap.included ? 'line-through text-slate-500' : ''}`}>
                    {chap.title || `Chapter ${chap.index}`}
                  </span>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                  <span className="flex items-center gap-1">
                    <FileText className="w-2.5 h-2.5" />
                    {chap.wordCount.toLocaleString()} words
                  </span>
                  <span>•</span>
                  <span>~{Math.ceil(chap.wordCount / 150)} min</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
