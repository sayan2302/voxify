import React, { useState, useRef, useEffect } from 'react';
import { ParsedChapter } from '../../engine/parser/documentParser';
import { TextCleaner } from '../../engine/cleaner/textCleaner';
import { Sparkles, Edit3, Type, Volume2, Loader2, Zap, Play, Square, X } from 'lucide-react';

interface TextInspectorProps {
  chapter: ParsedChapter;
  activeSentenceIndex: number;
  isPlaying: boolean;
  isSynthesizing?: boolean;
  bufferedSentenceIndices?: Set<number>;
  isReadingSelection?: boolean;
  readingSelectionText?: string | null;
  onUpdateChapterText: (cleanedText: string) => void;
  onPlaySelection: (text: string, sentenceIndex?: number | null) => void;
  onStopSelection: () => void;
}

export const TextInspector: React.FC<TextInspectorProps> = ({
  chapter,
  activeSentenceIndex,
  isPlaying,
  isSynthesizing = false,
  bufferedSentenceIndices = new Set(),
  isReadingSelection = false,
  readingSelectionText = null,
  onUpdateChapterText,
  onPlaySelection,
  onStopSelection,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [fontFamily, setFontFamily] = useState<'serif' | 'sans'>('serif');
  const [cleanSummary, setCleanSummary] = useState<string | null>(null);

  // Text selection tracking
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectedSentenceIndex, setSelectedSentenceIndex] = useState<number | null>(null);
  const [selectionCoords, setSelectionCoords] = useState<{ top: number; left: number; bottom: number } | null>(null);
  const readerContainerRef = useRef<HTMLDivElement>(null);

  // Split cleaned text into sentences for karaoke and sentence-by-sentence interaction
  const sentences = TextCleaner.splitIntoSentences(chapter.cleanedText);

  // Deselect if chapter changes
  useEffect(() => {
    setSelectedText(null);
    setSelectedSentenceIndex(null);
    setSelectionCoords(null);
  }, [chapter.id]);

  const handleAutoClean = () => {
    const result = TextCleaner.clean(chapter.rawText);
    onUpdateChapterText(result.cleanedText);
    setCleanSummary(
      `Cleaned: ${result.rejoinedHyphensCount} broken hyphens rejoined, ${result.strippedPageNumbersCount} page numbers removed, ${result.strippedHeadersCount} headers stripped.`
    );
    setTimeout(() => setCleanSummary(null), 5000);
  };

  const getFontSizeClass = () => {
    switch (fontSize) {
      case 'sm': return 'text-sm leading-relaxed';
      case 'lg': return 'text-lg leading-loose';
      default: return 'text-base leading-relaxed';
    }
  };

  // Handle single click on sentence: selects that sentence without playing
  const handleSentenceClick = (e: React.MouseEvent, sentence: string, idx: number) => {
    // If the user was dragging to highlight text, let handleMouseUp take precedence
    const winSel = window.getSelection();
    if (winSel && !winSel.isCollapsed && winSel.toString().trim().length > 0) {
      return;
    }

    if (selectedSentenceIndex === idx && !isReadingSelection) {
      // Toggle selection off if already selected
      setSelectedSentenceIndex(null);
      setSelectedText(null);
      setSelectionCoords(null);
      return;
    }

    setSelectedSentenceIndex(idx);
    setSelectedText(sentence);
    const rect = e.currentTarget.getBoundingClientRect();
    setSelectionCoords({
      top: rect.top,
      left: rect.left + rect.width / 2,
      bottom: rect.bottom,
    });
  };

  // Handle mouseup for arbitrary drag text selection
  const handleMouseUp = () => {
    const winSel = window.getSelection();
    if (!winSel || winSel.isCollapsed) {
      return;
    }

    const text = winSel.toString().trim();
    if (text.length > 0) {
      setSelectedText(text);
      // Check if matches an exact single sentence
      const matchedIdx = sentences.findIndex(s => s.trim() === text);
      setSelectedSentenceIndex(matchedIdx !== -1 ? matchedIdx : null);

      try {
        const range = winSel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelectionCoords({
          top: rect.top,
          left: rect.left + rect.width / 2,
          bottom: rect.bottom,
        });
      } catch {}
    }
  };

  const handleClearSelection = () => {
    setSelectedText(null);
    setSelectedSentenceIndex(null);
    setSelectionCoords(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-950/40 relative">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-slate-900/30 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-slate-100 truncate max-w-md">
            {chapter.title}
          </h1>
          <span className="text-xs text-slate-400 font-mono">
            {sentences.length} sentences
          </span>
          {sentences.length > 0 && (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border transition-all ${
                bufferedSentenceIndices.size === sentences.length
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
              }`}
              title="Pre-buffered sentences are cached and start playing in 0ms immediately."
            >
              <Zap className={`w-3 h-3 ${bufferedSentenceIndices.size === sentences.length ? 'text-emerald-400 fill-emerald-400' : 'text-indigo-400'}`} />
              <span>
                {bufferedSentenceIndices.size === sentences.length ? '100% Buffered (0ms Ready)' : `Pre-buffering ${bufferedSentenceIndices.size}/${sentences.length}`}
              </span>
            </span>
          )}

          {/* Active Selection Badge in Toolbar */}
          {selectedText && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-xs text-indigo-200 animate-in fade-in duration-150">
              <span className="font-semibold text-indigo-300">
                {selectedSentenceIndex !== null ? `Sentence ${selectedSentenceIndex + 1}` : 'Selected Part'}:
              </span>
              <span className="truncate max-w-[180px] text-slate-300 italic">
                "{selectedText.length > 35 ? selectedText.slice(0, 35) + '…' : selectedText}"
              </span>

              {isReadingSelection && isPlaying ? (
                <button
                  onClick={onStopSelection}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/25 hover:bg-rose-500/40 text-rose-200 text-[11px] font-semibold border border-rose-500/30 transition-colors"
                >
                  <Square className="w-2.5 h-2.5 fill-rose-300" />
                  Stop
                </button>
              ) : isSynthesizing && isReadingSelection ? (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[11px] font-medium border border-amber-500/30 animate-pulse">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  Synthesizing...
                </span>
              ) : (
                <button
                  onClick={() => onPlaySelection(selectedText, selectedSentenceIndex)}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold shadow transition-colors"
                >
                  <Play className="w-2.5 h-2.5 fill-white" />
                  Read This Part Only
                </button>
              )}

              <button
                onClick={handleClearSelection}
                className="text-slate-400 hover:text-white text-xs ml-0.5"
                title="Deselect"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-Clean Action */}
          <button
            onClick={handleAutoClean}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 transition-all shadow-sm"
            title="Auto-clean broken hyphens, running headers, and page numbers"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Auto-Clean Text</span>
          </button>

          {/* Edit Toggle */}
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              isEditing
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-slate-800/60 border-white/5 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>{isEditing ? 'Done Editing' : 'Edit'}</span>
          </button>

          {/* Typography Selector */}
          <div className="flex items-center gap-1 bg-slate-900/80 p-1 rounded-lg border border-white/5 text-xs text-slate-300">
            <Type className="w-3.5 h-3.5 text-slate-400 ml-1" />
            <button
              onClick={() => setFontFamily(fontFamily === 'serif' ? 'sans' : 'serif')}
              className="px-2 py-0.5 rounded text-[11px] hover:bg-slate-800 transition-colors"
            >
              {fontFamily === 'serif' ? 'Serif' : 'Sans'}
            </button>
            <button
              onClick={() => {
                if (fontSize === 'sm') setFontSize('base');
                else if (fontSize === 'base') setFontSize('lg');
                else setFontSize('sm');
              }}
              className="px-2 py-0.5 rounded text-[11px] hover:bg-slate-800 transition-colors font-mono"
            >
              {fontSize.toUpperCase()}
            </button>
          </div>
        </div>
      </div>

      {/* Cleaning notification toast */}
      {cleanSummary && (
        <div className="absolute top-14 left-6 right-6 z-20 p-2.5 rounded-lg bg-indigo-950/90 border border-indigo-500/40 text-indigo-200 text-xs flex items-center justify-between shadow-lg backdrop-blur-md transition-all">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{cleanSummary}</span>
          </div>
          <button
            onClick={() => setCleanSummary(null)}
            className="text-slate-400 hover:text-white text-xs px-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Floating Action Pill near Selection */}
      {selectedText && selectionCoords && (
        <div
          style={{
            position: 'fixed',
            top: `${Math.max(65, selectionCoords.top - 46)}px`,
            left: `${Math.min(window.innerWidth - 220, Math.max(220, selectionCoords.left))}px`,
            transform: 'translateX(-50%)',
            zIndex: 60,
          }}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/95 border border-indigo-500/50 shadow-2xl backdrop-blur-md text-xs text-slate-100 animate-in fade-in zoom-in-95 duration-150 select-none"
        >
          <span className="flex items-center gap-1.5 text-indigo-300 font-medium border-r border-white/10 pr-2.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{selectedSentenceIndex !== null ? `Sentence ${selectedSentenceIndex + 1}` : 'Selected Part'}</span>
            <span className="text-[10px] text-slate-400 font-mono">
              ({selectedText.split(/\s+/).filter(Boolean).length} words)
            </span>
          </span>

          {isReadingSelection && isPlaying ? (
            <button
              onClick={onStopSelection}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-medium transition-all"
            >
              <Square className="w-3 h-3 fill-rose-400 text-rose-400" />
              <span>Stop</span>
            </button>
          ) : isSynthesizing && isReadingSelection ? (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-medium animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              <span>Synthesizing speech...</span>
            </div>
          ) : (
            <button
              onClick={() => onPlaySelection(selectedText, selectedSentenceIndex)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95"
            >
              <Play className="w-3 h-3 fill-white text-white" />
              <span>Read This Part Only</span>
            </button>
          )}

          <button
            onClick={handleClearSelection}
            className="p-1 rounded-full hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors ml-0.5"
            title="Deselect"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Reading / Editing Area */}
      <div
        ref={readerContainerRef}
        onMouseUp={handleMouseUp}
        className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full"
      >
        {isEditing ? (
          <textarea
            value={chapter.cleanedText}
            onChange={(e) => onUpdateChapterText(e.target.value)}
            className={`w-full h-full min-h-[500px] p-6 rounded-xl bg-slate-900/60 border border-indigo-500/30 text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/40 resize-none font-sans ${getFontSizeClass()}`}
            placeholder="Edit text directly here..."
          />
        ) : (
          <div
            className={`prose prose-invert max-w-none transition-all ${
              fontFamily === 'serif' ? 'font-serif' : 'font-sans'
            } ${getFontSizeClass()}`}
          >
            {sentences.map((sentence, idx) => {
              // Exact state determination:
              // 1. Is this sentence actively speaking?
              const isSelected =
                selectedSentenceIndex === idx ||
                (selectedText && selectedText.trim() === sentence.trim()) ||
                (isReadingSelection && readingSelectionText && readingSelectionText.trim() === sentence.trim());
              const isSpeakingSelection = isReadingSelection && isPlaying && isSelected;
              const isSpeakingRegular = !isReadingSelection && isPlaying && idx === activeSentenceIndex;
              const isSentenceSpeaking = isSpeakingSelection || isSpeakingRegular;

              // 2. Is this sentence synthesizing?
              const isSentenceSynthesizing = isSynthesizing && (
                (isReadingSelection && isSelected) ||
                (!isReadingSelection && idx === activeSentenceIndex)
              );

              // 3. Is pre-buffered?
              const isBuffered = bufferedSentenceIndices.has(idx);
              const hasDialogue = /["“][^"”]+["”]/.test(sentence);

              return (
                <span
                  key={idx}
                  onClick={(e) => handleSentenceClick(e, sentence, idx)}
                  className={`inline cursor-pointer transition-all duration-150 rounded px-1.5 py-0.5 group relative ${
                    isSentenceSynthesizing
                      ? 'bg-amber-500/20 text-amber-100 border-b-2 border-amber-400 animate-pulse font-medium shadow-sm'
                      : isSentenceSpeaking
                      ? 'karaoke-active text-white font-medium shadow-md ring-2 ring-indigo-400/50'
                      : isSelected
                      ? 'bg-indigo-500/25 text-indigo-100 border-2 border-indigo-400/80 rounded-md shadow-md ring-1 ring-indigo-500/30 font-medium'
                      : isBuffered
                      ? 'hover:bg-slate-800/60 text-slate-200 border-b border-emerald-500/40'
                      : 'hover:bg-slate-800/60 text-slate-300'
                  }`}
                  title={
                    isSentenceSynthesizing
                      ? 'Synthesizing speech on CPU (~5-8s)...'
                      : isSentenceSpeaking
                      ? 'Speaking now'
                      : isSelected
                      ? 'Selected • Click "Read This Part Only" to speak'
                      : isBuffered
                      ? '⚡ Pre-buffered • Click to select'
                      : 'Click to select sentence • Drag to highlight text'
                  }
                >
                  {isSentenceSynthesizing && (
                    <Loader2 className="w-3 h-3 inline animate-spin text-amber-400 mr-1 align-text-bottom" />
                  )}
                  {isSentenceSpeaking && (
                    <Volume2 className="w-3 h-3 inline text-emerald-400 animate-pulse mr-1 align-text-bottom" />
                  )}
                  {hasDialogue ? (
                    <span
                      dangerouslySetInnerHTML={{
                        __html: sentence.replace(
                          /(["“][^"”]+["”])/g,
                          '<span class="text-cyan-300 font-semibold italic">$1</span>'
                        ),
                      }}
                    />
                  ) : (
                    sentence
                  )}{' '}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
