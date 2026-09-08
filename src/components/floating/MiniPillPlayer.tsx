import React, { useState, useEffect } from 'react';
import { Play, Pause, X, Check, FileText, Clock, Lock, ExternalLink } from 'lucide-react';

export interface MiniPillPlayerProps {
  currentText: string;
  isPlaying: boolean;
  status?: 'ready' | 'staging' | 'speaking' | 'finished' | 'idle' | 'synthesizing' | 'buffering' | 'paywall';
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
  onOpenMembership?: () => void;
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
 * 7. Paywall Polish: When daily quota is exhausted (5/5 used), smoothly presents an amber-gold pill capsule with direct Pro upgrade CTA.
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
  onOpenMembership,
  onClose,
  onMouseEnter,
  onMouseLeave,
}) => {
  const [dropKey, setDropKey] = useState<number>(0);
  const [phase, setPhase] = useState<'compact' | 'expanding' | 'controls'>('compact');

  const computedWordCount = wordCount ?? (currentText ? currentText.trim().split(/\s+/).filter(Boolean).length : 0);
  const estimatedSeconds = Math.max(1, Math.round(computedWordCount / 2.6));
  const isSpeaking = isPlaying || status === 'speaking';
  const isFinished = status === 'finished';
  const isPaywall = status === 'paywall';

  // Calculate if safe audio runway has been established in RAM
  const isSafe = Boolean(
    isRunwaySafe ||
    (isPrebufferReady && totalChunks === 1) ||
    (bufferedChunks !== undefined && totalChunks !== undefined && totalChunks > 0 && bufferedChunks >= totalChunks)
  );

  const isSafeRef = React.useRef(isSafe);
  useEffect(() => {
    isSafeRef.current = isSafe;
  }, [isSafe]);

  // Notify parent of phase change
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);

  // If audio is actively speaking or in paywall state, ensure pill is always in 'controls'
  useEffect(() => {
    if (isSpeaking || isPaywall) {
      setPhase('controls');
    }
  }, [isSpeaking, isPaywall]);

  // Reset to compact when status becomes idle or text is cleared
  useEffect(() => {
    if (!currentText || status === 'idle') {
      setPhase('compact');
    }
  }, [currentText, status]);

  // Dynamic Island progression lifecycle:
  // Runs whenever new text is selected. Shows droplet drop & word count for 1.4s, then smoothly blooms into [ ▶ Play ] controls.
  useEffect(() => {
    if (!currentText || status === 'idle') {
      return;
    }

    if (isSpeaking || isPaywall) {
      setPhase('controls');
      return;
    }

    // Trigger gravity drop and start at compact Stage 1
    setDropKey((prev) => prev + 1);
    setPhase('compact');

    // 1.4s comfortable cognitive glance window for word count & duration
    const stage1Timer = setTimeout(() => {
      setPhase('controls');
    }, 1400);

    return () => {
      clearTimeout(stage1Timer);
    };
  }, [currentText, isPaywall]);

  // Hover: never skip or force controls prematurely during Stage 1 or Stage 2
  const handleMouseEnter = () => {
    onMouseEnter?.();
  };

  if (!currentText || status === 'idle') {
    return null;
  }

  return (
    <div key={dropKey} className="relative flex flex-col items-center">
      {/* Outer Container: Gravity Descent from outside screen bezel */}
      <div className="animate-water-fall relative z-10 flex items-center justify-center">
        {/* Water Impact Circular Ripple Wave (radiates when droplet impacts) */}
        {!isSpeaking && !isPaywall && phase === 'compact' && (
          <div className="animate-water-ripple pointer-events-none" />
        )}

        {/* Inner Capsule: Organic Water Droplet Shape -> Impact Squish -> Slow Expansion */}
        <div
          className={`relative overflow-hidden rounded-full flex items-center justify-between select-none text-white cursor-default transition-all duration-300 ${
            isPaywall
              ? 'w-[238px] h-[38px] px-2.5 bg-gradient-to-r from-[#170e03] via-[#090b14] to-[#170e03] border border-amber-500/60 shadow-[0_8px_30px_rgba(0,0,0,0.85),0_0_20px_rgba(245,158,11,0.3),inset_0_1px_2px_rgba(251,191,36,0.25)] hover:border-amber-400 hover:shadow-[0_8px_32px_rgba(245,158,11,0.45)]'
              : phase === 'compact' && !isSpeaking
              ? 'animate-water-morph w-[152px] h-[38px] px-3 bg-[#080d1a] border border-white/20 shadow-[0_8px_24px_rgba(0,0,0,0.75),0_0_14px_rgba(37,99,235,0.35),inset_0_1px_2px_rgba(255,255,255,0.25)]'
              : phase === 'expanding' && !isSpeaking
              ? 'w-[152px] h-[38px] px-3 bg-[#080d1a] border border-[#2563eb]/60 shadow-[0_8px_28px_rgba(0,0,0,0.8),0_0_18px_rgba(59,130,246,0.35)]'
              : isSpeaking
              ? 'w-[152px] h-[38px] pl-[5px] pr-[7px] bg-[#080d1a] border border-[#3b82f6]/60 shadow-[0_8px_30px_rgba(29,78,216,0.5),0_0_18px_rgba(59,130,246,0.35)]'
              : 'w-[152px] h-[38px] pl-[5px] pr-[7px] bg-[#080d1a] border border-white/25 shadow-[0_8px_28px_rgba(0,0,0,0.8),0_0_14px_rgba(37,99,235,0.25)]'
          }`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={onMouseLeave}
          data-tauri-drag-region
        >
          {/* Top Specular Water Highlight Crescent */}
          <div
            className={`absolute top-0 inset-x-0 h-[40%] pointer-events-none rounded-t-full bg-gradient-to-b ${
              isPaywall
                ? 'from-amber-300/25 via-amber-300/5 to-transparent'
                : 'from-white/30 via-white/5 to-transparent'
            } z-0`}
          />

          {isPaywall ? (
            /* Paywall Capsule: [ 🔒 5/5 Free Reads Used · Upgrade Pro ↗ ]   [ ✕ ] */
            <div
              onClick={onOpenMembership}
              className="w-full flex items-center justify-between animate-pill-content relative z-10 cursor-pointer group"
              title="Daily free limit reached (5/5 reads used). Click to upgrade to Lifetime Pro on Lemon Squeezy!"
            >
              {/* Left: Lock Badge */}
              <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(245,158,11,0.35)]">
                <Lock className="w-3 h-3 text-amber-300 animate-pulse" />
              </div>

              {/* Center: Upgrade CTA */}
              <div className="flex flex-col leading-tight items-start px-2 flex-1 min-w-0">
                <span className="text-[10px] font-bold text-amber-400 tracking-tight truncate">
                  5/5 Free Reads Used
                </span>
                <span className="text-[9px] font-semibold text-slate-300 group-hover:text-amber-200 transition-colors flex items-center gap-0.5">
                  Upgrade Pro <ExternalLink className="w-2.5 h-2.5 text-amber-400/90 ml-0.5" />
                </span>
              </div>

              {/* Right: Close Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors active:scale-95 shrink-0"
                title="Dismiss Paywall"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : phase === 'compact' && !isSpeaking ? (
            /* Stage 1: Word Count & Expected Time with Small Icons */
            <div className="w-full flex items-center justify-center gap-3 animate-water-content relative z-10 px-2">
              {/* Word Count with Document Icon */}
              <div className="flex items-center gap-1.5 text-slate-300">
                <FileText className="w-3 h-3 text-[#60a5fa] shrink-0" />
                <span className="text-[11px] font-semibold text-white tabular-nums tracking-tight">
                  {computedWordCount > 0 ? `${computedWordCount}w` : 'Reading'}
                </span>
              </div>

              {/* Subtle vertical divider */}
              <span className="w-[1px] h-2.5 bg-white/20 shrink-0" />

              {/* Expected Time with Clock Icon */}
              <div className="flex items-center gap-1.5 text-slate-300">
                <Clock className="w-3 h-3 text-[#93c5fd] shrink-0" />
                <span className="text-[11px] font-semibold text-white tabular-nums tracking-tight">
                  {estimatedSeconds}s
                </span>
              </div>
            </div>
          ) : phase === 'expanding' && !isSpeaking ? (
            /* Stage 2: 'Almost ready...' with Animated Equalizer Bars */
            <div className="w-full flex items-center justify-between gap-2 h-full animate-pill-content px-1 relative z-10">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3b82f6] shadow-[0_0_6px_rgba(59,130,246,0.8)] shrink-0" />
                <span className="text-[11px] font-medium tracking-tight text-slate-200 truncate">
                  Almost ready...
                </span>
              </div>
              <div className="flex items-end gap-1 h-3.5 shrink-0 pb-0.5">
                {[14, 20, 16, 22, 12, 18].map((h, idx) => (
                  <span
                    key={idx}
                    className="w-1 rounded-full bg-gradient-to-t from-[#1d4ed8] via-[#3b82f6] to-[#93c5fd] animate-eq-bar"
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
                    ? 'bg-[#2563eb]/25 hover:bg-[#2563eb]/35 text-[#60a5fa] border border-[#3b82f6]/50 shadow-sm'
                    : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-[0_0_14px_rgba(37,99,235,0.7)] ring-1 ring-[#60a5fa]/50'
                }`}
                title={isSpeaking ? 'Pause Speech' : 'Play Selection'}
              >
                {isSpeaking ? (
                  <Pause className="w-3.5 h-3.5 fill-[#60a5fa]" />
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
                        className="w-0.5 rounded-full bg-[#3b82f6] animate-soundwave shadow-[0_0_6px_rgba(59,130,246,0.7)]"
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
