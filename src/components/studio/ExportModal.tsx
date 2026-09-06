import React, { useState } from 'react';
import { Download, Disc, Check, Loader2, X } from 'lucide-react';
import { ParsedChapter } from '../../engine/parser/documentParser';

interface ExportModalProps {
  isOpen: boolean;
  bookTitle: string;
  author: string;
  chapters: ParsedChapter[];
  onClose: () => void;
  onStartExport: (format: 'm4b' | 'mp3' | 'wav') => Promise<void>;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  bookTitle,
  author,
  chapters,
  onClose,
  onStartExport,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'m4b' | 'mp3' | 'wav'>('m4b');
  const [isExporting, setIsExporting] = useState(false);
  const [progressText, setProgressText] = useState('Ready to build');
  const [progressPercent, setProgressPercent] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  if (!isOpen) return null;

  const includedChapters = chapters.filter(c => c.included);
  const totalWords = includedChapters.reduce((sum, c) => sum + c.wordCount, 0);
  const estimatedMins = Math.round(totalWords / 150);

  const handleExport = async () => {
    setIsExporting(true);
    setProgressPercent(15);
    setProgressText('Preparing chapter markers and metadata...');

    try {
      await onStartExport(selectedFormat);
      setProgressPercent(100);
      setProgressText('Export completed successfully!');
      setIsComplete(true);
    } catch (err) {
      setProgressText('Export failed. Please check logs.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md select-none">
      <div className="w-full max-w-lg rounded-2xl glass-panel border border-white/10 bg-slate-900/95 p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center">
              <Disc className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-100">Export Studio Audiobook</h3>
              <p className="text-xs text-slate-400">{bookTitle} by {author} • {includedChapters.length} chapters</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Format Selector */}
        <div className="space-y-3">
          <label className="text-xs font-semibold text-slate-300 block">Choose Export Format</label>
          <div className="grid grid-cols-3 gap-3">
            {/* M4B */}
            <div
              onClick={() => setSelectedFormat('m4b')}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                selectedFormat === 'm4b'
                  ? 'bg-indigo-600/20 border-indigo-500 shadow-md'
                  : 'bg-slate-800/40 border-white/5 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-indigo-400">.M4B</span>
                {selectedFormat === 'm4b' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
              </div>
              <h5 className="text-xs font-medium text-slate-200">Apple / Audible</h5>
              <p className="text-[10px] text-slate-400 mt-0.5">Chapters & cover art embedded</p>
            </div>

            {/* MP3 */}
            <div
              onClick={() => setSelectedFormat('mp3')}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                selectedFormat === 'mp3'
                  ? 'bg-indigo-600/20 border-indigo-500 shadow-md'
                  : 'bg-slate-800/40 border-white/5 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-indigo-400">.MP3</span>
                {selectedFormat === 'mp3' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
              </div>
              <h5 className="text-xs font-medium text-slate-200">Per-Chapter</h5>
              <p className="text-[10px] text-slate-400 mt-0.5">Universal MP3 compatibility</p>
            </div>

            {/* WAV */}
            <div
              onClick={() => setSelectedFormat('wav')}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                selectedFormat === 'wav'
                  ? 'bg-indigo-600/20 border-indigo-500 shadow-md'
                  : 'bg-slate-800/40 border-white/5 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-xs text-indigo-400">.WAV</span>
                {selectedFormat === 'wav' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
              </div>
              <h5 className="text-xs font-medium text-slate-200">Lossless Master</h5>
              <p className="text-[10px] text-slate-400 mt-0.5">Full uncompressed PCM audio</p>
            </div>
          </div>
        </div>

        {/* Audiobook Summary Stats */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-white/5 text-xs space-y-1.5 font-mono">
          <div className="flex justify-between text-slate-400">
            <span>Total Speaking Time:</span>
            <span className="text-slate-200 font-semibold">~{estimatedMins} minutes</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Included Chapters:</span>
            <span className="text-slate-200 font-semibold">{includedChapters.length} chapters</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Mastering Standard:</span>
            <span className="text-emerald-400 font-semibold">EBU R128 (-18 LUFS)</span>
          </div>
        </div>

        {/* Progress Display */}
        {isExporting && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-300">
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                <span>{progressText}</span>
              </span>
              <span className="font-mono text-indigo-400">{progressPercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Button */}
        <div className="pt-2">
          {isComplete ? (
            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-center gap-2">
              <Check className="w-4 h-4" />
              <span>Audiobook exported to your Downloads folder!</span>
            </div>
          ) : (
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/25 transition-all"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Rendering Audio with Kokoro...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Start Full Audiobook Render</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
