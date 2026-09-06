import React, { useState, useEffect } from 'react';
import { KokoroEngine, EngineStatusInfo } from '../../engine/tts/kokoroEngine';
import { LibraryStorage } from '../../engine/storage/libraryStorage';
import { Cpu, Clock, Zap, Moon, Check, X } from 'lucide-react';

interface ModelMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  engineStatus: EngineStatusInfo;
}

export const ModelMemoryModal: React.FC<ModelMemoryModalProps> = ({
  isOpen,
  onClose,
  engineStatus,
}) => {
  const [idleMinutes, setIdleMinutes] = useState<number>(() => {
    return LibraryStorage.getSettings().idleUnloadMinutes ?? 30;
  });
  const [secondsRemaining, setSecondsRemaining] = useState<number>(-1);
  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);

  // Update idle timer countdown every second while open
  useEffect(() => {
    if (!isOpen) return;

    const tick = () => {
      const remaining = KokoroEngine.getInstance().getIdleTimeRemainingSeconds();
      setSecondsRemaining(remaining);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isOpen, engineStatus]);

  if (!isOpen) return null;

  const handleSelectTimeout = (minutes: number) => {
    setIdleMinutes(minutes);
    KokoroEngine.getInstance().setIdleTimeoutMinutes(minutes);
    const settings = LibraryStorage.getSettings();
    settings.idleUnloadMinutes = minutes;
    LibraryStorage.saveSettings(settings);
  };

  const handleUnloadNow = () => {
    setIsActionInProgress(true);
    KokoroEngine.getInstance().unloadModel();
    setTimeout(() => setIsActionInProgress(false), 300);
  };

  const handlePrewarmNow = async () => {
    setIsActionInProgress(true);
    try {
      await KokoroEngine.getInstance().initialize();
    } finally {
      setIsActionInProgress(false);
    }
  };

  const formatRemainingTime = (sec: number) => {
    if (sec <= 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  const options = [
    { value: 5, label: '5 min', desc: 'Aggressive RAM saver (4GB-8GB laptops)' },
    { value: 15, label: '15 min', desc: 'Balanced idle management' },
    { value: 30, label: '30 min (Default)', desc: 'Recommended: Instant playback within 30 min idle' },
    { value: 60, label: '60 min', desc: 'Long reading sessions' },
    { value: 0, label: 'Never', desc: 'Always keep warm in RAM (~85MB)' },
  ];

  const isModelWarm = engineStatus.status === 'ready';
  const isModelUnloaded = engineStatus.status === 'unloaded' || engineStatus.status === 'uninitialized';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div 
        className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Model Memory & Idle Unload</h2>
              <p className="text-[11px] text-slate-400">RAM conservation vs. instant speech readiness</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Live Engine Status Card */}
        <div className={`p-3.5 rounded-xl border transition-all ${
          isModelWarm 
            ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300' 
            : isModelUnloaded
            ? 'bg-slate-800/40 border-slate-700/50 text-slate-300'
            : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                isModelWarm ? 'bg-emerald-400 animate-pulse' : isModelUnloaded ? 'bg-slate-400' : 'bg-amber-400 animate-pulse'
              }`} />
              {isModelWarm ? 'Model Warm in RAM' : isModelUnloaded ? 'Model Unloaded (Low RAM)' : 'Model Initializing...'}
            </span>
            <span className="text-[11px] font-mono opacity-80">
              {isModelWarm ? '~85MB Active' : '~28MB Idle'}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed opacity-90">
            {isModelWarm && idleMinutes > 0 && secondsRemaining > 0 && (
              <>Idle timer active: auto-unloads in <strong className="font-mono text-white">{formatRemainingTime(secondsRemaining)}</strong> to free laptop RAM. Any play resets this timer.</>
            )}
            {isModelWarm && idleMinutes === 0 && (
              <>Always warm: model remains in RAM indefinitely for instantaneous speech on demand.</>
            )}
            {isModelUnloaded && (
              <>Model unloaded from memory. Next playback will automatically re-warm in background.</>
            )}
            {engineStatus.status === 'loading' && (
              <>{engineStatus.message}</>
            )}
          </p>
        </div>

        {/* Timeout Configuration Options */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
            <span>Idle Timeout Before Unloading:</span>
          </label>
          <div className="space-y-1.5">
            {options.map((opt) => {
              const isSelected = idleMinutes === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleSelectTimeout(opt.value)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-slate-100 shadow-sm'
                      : 'bg-slate-800/40 border-white/5 text-slate-300 hover:bg-slate-800/80 hover:border-white/10'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      {opt.label}
                    </span>
                    <span className="text-[10px] text-slate-400">{opt.desc}</span>
                  </div>
                  {isSelected && (
                    <div className="w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-white">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Manual Power Controls */}
        <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-3">
          {isModelWarm ? (
            <button
              onClick={handleUnloadNow}
              disabled={isActionInProgress}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-rose-950/40 hover:border-rose-500/30 text-rose-300 border border-white/10 transition-all"
              title="Terminate worker immediately to free 85MB RAM"
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Unload Model Now</span>
            </button>
          ) : (
            <button
              onClick={handlePrewarmNow}
              disabled={isActionInProgress || engineStatus.status === 'loading'}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-500/20 transition-all"
              title="Pre-warm Kokoro-82M in background so playback is instant"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Pre-warm Model Now</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/5 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
