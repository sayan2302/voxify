import React, { useState, useEffect } from 'react';
import { KOKORO_VOICES, VoiceBlendConfig } from '../../engine/tts/kokoroEngine';
import {
  Volume2,
  VolumeX,
  Sliders,
  MessageSquare,
  Sparkles,
  Check,
  Loader2,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  Compass,
  Feather,
  Radio,
  UserCheck
} from 'lucide-react';

export interface VoicePreviewState {
  voiceId: string;
  status: 'synthesizing' | 'playing';
}

interface VoiceStudioProps {
  selectedVoice: string;
  dialogueVoice: string;
  enableDialogueSeparation: boolean;
  voiceBlends: VoiceBlendConfig[];
  previewState?: VoicePreviewState | null;
  onSelectVoice: (voiceId: string) => void;
  onSelectDialogueVoice: (voiceId: string) => void;
  onToggleDialogueSeparation: (enabled: boolean) => void;
  onSaveVoiceBlend: (blend: VoiceBlendConfig) => void;
  onPreviewVoice: (voiceId: string) => void;
  onPreviewBlend?: (blend: VoiceBlendConfig) => void;
}

export interface CuratedPreset {
  id: string;
  presetTitle: string;
  voiceId: string;
  speakerName: string;
  gender: 'female' | 'male';
  accent: 'american' | 'british';
  categoryBadge: string;
  tagline: string;
  bestFor: string;
  icon: 'narrator' | 'storyteller' | 'cinematic' | 'classic' | 'modern';
}

export const CURATED_PRESETS: CuratedPreset[] = [
  {
    id: 'preset_narrator',
    presetTitle: 'The Narrator',
    voiceId: 'af_heart',
    speakerName: 'Heart',
    gender: 'female',
    accent: 'american',
    categoryBadge: 'Audiobook Default',
    tagline: 'Warm, natural, and clear — the flagship voice for fatigue-free long listening.',
    bestFor: 'Novels • Non-fiction • Biographies',
    icon: 'narrator',
  },
  {
    id: 'preset_storyteller',
    presetTitle: 'The Storyteller',
    voiceId: 'af_bella',
    speakerName: 'Bella',
    gender: 'female',
    accent: 'american',
    categoryBadge: 'Fiction & Melodic',
    tagline: 'Gentle, expressive, and melodic cadence that brings fictional characters to life.',
    bestFor: 'Fantasy • Drama • Children Stories',
    icon: 'storyteller',
  },
  {
    id: 'preset_cinematic',
    presetTitle: 'Cinematic Baritone',
    voiceId: 'am_adam',
    speakerName: 'Adam',
    gender: 'male',
    accent: 'american',
    categoryBadge: 'Deep & Dramatic',
    tagline: 'Deep, authoritative, and cinematic voice with a commanding narrative presence.',
    bestFor: 'Thrillers • Sci-Fi • Documentaries',
    icon: 'cinematic',
  },
  {
    id: 'preset_classic',
    presetTitle: 'Classic BBC',
    voiceId: 'bm_george',
    speakerName: 'George',
    gender: 'male',
    accent: 'british',
    categoryBadge: 'Scholarly & Period',
    tagline: 'Distinguished, scholarly British RP narrator for refined period and classic literature.',
    bestFor: 'Classics • History • Academic Works',
    icon: 'classic',
  },
  {
    id: 'preset_modern',
    presetTitle: 'Modern & Energetic',
    voiceId: 'af_sarah',
    speakerName: 'Sarah',
    gender: 'female',
    accent: 'american',
    categoryBadge: 'Fast Reads & Podcasts',
    tagline: 'Youthful, lively, and articulate modern voice that keeps you focused on fast reads.',
    bestFor: 'Articles • Newsletters • Podcasts',
    icon: 'modern',
  },
];

export const VoiceStudio: React.FC<VoiceStudioProps> = ({
  selectedVoice,
  dialogueVoice,
  enableDialogueSeparation,
  voiceBlends,
  previewState,
  onSelectVoice,
  onSelectDialogueVoice,
  onToggleDialogueSeparation,
  onSaveVoiceBlend,
  onPreviewVoice,
  onPreviewBlend,
}) => {
  // Mode: 'simple' (default 5 curated presets) vs 'advanced' (all 24 voices, blender, dialogue)
  const [studioMode, setStudioMode] = useState<'simple' | 'advanced'>(() => {
    return (localStorage.getItem('vocalis_studio_mode') as 'simple' | 'advanced') || 'simple';
  });

  const [advancedTab, setAdvancedTab] = useState<'catalog' | 'blender' | 'dialogue'>('catalog');
  const [accentFilter, setAccentFilter] = useState<'all' | 'american' | 'british'>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'female' | 'male'>('all');

  // Blender state
  const [blendPrimary, setBlendPrimary] = useState<string>(selectedVoice);
  const [blendSecondary, setBlendSecondary] = useState<string>('af_bella');
  const [blendRatio, setBlendRatio] = useState<number>(0.7);
  const [customBlendName, setCustomBlendName] = useState<string>('My Custom Voice');
  const [blendSaved, setBlendSaved] = useState<boolean>(false);

  useEffect(() => {
    localStorage.setItem('vocalis_studio_mode', studioMode);
  }, [studioMode]);

  const filteredVoices = KOKORO_VOICES.filter(v => {
    if (accentFilter !== 'all' && v.accent !== accentFilter) return false;
    if (genderFilter !== 'all' && v.gender !== genderFilter) return false;
    return true;
  });

  const handleSaveBlend = () => {
    onSaveVoiceBlend({
      primaryVoice: blendPrimary,
      secondaryVoice: blendSecondary,
      blendRatio,
      customName: customBlendName.trim() || 'Custom Voice',
    });
    setBlendSaved(true);
    setTimeout(() => setBlendSaved(false), 2500);
  };

  const isCurrentVoiceInPresets = CURATED_PRESETS.some(p => p.voiceId === selectedVoice);
  const currentVoiceObj = KOKORO_VOICES.find(v => v.id === selectedVoice);

  const renderPresetIcon = (type: CuratedPreset['icon']) => {
    switch (type) {
      case 'narrator':
        return <Sparkles className="w-4 h-4 text-indigo-400" />;
      case 'storyteller':
        return <BookOpen className="w-4 h-4 text-violet-400" />;
      case 'cinematic':
        return <Compass className="w-4 h-4 text-cyan-400" />;
      case 'classic':
        return <Feather className="w-4 h-4 text-amber-400" />;
      case 'modern':
        return <Radio className="w-4 h-4 text-emerald-400" />;
    }
  };

  return (
    <div className="w-96 h-full flex flex-col glass-panel border-l border-white/5 select-none bg-slate-900/40">
      {/* Top Header: Mode Switcher (Simple vs Advanced) */}
      <div className="p-3 border-b border-white/5 flex items-center justify-between bg-slate-950/80">
        <div>
          <h3 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>VOICE STUDIO</span>
          </h3>
          <p className="text-[10px] text-slate-400">
            {studioMode === 'simple' ? '5 Curated Presets' : 'Full Catalog & Studio'}
          </p>
        </div>

        {/* Mode Toggle Pills */}
        <div className="flex bg-slate-900 border border-white/10 rounded-lg p-0.5 text-[11px]">
          <button
            onClick={() => setStudioMode('simple')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              studioMode === 'simple'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Simple
          </button>
          <button
            onClick={() => setStudioMode('advanced')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all flex items-center gap-1 ${
              studioMode === 'advanced'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3 h-3" />
            <span>Advanced</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SIMPLE MODE: 5 Curated, Non-Overwhelming Presets                           */}
      {/* ========================================================================= */}
      {studioMode === 'simple' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Helpful Subtitle */}
          <div className="px-3.5 py-2.5 bg-slate-950/40 border-b border-white/5 flex items-center justify-between">
            <span className="text-[11px] text-slate-300 font-medium">
              Select a voice preset for your book:
            </span>
            <span className="text-[10px] text-slate-500 font-mono">1-Click Apply</span>
          </div>

          {/* Active Voice Info if chosen outside presets */}
          {!isCurrentVoiceInPresets && currentVoiceObj && (
            <div className="mx-3 mt-3 p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-500/30 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <UserCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="truncate">
                  <span className="text-[11px] text-slate-300">Custom selection: </span>
                  <span className="font-semibold text-white">{currentVoiceObj.name}</span>
                  <span className="text-[10px] text-slate-400 capitalize ml-1.5">
                    ({currentVoiceObj.gender} • {currentVoiceObj.accent})
                  </span>
                </div>
              </div>
              <button
                onClick={() => onSelectVoice('af_heart')}
                className="text-[10px] px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white shrink-0 ml-2"
              >
                Reset Default
              </button>
            </div>
          )}

          {/* Presets List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {CURATED_PRESETS.map((preset) => {
              const isSelected = preset.voiceId === selectedVoice;
              const isPreviewActive = previewState?.voiceId === preset.voiceId;
              const isSynthesizing = isPreviewActive && previewState?.status === 'synthesizing';
              const isSpeaking = isPreviewActive && previewState?.status === 'playing';

              return (
                <div
                  key={preset.id}
                  onClick={() => onSelectVoice(preset.voiceId)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer relative group ${
                    isSpeaking
                      ? 'bg-emerald-950/25 border-emerald-500 text-white shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/40'
                      : isSynthesizing
                      ? 'bg-amber-950/25 border-amber-500/60 text-white shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/40'
                      : isSelected
                      ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md ring-1 ring-indigo-500/30'
                      : 'bg-slate-800/40 border-white/5 hover:border-slate-600 hover:bg-slate-800/60 text-slate-300'
                  }`}
                >
                  {/* Top Bar: Icon, Name, Category Badge & Audition Button */}
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-lg bg-slate-800/80 border border-white/5 flex items-center justify-center shrink-0">
                        {renderPresetIcon(preset.icon)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-white tracking-tight truncate">
                            {preset.presetTitle}
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            ({preset.speakerName})
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Status Badges & Audition Action */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isSynthesizing && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                          <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400" />
                          <span>Generating...</span>
                        </span>
                      )}

                      {isSpeaking && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                          <span>Speaking</span>
                        </span>
                      )}

                      {isSelected && !isSynthesizing && !isSpeaking && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/25 text-indigo-300 border border-indigo-500/40 shadow-xs">
                          <Check className="w-2.5 h-2.5 text-indigo-400" />
                          <span>Active</span>
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreviewVoice(preset.voiceId);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                          isSpeaking
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                            : isSynthesizing
                            ? 'bg-amber-600 text-white'
                            : 'bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 hover:text-white'
                        }`}
                        title={isSpeaking ? 'Stop audition' : isSynthesizing ? 'Synthesizing voice sample...' : 'Audition voice'}
                      >
                        {isSynthesizing ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin text-white" />
                            <span className="text-[10px]">Loading</span>
                          </>
                        ) : isSpeaking ? (
                          <>
                            <VolumeX className="w-3 h-3 text-white" />
                            <span className="text-[10px]">Stop</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3 h-3" />
                            <span className="text-[10px]">Audition</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Tagline / Description */}
                  <p className="text-[11px] text-slate-300/90 leading-relaxed mb-2">
                    {preset.tagline}
                  </p>

                  {/* Best For Tags & Badge */}
                  <div className="flex items-center justify-between gap-1 pt-1 border-t border-white/5 text-[10px]">
                    <span className="text-slate-400 font-medium truncate">
                      {preset.bestFor}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[9px] capitalize shrink-0">
                      {preset.gender} • {preset.accent}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Link to Advanced Studio */}
            <div className="pt-2 pb-1">
              <button
                type="button"
                onClick={() => setStudioMode('advanced')}
                className="w-full p-3 rounded-xl border border-dashed border-indigo-500/30 hover:border-indigo-500/60 bg-indigo-950/15 hover:bg-indigo-950/30 text-indigo-200 text-xs font-medium flex items-center justify-between transition-all group shadow-sm"
              >
                <div className="flex items-center gap-2 text-left">
                  <Sliders className="w-4 h-4 text-indigo-400 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="font-semibold text-white">Advanced Voice Studio</div>
                    <div className="text-[10px] text-indigo-300/70">
                      Explore all 24 voices, custom voice blending, & dialogue splitting
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-indigo-400 group-hover:translate-x-1 transition-transform shrink-0" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* ADVANCED MODE: Complete Studio Suite (Catalog, Blender, Dialogue)         */}
      {/* ========================================================================= */}
      {studioMode === 'advanced' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Back to Simple button & Advanced Subtabs */}
          <div className="border-b border-white/5 bg-slate-950/60 p-1.5 flex flex-col gap-1.5">
            <button
              onClick={() => setStudioMode('simple')}
              className="text-[11px] text-slate-400 hover:text-indigo-300 flex items-center gap-1 px-1.5 py-0.5 transition-colors self-start"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Back to Curated Presets</span>
            </button>

            <div className="flex gap-1">
              <button
                onClick={() => setAdvancedTab('catalog')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  advancedTab === 'catalog'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>All Voices ({KOKORO_VOICES.length})</span>
              </button>
              <button
                onClick={() => setAdvancedTab('blender')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  advancedTab === 'blender'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Blender</span>
              </button>
              <button
                onClick={() => setAdvancedTab('dialogue')}
                className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                  advancedTab === 'dialogue'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Dialogue</span>
              </button>
            </div>
          </div>

          {/* Subtab 1: All Voices Catalog */}
          {advancedTab === 'catalog' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Filters */}
              <div className="p-3 border-b border-white/5 flex gap-2">
                <select
                  value={accentFilter}
                  onChange={(e) => setAccentFilter(e.target.value as any)}
                  className="flex-1 bg-slate-800/80 border border-white/5 rounded-lg px-2.5 py-1 text-xs text-slate-300 outline-none"
                >
                  <option value="all">All Accents</option>
                  <option value="american">American</option>
                  <option value="british">British</option>
                </select>
                <select
                  value={genderFilter}
                  onChange={(e) => setGenderFilter(e.target.value as any)}
                  className="flex-1 bg-slate-800/80 border border-white/5 rounded-lg px-2.5 py-1 text-xs text-slate-300 outline-none"
                >
                  <option value="all">All Genders</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
              </div>

              {/* Voice Cards */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filteredVoices.map((voice) => {
                  const isSelected = voice.id === selectedVoice;
                  const isPreviewActive = previewState?.voiceId === voice.id;
                  const isSynthesizing = isPreviewActive && previewState?.status === 'synthesizing';
                  const isSpeaking = isPreviewActive && previewState?.status === 'playing';

                  return (
                    <div
                      key={voice.id}
                      onClick={() => onSelectVoice(voice.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                        isSpeaking
                          ? 'bg-emerald-950/20 border-emerald-500 text-white shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/40'
                          : isSynthesizing
                          ? 'bg-amber-950/20 border-amber-500/60 text-white shadow-lg shadow-amber-500/10 ring-1 ring-amber-500/40'
                          : isSelected
                          ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md'
                          : 'bg-slate-800/40 border-white/5 hover:border-slate-600 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-xs text-slate-100 truncate">{voice.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 capitalize shrink-0">
                            {voice.gender} • {voice.accent}
                          </span>
                        </div>

                        {/* Status Pill & Action Button */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isSynthesizing && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                              <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400" />
                              <span>Generating...</span>
                            </span>
                          )}

                          {isSpeaking && (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                              <span>Speaking</span>
                            </span>
                          )}

                          {isSelected && !isSynthesizing && !isSpeaking && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              <Check className="w-2.5 h-2.5 text-indigo-400" />
                              <span>Active</span>
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onPreviewVoice(voice.id);
                            }}
                            className={`px-2 py-1 rounded-lg text-xs font-medium transition-all flex items-center gap-1 ${
                              isSpeaking
                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm'
                                : isSynthesizing
                                ? 'bg-amber-600 text-white'
                                : 'bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 hover:text-white'
                            }`}
                            title={isSpeaking ? 'Stop playback' : isSynthesizing ? 'Synthesizing voice sample...' : 'Preview Voice'}
                          >
                            {isSynthesizing ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin text-white" />
                                <span className="text-[10px]">Loading</span>
                              </>
                            ) : isSpeaking ? (
                              <>
                                <VolumeX className="w-3 h-3 text-white" />
                                <span className="text-[10px]">Stop</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3 h-3" />
                                <span className="text-[10px]">Audition</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                        {voice.description}
                      </p>

                      <div className="flex flex-wrap gap-1 mt-2">
                        {voice.traits.map((t, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.2 rounded-full bg-slate-900/60 text-slate-400">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Subtab 2: Vector Voice Blender */}
          {advancedTab === 'blender' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/20 text-xs text-indigo-200 flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <p>
                  Kokoro Voice Blender linearly interpolates between two voice embeddings to craft a totally unique signature sound.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Primary Voice (Base)</label>
                <select
                  value={blendPrimary}
                  onChange={(e) => setBlendPrimary(e.target.value)}
                  className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-slate-200 outline-none"
                >
                  {KOKORO_VOICES.map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.gender}, {v.accent})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Secondary Voice (Color)</label>
                <select
                  value={blendSecondary}
                  onChange={(e) => setBlendSecondary(e.target.value)}
                  className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-slate-200 outline-none"
                >
                  {KOKORO_VOICES.map(v => (
                    <option key={v.id} value={v.id}>{v.name} ({v.gender}, {v.accent})</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-400 mb-1">
                  <span>Blend Ratio</span>
                  <span className="font-mono text-indigo-400">
                    {Math.round(blendRatio * 100)}% / {Math.round((1 - blendRatio) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={blendRatio}
                  onChange={(e) => setBlendRatio(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1.5">Preset Name</label>
                <input
                  type="text"
                  value={customBlendName}
                  onChange={(e) => setCustomBlendName(e.target.value)}
                  className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-slate-200 outline-none"
                  placeholder="e.g. Midnight Storyteller"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    onPreviewBlend?.({
                      primaryVoice: blendPrimary,
                      secondaryVoice: blendSecondary,
                      blendRatio,
                      customName: customBlendName,
                    })
                  }
                  className={`flex-1 py-2 px-3 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                    previewState?.voiceId === 'blend_preview' && previewState.status === 'playing'
                      ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                      : previewState?.voiceId === 'blend_preview' && previewState.status === 'synthesizing'
                      ? 'bg-amber-600 border-amber-500 text-white animate-pulse'
                      : 'bg-slate-800/80 hover:bg-slate-700/80 border-white/10 text-slate-200'
                  }`}
                >
                  {previewState?.voiceId === 'blend_preview' && previewState.status === 'synthesizing' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Synthesizing...</span>
                    </>
                  ) : previewState?.voiceId === 'blend_preview' && previewState.status === 'playing' ? (
                    <>
                      <VolumeX className="w-3.5 h-3.5" />
                      <span>Stop Sound</span>
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Audition Blend</span>
                    </>
                  )}
                </button>

                <button
                  onClick={handleSaveBlend}
                  className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all shadow-md"
                >
                  {blendSaved ? (
                    <>
                      <Check className="w-4 h-4 text-white" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Save Preset</span>
                    </>
                  )}
                </button>
              </div>

              {/* Saved Presets */}
              {voiceBlends.length > 0 && (
                <div className="pt-4 border-t border-white/5 space-y-2">
                  <h4 className="text-xs font-semibold text-slate-300">Saved Presets ({voiceBlends.length})</h4>
                  <div className="space-y-1.5">
                    {voiceBlends.map((b, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          setBlendPrimary(b.primaryVoice);
                          setBlendSecondary(b.secondaryVoice);
                          setBlendRatio(b.blendRatio);
                          if (b.customName) setCustomBlendName(b.customName);
                        }}
                        className="p-2 rounded-lg bg-slate-800/60 border border-white/5 hover:border-indigo-500/40 cursor-pointer flex items-center justify-between text-xs text-slate-200"
                      >
                        <span className="font-medium">{b.customName || `Blend ${i + 1}`}</span>
                        <span className="text-[10px] font-mono text-indigo-400">
                          {Math.round(b.blendRatio * 100)}% / {Math.round((1 - b.blendRatio) * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subtab 3: Dialogue & Character Separation */}
          {advancedTab === 'dialogue' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="p-3 rounded-xl bg-slate-800/50 border border-white/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-100">Multi-Speaker Story Mode</h3>
                    <p className="text-[11px] text-slate-400">Separates quoted dialogue from narration</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={enableDialogueSeparation}
                    onChange={(e) => onToggleDialogueSeparation(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500 rounded cursor-pointer"
                  />
                </div>
              </div>

              {enableDialogueSeparation && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-slate-300">Narrator Voice (Default)</label>
                      <button
                        type="button"
                        onClick={() => onPreviewVoice(selectedVoice)}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        {previewState?.voiceId === selectedVoice && previewState.status === 'synthesizing' ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Loading...</span>
                          </>
                        ) : previewState?.voiceId === selectedVoice && previewState.status === 'playing' ? (
                          <>
                            <VolumeX className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">Stop</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3 h-3" />
                            <span>Audition</span>
                          </>
                        )}
                      </button>
                    </div>
                    <select
                      value={selectedVoice}
                      onChange={(e) => onSelectVoice(e.target.value)}
                      className="w-full bg-slate-800/80 border border-white/10 rounded-lg p-2 text-xs text-slate-200 outline-none"
                    >
                      {KOKORO_VOICES.map(v => (
                        <option key={v.id} value={v.id}>{v.name} ({v.gender}, {v.accent})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-cyan-300">Spoken Dialogue Voice</label>
                      <button
                        type="button"
                        onClick={() => onPreviewVoice(dialogueVoice)}
                        className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                      >
                        {previewState?.voiceId === dialogueVoice && previewState.status === 'synthesizing' ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Loading...</span>
                          </>
                        ) : previewState?.voiceId === dialogueVoice && previewState.status === 'playing' ? (
                          <>
                            <VolumeX className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400 font-medium">Stop</span>
                          </>
                        ) : (
                          <>
                            <Volume2 className="w-3 h-3" />
                            <span>Audition</span>
                          </>
                        )}
                      </button>
                    </div>
                    <select
                      value={dialogueVoice}
                      onChange={(e) => onSelectDialogueVoice(e.target.value)}
                      className="w-full bg-slate-800/80 border border-cyan-500/30 rounded-lg p-2 text-xs text-cyan-100 outline-none"
                    >
                      {KOKORO_VOICES.map(v => (
                        <option key={v.id} value={v.id}>{v.name} ({v.gender}, {v.accent})</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Text inside quotes will automatically be voiced by this persona.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
