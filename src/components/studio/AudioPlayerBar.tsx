import React, { useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Download, Sliders, Loader2 } from 'lucide-react';
import { MasteringConfig } from '../../engine/audio/audioMastering';

interface AudioPlayerBarProps {
  isPlaying: boolean;
  isSynthesizing?: boolean;
  synthesizingVoiceName?: string;
  currentSentence: string;
  currentSentenceIndex: number;
  totalSentences: number;
  speed: number;
  masteringConfig: MasteringConfig;
  onTogglePlay: () => void;
  onNextSentence: () => void;
  onPrevSentence: () => void;
  onChangeSpeed: (speed: number) => void;
  onUpdateMasteringConfig: (config: MasteringConfig) => void;
  onExportAudiobook: () => void;
  idleUnloadMinutes?: number;
  onUpdateIdleMinutes?: (minutes: number) => void;
  onOpenMemoryModal?: () => void;
  isReadingSelection?: boolean;
  readingSelectionText?: string | null;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  isPlaying,
  isSynthesizing = false,
  synthesizingVoiceName,
  currentSentence,
  currentSentenceIndex,
  totalSentences,
  speed,
  masteringConfig,
  onTogglePlay,
  onNextSentence,
  onPrevSentence,
  onChangeSpeed,
  onUpdateMasteringConfig,
  onExportAudiobook,
  idleUnloadMinutes = 30,
  onUpdateIdleMinutes,
  onOpenMemoryModal,
  isReadingSelection = false,
  readingSelectionText = null,
}) => {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const speeds = [0.8, 0.9, 1.0, 1.25, 1.5, 2.0];
  const progressPercent = totalSentences > 0 ? Math.round(((currentSentenceIndex + 1) / totalSentences) * 100) : 0;

  return (
    <div className="h-20 glass-panel border-t border-white/5 px-6 flex items-center justify-between gap-6 select-none bg-slate-950/80 backdrop-blur-xl relative z-30">
      {/* Left: Sentence preview & Progress */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        {/* Animated Sound Wave Bars when playing */}
        <div className="flex items-center gap-0.5 h-6 shrink-0">
          {[4, 16, 8, 22, 12, 18, 6, 14].map((h, i) => (
            <div
              key={i}
              className={`w-1 rounded-full transition-all duration-300 ${
                isSynthesizing
                  ? 'bg-amber-400 animate-pulse'
                  : isPlaying
                  ? 'bg-indigo-500 animate-pulse'
                  : 'bg-slate-700 opacity-40'
              }`}
              style={{
                height: isPlaying && !isSynthesizing ? `${Math.max(4, (h * (i % 2 === 0 ? 1.2 : 0.8)))}px` : isSynthesizing ? '8px' : '4px',
                animationDelay: `${i * 120}ms`,
              }}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isSynthesizing ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse shrink-0">
                <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400" />
                <span>Synthesizing ({synthesizingVoiceName || 'Kokoro'})...</span>
              </span>
            ) : isReadingSelection && isPlaying ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                <span>Reading Selection</span>
              </span>
            ) : isPlaying ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>Speaking</span>
              </span>
            ) : null}

            <p className="text-xs text-slate-200 font-medium truncate max-w-xl">
              {currentSentence || 'Select a chapter or sentence to begin listening'}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 font-mono">
            <span>
              {isReadingSelection
                ? `Selection (${readingSelectionText ? readingSelectionText.split(/\s+/).filter(Boolean).length : 0} words)`
                : totalSentences > 0
                ? `Sentence ${currentSentenceIndex + 1} of ${totalSentences}`
                : '0 / 0'}
            </span>
            <span>•</span>
            <span>{isReadingSelection ? 'Selected Part Only' : `${progressPercent}% completed`}</span>
            {isSynthesizing && (
              <>
                <span>•</span>
                <span className="text-amber-400 font-sans">Generating audio...</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Center: Playback Controls */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onPrevSentence}
          className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
          title="Previous Sentence"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={onTogglePlay}
          className={`w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-105 ${
            isSynthesizing
              ? 'bg-amber-600 hover:bg-amber-500 text-white ring-4 ring-amber-500/30'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/25'
          }`}
          title={
            isSynthesizing
              ? 'Synthesizing audio with Kokoro-82M...'
              : isPlaying
              ? 'Pause Audio'
              : 'Play Sentence'
          }
        >
          {isSynthesizing ? (
            <Loader2 className="w-5 h-5 animate-spin text-white" />
          ) : isPlaying ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" />
          )}
        </button>

        <button
          onClick={onNextSentence}
          className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
          title="Next Sentence"
        >
          <SkipForward className="w-4 h-4" />
        </button>
      </div>

      {/* Right: Speed, Ambience & Export */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Speed Multiplier Pill */}
        <div className="flex items-center bg-slate-900/80 p-0.5 rounded-lg border border-white/5">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => onChangeSpeed(s)}
              className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                speed === s
                  ? 'bg-indigo-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Mastering / Pauses Settings */}
        <button
          onClick={() => setShowSettingsModal(!showSettingsModal)}
          className={`p-2 rounded-lg border transition-colors ${
            showSettingsModal
              ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300'
              : 'bg-slate-900/80 border-white/5 text-slate-400 hover:text-white'
          }`}
          title="Audio Mastering & Cadence Settings"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Export Audiobook Button */}
        <button
          onClick={onExportAudiobook}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-indigo-500/20 transition-all hover:scale-[1.02]"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Audiobook</span>
        </button>
      </div>

      {/* Mastering / Pauses Settings Modal Popover */}
      {showSettingsModal && (
        <div className="absolute bottom-24 right-6 w-80 p-4 rounded-xl glass-panel border border-white/10 bg-slate-900/95 backdrop-blur-2xl shadow-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <h3 className="text-xs font-semibold text-slate-100 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Studio Mastering & Pauses</span>
            </h3>
            <button
              onClick={() => setShowSettingsModal(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Pause lengths */}
          <div className="space-y-3 text-xs">
            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Sentence Pause</span>
                <span className="font-mono text-indigo-400">{masteringConfig.sentencePauseMs}ms</span>
              </div>
              <input
                type="range"
                min="100"
                max="800"
                step="50"
                value={masteringConfig.sentencePauseMs}
                onChange={(e) =>
                  onUpdateMasteringConfig({
                    ...masteringConfig,
                    sentencePauseMs: parseInt(e.target.value),
                  })
                }
                className="w-full accent-indigo-500 h-1 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-slate-300 mb-1">
                <span>Paragraph Pause</span>
                <span className="font-mono text-indigo-400">{masteringConfig.paragraphPauseMs}ms</span>
              </div>
              <input
                type="range"
                min="300"
                max="1500"
                step="50"
                value={masteringConfig.paragraphPauseMs}
                onChange={(e) =>
                  onUpdateMasteringConfig({
                    ...masteringConfig,
                    paragraphPauseMs: parseInt(e.target.value),
                  })
                }
                className="w-full accent-indigo-500 h-1 bg-slate-800 rounded cursor-pointer"
              />
            </div>

            <div>
              <label className="text-slate-300 block mb-1 font-medium">Ambient Background Soundscape</label>
              <select
                value={masteringConfig.ambientSound}
                onChange={(e) =>
                  onUpdateMasteringConfig({
                    ...masteringConfig,
                    ambientSound: e.target.value as any,
                  })
                }
                className="w-full bg-slate-800 border border-white/10 rounded-lg p-1.5 text-xs text-slate-200 outline-none"
              >
                <option value="none">None (Pure Digital Silence)</option>
                <option value="tape-warmth">Warm Analog Tape Hiss</option>
                <option value="rain">Gentle Rain Shower</option>
                <option value="library">Quiet Library Atmosphere</option>
              </select>
            </div>

            <div className="pt-2 border-t border-white/5">
              <div className="flex justify-between items-center text-slate-300 mb-1">
                <span className="font-medium">Model RAM Idle Timeout</span>
                {onOpenMemoryModal && (
                  <button
                    onClick={onOpenMemoryModal}
                    className="text-indigo-400 hover:text-indigo-300 text-[11px] underline"
                  >
                    Details
                  </button>
                )}
              </div>
              <select
                value={idleUnloadMinutes}
                onChange={(e) => onUpdateIdleMinutes?.(parseInt(e.target.value))}
                className="w-full bg-slate-800 border border-white/10 rounded-lg p-1.5 text-xs text-slate-200 outline-none"
              >
                <option value={5}>5 min (Aggressive RAM saver)</option>
                <option value={15}>15 min (Balanced)</option>
                <option value={30}>30 min (Default: Instant for 30m)</option>
                <option value={60}>60 min (Extended)</option>
                <option value={0}>Never (Always Warm in RAM)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
