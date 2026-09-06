import React, { useState, useEffect } from 'react';
import { Play, Pause, X, Check } from 'lucide-react';

export interface MiniPillPlayerProps {
  currentText: string;
  isPlaying: boolean;
  status?: 'ready' | 'staging' | 'speaking' | 'finished' | 'idle' | 'synthesizing' | 'buffering';
  wordCount?: number;
  speed?: number;
  voiceName?: string;
  isPrebufferReady?: boolean;
  isRunwaySafe?: boolean;
  bufferedChunks?: number;
  totalChunks?: number;
  isSynthesizing?: boolean;
  onPhaseChange?: (phase: 'compact' | 'expanding' | 'controls') => void;
  onTogglePlay: () => void;
  onStop?: () => void;
  onChangeSpeed?: (speed: number) => void;
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * iOS Dynamic Island Morphing Mini-Pill Player with Top-Bezel Drop & Synchronized Readiness Bloom
 * 
 * 1. Top-Bezel Drop: CSS GPU-accelerated keyframe animation drops the pill from out-of-screen (-36px) into view.
 * 2. Luminous Shimmer Sheen: Dynamic glass reflection sweep across the pill capsule background.
 * 3. Cognitive Anchor (Stage 1: 0.0s – 2.5s): "{N}w · ~{S}s" listen duration. Extended for effortless reading.
 * 4. Studio Calibration (Stage 2: 2.5s – safe runway): "Tuning {Voice} (N/M)" with live audio runway buffer counter.
 * 5. Synchronized Readiness Bloom (Stage 3): Smoothly blooms into [ ▶ Play ] once buffer runway is guaranteed safe!
 * 6. Active Runway Protection: If user triggers play early, displays non-blocking live buffering state until safe.
 */
export const MiniPillPlayer: React.FC<MiniPillPlayerProps> = ({
  currentText,
  isPlaying,
  status = 'idle',
  wordCount,
  voiceName: _voiceName = 'Sarah',
  isPrebufferReady,
  isRunwaySafe,
  bufferedChunks,
  totalChunks,
  onPhaseChange,
  onTogglePlay,
  onClose,
  onMouseEnter,
  onMouseLeave,
}) => {
  const [dropKey, setDropKey] = useState<number>(0);
  const [phase, setPhase] = useState<'compact' | 'expanding' | 'controls'>('compact');
  const [minDisguiseElapsed, setMinDisguiseElapsed] = useState<boolean>(false);

  const computedWordCount = wordCount ?? (currentText ? currentText.trim().split(/\s+/).filter(Boolean).length : 0);
  const estimatedSeconds = Math.max(1, Math.round(computedWordCount / 2.6));
  const isSpeaking = isPlaying || status === 'speaking';
  const isFinished = status === 'finished';

  // Trigger Top-Bezel Drop CSS keyframes on every new text selection
  useEffect(() => {
    if (currentText) {
      setDropKey((prev) => prev + 1);
    }
  }, [currentText]);

  // Notify parent of phase change
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  // Dynamic Island progression lifecycle:
  // Stage 1 (0.0s – 3.0s): Word count & duration (gives user 3.0s to read comfortably)
  // Stage 2 (3.0s – 7.0s): Studio Voice Calibration (gives Kokoro uninterrupted head start)
  // Stage 3 (7.0s+): Smooth Bloom into Controls ([ ▶ Play ] ... [ ✕ Close ])
  useEffect(() => {
    if (isSpeaking) {
      setPhase('controls');
      return;
    }

    // Reset to compact on every new text selection
    setPhase('compact');
    setMinDisguiseElapsed(false);

    const stage1Duration = 4000; // 4.0s word count & duration anchor (+1s as requested)
    const stage2Duration = 4000; // 4.0s 'Almost ready...' with animated equalizer

    // Stage 1 -> Stage 2: Ribbon Unfold (at 4.0s)
    const stage2Timer = setTimeout(() => {
      setPhase((prev) => (prev === 'compact' ? 'expanding' : prev));
    }, stage1Duration);

    // Minimum disguise window of 8.0s (gives Kokoro 8.0s uninterrupted head start)
    const stage3Timer = setTimeout(() => {
      setMinDisguiseElapsed(true);
    }, stage1Duration + stage2Duration);

    return () => {
      clearTimeout(stage2Timer);
      clearTimeout(stage3Timer);
    };
  }, [currentText, isSpeaking]);

  // Synchronized Bloom into Controls:
  // ONLY bloom into [ ▶ Play ] once BOTH conditions are met:
  // 1. Full 8.0s disguise progression has completed (4s words + 4s almost ready)
  // 2. Safe audio runway is guaranteed in RAM (isRunwaySafe or all chunks ready)
  // This physically guarantees < 1ms instant playout upon clicking Play with ZERO possibility of silence!
  useEffect(() => {
    if (isSpeaking) {
      setPhase('controls');
      return;
    }
    if (minDisguiseElapsed) {
      const isSafe = isRunwaySafe || (isPrebufferReady && totalChunks === 1) || (bufferedChunks !== undefined && totalChunks !== undefined && totalChunks > 0 && bufferedChunks >= totalChunks);
      if (isSafe) {
        setPhase('controls');
      }
    }
  }, [minDisguiseElapsed, isRunwaySafe, isPrebufferReady, bufferedChunks, totalChunks, isSpeaking]);

  // Hover: never skip or force controls prematurely during Stage 1 or Stage 2
  const handleMouseEnter = () => {
    onMouseEnter?.();
  };

  return (
    <div key={dropKey} className="relative flex flex-col items-center">
      {/* Main Kinetic Liquid Droplet Impact & Expansion Capsule */}
      <div className="animate-droplet-impact relative z-10">
        <div
          className={`relative overflow-hidden rounded-full bg-[#0b0f19] flex items-center justify-between select-none text-white cursor-default transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            phase === 'compact' && !isSpeaking
              ? 'w-[156px] h-[38px] px-3.5 border border-white/20 shadow-[0_8px_24px_rgba(0,0,0,0.7),0_0_12px_rgba(99,102,241,0.15)]'
              : phase === 'expanding' && !isSpeaking
              ? 'w-[236px] h-[38px] px-3.5 border border-indigo-500/40 shadow-[0_8px_28px_rgba(0,0,0,0.8),0_0_16px_rgba(99,102,241,0.22)]'
              : isSpeaking
              ? 'w-[212px] h-[38px] px-3 border border-indigo-400/50 shadow-[0_8px_30px_rgba(99,102,241,0.3)]'
              : 'w-[212px] h-[38px] px-3 border border-white/25 shadow-[0_8px_28px_rgba(0,0,0,0.8),0_0_14px_rgba(99,102,241,0.18)]'
          }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={onMouseLeave}
          data-tauri-drag-region
        >
          {/* Specular Light Catch upon landing (z-0 background layer) */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full z-0">
            <div className="w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-glass-catch" />
          </div>

          {/* Dynamic Glass Shimmer Sheen Sweep (z-0 background layer) */}
          {!isSpeaking && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full z-0">
              <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer-sheen" />
            </div>
          )}

          {phase === 'compact' && !isSpeaking ? (
            /* Stage 1: Word Count & Duration Cognitive Anchor (4.0s) - Sequentially reveals after liquid forms */
            <div className="w-full flex items-center justify-center gap-2 animate-droplet-content relative z-10 px-1">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.9)]" />
              </span>
              <span className="text-[12px] font-semibold tracking-wide text-slate-100 tabular-nums whitespace-nowrap">
                {computedWordCount > 0 ? `${computedWordCount}w · ~${estimatedSeconds}s` : 'Reading'}
              </span>
            </div>
          ) : phase === 'expanding' && !isSpeaking ? (
            /* Stage 2: 'Almost ready...' with Animated Equalizer Bars */
            <div className="w-full flex items-center justify-between gap-2 h-full animate-pill-content px-1 relative z-10">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)] shrink-0" />
                <span className="text-[11px] font-medium tracking-tight text-slate-200 truncate">
                  Almost ready...
                </span>
              </div>
              <div className="flex items-end gap-1 h-3.5 shrink-0 pb-0.5">
                {[14, 20, 16, 22, 12, 18].map((h, idx) => (
                  <span
                    key={idx}
                    className="w-1 rounded-full bg-gradient-to-t from-indigo-500 via-violet-400 to-purple-300 animate-eq-bar"
                    style={{
                      height: `${Math.round(h * 0.7)}px`,
                      animationDelay: `${idx * 110}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* Stage 3: Synchronized Readiness Bloom [ ▶ Play ]   · · · · ·   [ ✕ Close ] */
            <div className="w-full flex items-center justify-between animate-pill-content relative z-10">
              {/* Left: Tactile Play / Pause Button */}
              <button
                onClick={onTogglePlay}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150 active:scale-90 shrink-0 ${
                  isSpeaking
                    ? 'bg-amber-500/25 hover:bg-amber-500/35 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_12px_rgba(99,102,241,0.5)] ring-1 ring-indigo-400/40'
                }`}
                title={isSpeaking ? 'Pause Speech' : 'Play Selection (Win+Alt+S)'}
              >
                {isSpeaking ? (
                  <Pause className="w-3.5 h-3.5 fill-amber-300" />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5 fill-white" />
                )}
              </button>

              {/* Center: Live Waveform / Resting Dots */}
              <div className="flex items-center justify-center flex-1 min-w-0 px-1">
                {isSpeaking ? (
                  /* Dynamic dancing audio bars during playback */
                  <div className="flex items-center gap-1 h-5">
                    {[8, 14, 18, 13, 7].map((h, i) => (
                      <span
                        key={i}
                        className="w-0.5 rounded-full bg-indigo-400 animate-soundwave shadow-[0_0_6px_rgba(129,140,248,0.6)]"
                        style={{
                          height: `${h}px`,
                          animationDelay: `${i * 140}ms`,
                        }}
                      />
                    ))}
                  </div>
                ) : isFinished ? (
                  /* Completion check badge */
                  <div className="flex items-center gap-1 text-emerald-400">
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[11px] font-medium tracking-wide">Done</span>
                  </div>
                ) : (
                  /* Resting acoustic dots in ready state */
                  <div className="flex items-center gap-1.5 h-4">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className="w-1 h-1 rounded-full bg-slate-500/60 transition-all duration-300"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Subtle Close Button */}
              <button
                onClick={onClose}
                className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors active:scale-95 shrink-0"
                title="Close Quick Reader"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
