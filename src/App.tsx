import React, { useState, useEffect, useRef } from 'react';
import { MiniPillPlayer } from './components/floating/MiniPillPlayer';
import {
  Sparkles,
  Sliders,
  History,
  Info,
  Play,
  Trash2,
  Copy,
  Power,
  Terminal,
  Check,
  RefreshCw,
  CheckCircle2,
  ArrowUpCircle,
  Download,
  Key,
  ShieldCheck,
  Lock,
  AlertCircle,
  X,
  Laptop,
  Infinity,
  Feather,
  Command,
  Volume2,
  Layers,
  Crown,
  ShoppingBag,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export interface HudStatusPayload {
  status: 'ready' | 'staging' | 'synthesizing' | 'speaking' | 'finished' | 'idle' | 'buffering';
  text: string;
  voiceName: string;
  speed: number;
  wordCount?: number;
}

export interface AutoReadConfig {
  master_enabled?: boolean;
  auto_read_selection: boolean;
  auto_copy_selection?: boolean;
  auto_read_copy: boolean;
  activation_shortcut?: string;
  read_history_shortcut_enabled?: boolean;
  settle_delay_ms: number;
  earcon_enabled: boolean;
  api_service_enabled?: boolean;
}

export interface HistoryItem {
  id: string;
  text: string;
  voiceName: string;
  timestamp: string;
  wordCount: number;
}

const FIXED_VOICE = 'Sarah';
const FIXED_SPEED = 1.0;
const ACTIVATION_SHORTCUT = 'Win + Alt + S';
export const DAILY_TRIGGER_LIMIT = 5;
export const LEMON_SQUEEZY_CHECKOUT_URL = 'https://voxify.lemonsqueezy.com/buy/license';

export interface DailyUsage {
  date: string; // YYYY-MM-DD
  triggersUsed: number;
}

const getTodayDateString = (): string => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};

const getInitialDailyUsage = (): DailyUsage => {
  try {
    const today = getTodayDateString();
    const saved = localStorage.getItem('voxify_daily_usage');
    if (saved) {
      const parsed: DailyUsage = JSON.parse(saved);
      if (parsed.date === today) {
        return parsed;
      }
    }
    const fresh: DailyUsage = { date: today, triggersUsed: 0 };
    localStorage.setItem('voxify_daily_usage', JSON.stringify(fresh));
    return fresh;
  } catch {
    return { date: getTodayDateString(), triggersUsed: 0 };
  }
};

/**
 * Info Tooltip Component with Handy-style (i) icon
 */
const InfoTooltip: React.FC<{ text: string }> = ({ text }) => {
  const [show, setShow] = useState(false);

  return (
    <span
      className="relative inline-flex items-center ml-1.5 cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="w-4 h-4 rounded-full border border-slate-600/70 text-slate-400 hover:text-slate-200 hover:border-slate-400 text-[10px] flex items-center justify-center font-serif italic transition-colors">
        i
      </span>
      {show && (
        <span className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-60 p-2.5 rounded-lg bg-[#18181b]/95 border border-[#2563eb]/40 text-[11px] text-slate-200 shadow-2xl backdrop-blur-md leading-relaxed pointer-events-none">
          {text}
        </span>
      )}
    </span>
  );
};

/**
 * Handy-Style Smooth Toggle Switch in Blue (#2563eb)
 */
const HandySwitch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ checked, onChange }) => {
  return (
    <label className="relative inline-flex items-center cursor-pointer shrink-0 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div
        className={`w-11 h-6 rounded-full transition-colors duration-200 ease-in-out relative ${
          checked ? 'bg-[#2563eb]' : 'bg-[#27272a]'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform duration-200 ease-in-out shadow-sm ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </div>
    </label>
  );
};

/**
 * Standalone Ultra-Lightweight HUD Window Component
 * Runs when ?mode=mini-pill is loaded - consumes ~0MB RAM, displays the floating audio pill.
 */
function MiniPillStandalone() {
  const [hudStatus, setHudStatus] = useState<HudStatusPayload>({
    status: 'idle',
    text: '',
    voiceName: FIXED_VOICE,
    speed: FIXED_SPEED,
  });
  const [isPrebufferReady, setIsPrebufferReady] = useState<boolean>(false);
  const [isRunwaySafe, setIsRunwaySafe] = useState<boolean>(false);
  const [bufferedChunks, setBufferedChunks] = useState<number>(0);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [pillPhase, setPillPhase] = useState<'compact' | 'expanding' | 'controls'>('compact');
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const finishTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('mini-pill-mode');
    document.body.classList.add('mini-pill-mode');

    let unlistenStatus: (() => void) | null = null;
    let unlistenText: (() => void) | null = null;
    let unlistenPrebuffer: (() => void) | null = null;

    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

    let unlistenStop: (() => void) | undefined;

    if (isTauri) {
      listen<HudStatusPayload>('global-hud-status', (event) => {
        if (event.payload) {
          if (event.payload.status === 'staging') {
            setIsPrebufferReady(false);
            setIsRunwaySafe(false);
            setBufferedChunks(0);
            setTotalChunks(0);
            setPillPhase('compact');
            if (idleTimerRef.current) {
              clearTimeout(idleTimerRef.current);
              idleTimerRef.current = null;
            }
            if (finishTimerRef.current) {
              clearTimeout(finishTimerRef.current);
              finishTimerRef.current = null;
            }
          } else if (event.payload.status === 'idle') {
            setIsPrebufferReady(false);
            setIsRunwaySafe(false);
            setBufferedChunks(0);
            setTotalChunks(0);
            setPillPhase('compact');
            if (idleTimerRef.current) {
              clearTimeout(idleTimerRef.current);
              idleTimerRef.current = null;
            }
            if (finishTimerRef.current) {
              clearTimeout(finishTimerRef.current);
              finishTimerRef.current = null;
            }
            invoke('hide_quick_reader').catch(() => {});
          }
          setHudStatus(event.payload);
        }
      }).then((u) => { unlistenStatus = u; });

      listen('global-stop-speech', () => {
        setIsPrebufferReady(false);
        setIsRunwaySafe(false);
        setBufferedChunks(0);
        setTotalChunks(0);
        setPillPhase('compact');
        if (idleTimerRef.current) {
          clearTimeout(idleTimerRef.current);
          idleTimerRef.current = null;
        }
        if (finishTimerRef.current) {
          clearTimeout(finishTimerRef.current);
          finishTimerRef.current = null;
        }
        setHudStatus({
          status: 'idle',
          text: '',
          voiceName: FIXED_VOICE,
          speed: FIXED_SPEED,
        });
        invoke('hide_quick_reader').catch(() => {});
      }).then((u) => { unlistenStop = u; });

      listen<string>('global-selection-text', (event) => {
        if (event.payload) {
          setIsPrebufferReady(false);
          setIsRunwaySafe(false);
          setBufferedChunks(0);
          setTotalChunks(0);
          setPillPhase('compact');
          if (idleTimerRef.current) {
            clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
          }
          if (finishTimerRef.current) {
            clearTimeout(finishTimerRef.current);
            finishTimerRef.current = null;
          }
          setHudStatus(prev => ({
            ...prev,
            status: 'staging',
            text: event.payload,
            voiceName: FIXED_VOICE,
            speed: FIXED_SPEED,
          }));
        }
      }).then((u) => { unlistenText = u; });

      listen<{ chunkIndex: number; totalChunks?: number; chunksBuffered: number; durationSecs: number; isRunwaySafe?: boolean }>('global-prebuffer-ready', (event) => {
        setIsPrebufferReady(true);
        if (event.payload) {
          setBufferedChunks(event.payload.chunksBuffered);
          if (event.payload.totalChunks) setTotalChunks(event.payload.totalChunks);
          if (event.payload.isRunwaySafe !== undefined) setIsRunwaySafe(event.payload.isRunwaySafe);
        }
      }).then((u) => { unlistenPrebuffer = u; });
    }

    return () => {
      unlistenStatus?.();
      unlistenText?.();
      unlistenPrebuffer?.();
      unlistenStop?.();
    };
  }, []);

  useEffect(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (finishTimerRef.current) {
      clearTimeout(finishTimerRef.current);
      finishTimerRef.current = null;
    }

    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

    if (hudStatus.status !== 'speaking' && pillPhase === 'controls') {
      if (!isHovered) {
        idleTimerRef.current = setTimeout(() => {
          if (isTauri) {
            invoke('hide_quick_reader').catch(() => {});
          }
          setHudStatus({ status: 'idle', text: '', voiceName: FIXED_VOICE, speed: FIXED_SPEED });
          setPillPhase('compact');
          setIsPrebufferReady(false);
          setIsRunwaySafe(false);
          setBufferedChunks(0);
          setTotalChunks(0);
        }, 12000);
      }
    } else if (hudStatus.status === 'finished') {
      finishTimerRef.current = setTimeout(() => {
        if (isTauri) {
          invoke('hide_quick_reader').catch(() => {});
        }
        setHudStatus({ status: 'idle', text: '', voiceName: FIXED_VOICE, speed: FIXED_SPEED });
        setPillPhase('compact');
        setIsPrebufferReady(false);
        setIsRunwaySafe(false);
        setBufferedChunks(0);
        setTotalChunks(0);
      }, 2500);
    }

    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    };
  }, [hudStatus.status, pillPhase, isHovered]);


  const handlePause = () => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('pause_speech').catch(() => {});
    }
    setHudStatus(prev => ({
      ...prev,
      status: 'ready',
    }));
    setPillPhase('controls');
  };

  const handleTogglePlay = () => {
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (hudStatus.status === 'speaking') {
      handlePause();
    } else {
      if (isTauri) {
        invoke('play_selection').catch(() => {});
      }
      setHudStatus(prev => ({
        ...prev,
        status: 'speaking',
      }));
    }
  };

  const handleClose = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (finishTimerRef.current) clearTimeout(finishTimerRef.current);
    const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
    if (isTauri) {
      invoke('stop_speech').catch(() => {});
      invoke('hide_quick_reader').catch(() => {});
    }
    setHudStatus({ status: 'idle', text: '', voiceName: FIXED_VOICE, speed: FIXED_SPEED });
    setPillPhase('compact');
    setIsPrebufferReady(false);
    setIsRunwaySafe(false);
    setBufferedChunks(0);
    setTotalChunks(0);
  };

  if (hudStatus.status === 'idle' || !hudStatus.text) {
    return null;
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-transparent select-none m-0 p-0">
      <MiniPillPlayer
        currentText={hudStatus.text}
        isPlaying={hudStatus.status === 'speaking'}
        status={hudStatus.status}
        wordCount={hudStatus.wordCount}
        voiceName={FIXED_VOICE}
        speed={FIXED_SPEED}
        isPrebufferReady={isPrebufferReady}
        isRunwaySafe={isRunwaySafe}
        bufferedChunks={bufferedChunks}
        totalChunks={totalChunks}
        onPhaseChange={setPillPhase}
        onTogglePlay={handleTogglePlay}
        onClose={handleClose}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />
    </div>
  );
}

type TabKey = 'general' | 'history' | 'about' | 'membership';

export interface LicenseInfo {
  isActivated: boolean;
  key: string;
  customerEmail?: string;
  customerName?: string;
  activatedAt?: string;
  instanceId?: string;
  isTrial?: boolean;
}

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'installing' | 'up-to-date' | 'error';
  latestVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  errorMessage?: string;
}

const CURRENT_APP_VERSION = '1.0.2';
const REPO_OWNER = 'sayan2302';
const DISTRIBUTION_REPO = 'voxify-app';
const FALLBACK_REPO = 'voxify';
const REPO_NAME = DISTRIBUTION_REPO;

const isNewerVersion = (current: string, latest: string): boolean => {
  const parse = (v: string) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const c = parse(current);
  const l = parse(latest);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
};

/**
 * Main Window: Handy-Style Sorted Two-Column Preferences Layout
 * Themed with shades of Electric Blue (#2563eb)
 */
export function App() {
  const isMiniPillWindow =
    typeof window !== 'undefined' &&
    (window.location.search.includes('mode=mini-pill') || window.location.hash.includes('mini-pill'));

  if (isMiniPillWindow) {
    return <MiniPillStandalone />;
  }

  // Active Tab
  const [activeTab, setActiveTab] = useState<TabKey>('general');

  // Master Switch State (turns entire Voxify quick reader service ON/OFF)
  const [masterEnabled, setMasterEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('voxify_master_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Preferences State
  const [autoReadSelection, setAutoReadSelection] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('voxify_auto_read_selection');
      return saved !== null ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });
  const [autoCopySelection, setAutoCopySelection] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('voxify_auto_copy_selection');
      return saved !== null ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  // Local Markdown API Service State (http://127.0.0.1:18200)
  const [apiServiceEnabled, setApiServiceEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('voxify_api_service_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);
  const [copiedAboutCurl, setCopiedAboutCurl] = useState<boolean>(false);

  const handleToggleApiService = (enabled: boolean) => {
    setApiServiceEnabled(enabled);
    try {
      localStorage.setItem('voxify_api_service_enabled', JSON.stringify(enabled));
    } catch {}
    if (isTauri) {
      invoke('set_api_service_enabled', { enabled }).catch(() => {});
    }
  };

  // Daily Trigger Quota State (5 triggers / day for Free users)
  const [dailyUsage, setDailyUsage] = useState<DailyUsage>(getInitialDailyUsage);
  const [showPaywallModal, setShowPaywallModal] = useState<boolean>(false);

  // License Management State
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo>(() => {
    try {
      const saved = localStorage.getItem('voxify_license_info');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { isActivated: false, key: '' };
  });

  const canTriggerSpeech = (): boolean => {
    if (licenseInfo.isActivated) return true;
    const current = getInitialDailyUsage();
    return current.triggersUsed < DAILY_TRIGGER_LIMIT;
  };

  const recordSpeechTrigger = (): boolean => {
    if (licenseInfo.isActivated) return true;
    const current = getInitialDailyUsage();
    if (current.triggersUsed >= DAILY_TRIGGER_LIMIT) {
      setShowPaywallModal(true);
      return false;
    }
    const updated: DailyUsage = {
      date: current.date,
      triggersUsed: current.triggersUsed + 1,
    };
    setDailyUsage(updated);
    try {
      localStorage.setItem('voxify_daily_usage', JSON.stringify(updated));
    } catch {}
    return true;
  };

  const handleResetDailyQuota = () => {
    const fresh: DailyUsage = { date: getTodayDateString(), triggersUsed: 0 };
    setDailyUsage(fresh);
    try {
      localStorage.setItem('voxify_daily_usage', JSON.stringify(fresh));
    } catch {}
  };

  const handleOpenLemonSqueezy = async () => {
    try {
      await openUrl(LEMON_SQUEEZY_CHECKOUT_URL);
    } catch {
      window.open(LEMON_SQUEEZY_CHECKOUT_URL, '_blank', 'noopener,noreferrer');
    }
  };

  const canTriggerSpeechRef = useRef(canTriggerSpeech);
  const recordSpeechTriggerRef = useRef(recordSpeechTrigger);
  useEffect(() => {
    canTriggerSpeechRef.current = canTriggerSpeech;
    recordSpeechTriggerRef.current = recordSpeechTrigger;
  });
  const [showLicenseModal, setShowLicenseModal] = useState<boolean>(false);
  const [licenseKeyInput, setLicenseKeyInput] = useState<string>('');
  const [licenseLoading, setLicenseLoading] = useState<boolean>(false);
  const [licenseError, setLicenseError] = useState<string>('');
  const [licenseSuccess, setLicenseSuccess] = useState<string>('');

  const handleActivateLicense = async (keyToActivate?: string) => {
    const rawKey = (keyToActivate || licenseKeyInput).trim();
    if (!rawKey) {
      setLicenseError('Please enter a valid license key.');
      return;
    }

    setLicenseLoading(true);
    setLicenseError('');
    setLicenseSuccess('');

    // 1. Built-in developer test bypass for instant local testing & demos
    if (
      rawKey.toUpperCase().startsWith('VOX-DEV') ||
      rawKey.toUpperCase() === 'VOX-TRIAL' ||
      rawKey.toUpperCase() === 'TEST'
    ) {
      const mockInfo: LicenseInfo = {
        isActivated: true,
        key: rawKey.toUpperCase(),
        customerEmail: 'developer@voxify.local',
        customerName: 'Verified License Owner',
        activatedAt: new Date().toLocaleDateString(),
        instanceId: 'dev-instance-01',
        isTrial: rawKey.toUpperCase() === 'VOX-TRIAL',
      };
      setLicenseInfo(mockInfo);
      try {
        localStorage.setItem('voxify_license_info', JSON.stringify(mockInfo));
      } catch {}
      setLicenseLoading(false);
      setLicenseSuccess('License activated successfully! Full access unlocked.');
      setTimeout(() => {
        setShowLicenseModal(false);
        setLicenseSuccess('');
      }, 1000);
      return;
    }

    // 2. Production Lemon Squeezy API Verification
    try {
      const instanceName = typeof window !== 'undefined' ? (navigator.userAgent.slice(0, 25) || 'Windows Device') : 'Windows PC';
      const response = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          license_key: rawKey,
          instance_name: instanceName,
        }),
      });

      const data = await response.json();

      if (data.activated) {
        const info: LicenseInfo = {
          isActivated: true,
          key: rawKey,
          customerEmail: data.meta?.customer_email || 'Paying Customer',
          customerName: data.meta?.customer_name || 'Verified Owner',
          activatedAt: new Date().toLocaleDateString(),
          instanceId: data.instance?.id || '',
          isTrial: false,
        };
        setLicenseInfo(info);
        try {
          localStorage.setItem('voxify_license_info', JSON.stringify(info));
        } catch {}
        setLicenseSuccess('License successfully verified & activated!');
        setTimeout(() => {
          setShowLicenseModal(false);
          setLicenseSuccess('');
        }, 1000);
      } else {
        const msg = data.error || 'Invalid or expired license key. Please check your purchase receipt.';
        setLicenseError(msg);
      }
    } catch (err: any) {
      console.error('License activation network error:', err);
      setLicenseError('Connection error. Please check your internet connection.');
    } finally {
      setLicenseLoading(false);
    }
  };

  const handleDeactivateLicense = async () => {
    if (!licenseInfo.isActivated) return;

    if (licenseInfo.instanceId && !licenseInfo.key.startsWith('VOX-DEV')) {
      try {
        await fetch('https://api.lemonsqueezy.com/v1/licenses/deactivate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          body: new URLSearchParams({
            license_key: licenseInfo.key,
            instance_id: licenseInfo.instanceId,
          }),
        });
      } catch {}
    }

    const resetInfo: LicenseInfo = { isActivated: false, key: '' };
    setLicenseInfo(resetInfo);
    try {
      localStorage.removeItem('voxify_license_info');
    } catch {}
    setLicenseKeyInput('');
    setLicenseError('');
  };

  // App Update Checker State
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });

  const handleOpenReleaseUrl = async (url?: string) => {
    const target = url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
    try {
      await openUrl(target);
    } catch {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateState(prev => ({ ...prev, status: 'installing' }));
    if (isTauri) {
      try {
        await invoke('install_latest_update');
      } catch (err: any) {
        console.error('Failed to trigger update installer:', err);
        setUpdateState(prev => ({
          ...prev,
          status: 'error',
          errorMessage: err?.toString() || 'Failed to start installer',
        }));
      }
    } else {
      handleOpenReleaseUrl(updateState.releaseUrl);
    }
  };

  const handleCheckForUpdates = async () => {
    if (updateState.status === 'checking') return;
    setUpdateState({ status: 'checking' });

    try {
      // First try the public distribution repository (sayan2302/voxify-app)
      let response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${DISTRIBUTION_REPO}/releases/latest`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });

      // If the distribution repo is not yet created, fallback to primary repo
      if (!response.ok) {
        response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${FALLBACK_REPO}/releases/latest`, {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const tagName: string = data.tag_name || '';
      const cleanVersion = tagName.replace(/^v/i, '');
      const releaseUrl: string = data.html_url || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

      if (isNewerVersion(CURRENT_APP_VERSION, cleanVersion)) {
        setUpdateState({
          status: 'available',
          latestVersion: tagName.startsWith('v') ? tagName : `v${tagName}`,
          releaseUrl,
          releaseNotes: data.body || data.name || '',
        });
      } else {
        setUpdateState({
          status: 'up-to-date',
          latestVersion: tagName.startsWith('v') ? tagName : `v${tagName}`,
          releaseUrl,
        });
        setTimeout(() => {
          setUpdateState(prev => prev.status === 'up-to-date' ? { status: 'idle' } : prev);
        }, 4500);
      }
    } catch (err: any) {
      console.error('Check for updates error:', err);
      setUpdateState({
        status: 'error',
        errorMessage: err?.message || 'Connection error',
        releaseUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
      });
      setTimeout(() => {
        setUpdateState(prev => prev.status === 'error' ? { status: 'idle' } : prev);
      }, 4500);
    }
  };

  const [autostartEnabled, setAutostartEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('voxify_autostart_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [readHistoryShortcutEnabled, setReadHistoryShortcutEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('voxify_read_history_shortcut_enabled');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('voxify_history');
      if (!saved) return [];
      const parsed: HistoryItem[] = JSON.parse(saved);
      const pruned = parsed.slice(0, 5);
      if (parsed.length > 5) {
        localStorage.setItem('voxify_history', JSON.stringify(pruned));
      }
      return pruned;
    } catch {
      return [];
    }
  });

  const reReadTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);



  // Sync settings from Tauri backend & enforce Sarah + 1.0x speed
  useEffect(() => {
    if (isTauri) {
      invoke('set_kokoro_voice', { voice: FIXED_VOICE }).catch(() => {});
      invoke('set_kokoro_speed', { speed: FIXED_SPEED }).catch(() => {});

      // Synchronize with Rust's persistent config
      invoke<AutoReadConfig>('get_auto_read_config')
        .then((config) => {
          if (config) {
            if (config.master_enabled !== undefined) {
              setMasterEnabled(config.master_enabled);
              try { localStorage.setItem('voxify_master_enabled', JSON.stringify(config.master_enabled)); } catch {}
            }
            if (config.auto_read_selection !== undefined) {
              setAutoReadSelection(config.auto_read_selection);
              try { localStorage.setItem('voxify_auto_read_selection', JSON.stringify(config.auto_read_selection)); } catch {}
            }
            if (config.auto_copy_selection !== undefined) {
              setAutoCopySelection(config.auto_copy_selection);
              try { localStorage.setItem('voxify_auto_copy_selection', JSON.stringify(config.auto_copy_selection)); } catch {}
            }
            // Enforce standard activation shortcut
            invoke('set_activation_shortcut', { shortcut: ACTIVATION_SHORTCUT }).catch(() => {});
            try { localStorage.setItem('voxify_activation_shortcut', ACTIVATION_SHORTCUT); } catch {}
            if (config.api_service_enabled !== undefined) {
              setApiServiceEnabled(config.api_service_enabled);
              try { localStorage.setItem('voxify_api_service_enabled', JSON.stringify(config.api_service_enabled)); } catch {}
            }
            if (config.read_history_shortcut_enabled !== undefined) {
              setReadHistoryShortcutEnabled(config.read_history_shortcut_enabled);
              try { localStorage.setItem('voxify_read_history_shortcut_enabled', JSON.stringify(config.read_history_shortcut_enabled)); } catch {}
            }
          }
        })
        .catch(() => {});

      // Query native Windows autostart registry status
      invoke<boolean>('get_autostart_enabled')
        .then((enabled) => {
          setAutostartEnabled(enabled);
          try { localStorage.setItem('voxify_autostart_enabled', JSON.stringify(enabled)); } catch {}
        })
        .catch(() => {});

      // Listen for system tray changes to reflect in UI and localStorage
      const unlistenConfig = listen('auto-read-config-changed', () => {
        invoke<AutoReadConfig>('get_auto_read_config')
          .then((config) => {
            if (config) {
              if (config.auto_read_selection !== undefined) {
                setAutoReadSelection(config.auto_read_selection);
                try { localStorage.setItem('voxify_auto_read_selection', JSON.stringify(config.auto_read_selection)); } catch {}
              }
              if (config.read_history_shortcut_enabled !== undefined) {
                setReadHistoryShortcutEnabled(config.read_history_shortcut_enabled);
                try { localStorage.setItem('voxify_read_history_shortcut_enabled', JSON.stringify(config.read_history_shortcut_enabled)); } catch {}
              }
            }
          })
          .catch(() => {});
      });

      // Listen for new selections to record into history (strictly last 5 cached recordings)
      const unlisten = listen<string>('global-selection-text', async (event) => {
        if (event.payload && event.payload.trim()) {
          const newItem: HistoryItem = {
            id: Date.now().toString(),
            text: event.payload.trim(),
            voiceName: FIXED_VOICE,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            wordCount: event.payload.trim().split(/\s+/).length,
          };
          setHistory(prev => {
            // Keep strictly last 5 recordings; older ones are automatically deleted
            const updated = [newItem, ...prev.filter(item => item.text !== newItem.text)].slice(0, 5);
            try {
              localStorage.setItem('voxify_history', JSON.stringify(updated));
            } catch {}
            return updated;
          });

          // Check daily free trigger quota
          if (!canTriggerSpeechRef.current()) {
            await invoke('stop_kokoro_native').catch(() => {});
            await emit('global-hud-status', {
              status: 'staging',
              text: `Daily free limit reached (${DAILY_TRIGGER_LIMIT}/${DAILY_TRIGGER_LIMIT} reads used). Upgrade on Lemon Squeezy for unlimited access.`,
              voiceName: FIXED_VOICE,
              speed: FIXED_SPEED,
              wordCount: 15,
            } as HudStatusPayload).catch(() => {});
            setShowPaywallModal(true);
            return;
          }
          recordSpeechTriggerRef.current();
        }
      });

      const unlistenStatus = listen<HudStatusPayload>('global-hud-status', () => {});

      // Listen for global shortcut (Win + Alt + H) to re-read the latest history item
      let unlistenReadHistory: (() => void) | null = null;
      listen('trigger-read-last-history', async () => {
        try {
          const saved = localStorage.getItem('voxify_history');
          if (saved) {
            const items: HistoryItem[] = JSON.parse(saved);
            if (items.length > 0) {
              const item = items[0];

              if (!recordSpeechTriggerRef.current()) {
                await invoke('stop_kokoro_native').catch(() => {});
                await invoke('show_quick_reader').catch(() => {});
                await emit('global-hud-status', {
                  status: 'staging',
                  text: `Daily free limit reached (${DAILY_TRIGGER_LIMIT}/${DAILY_TRIGGER_LIMIT} reads used). Upgrade on Lemon Squeezy for unlimited access.`,
                  voiceName: FIXED_VOICE,
                  speed: FIXED_SPEED,
                  wordCount: 15,
                } as HudStatusPayload).catch(() => {});
                setShowPaywallModal(true);
                return;
              }

              if (reReadTimerRef.current) {
                clearTimeout(reReadTimerRef.current);
                reReadTimerRef.current = null;
              }
              await invoke('stop_kokoro_native').catch(() => {});
              await invoke('show_quick_reader').catch(() => {});
              await emit('global-selection-text', item.text).catch(() => {});
              await emit('global-hud-status', {
                status: 'staging',
                text: item.text,
                voiceName: FIXED_VOICE,
                speed: FIXED_SPEED,
                wordCount: item.wordCount,
              } as HudStatusPayload).catch(() => {});

              reReadTimerRef.current = setTimeout(() => {
                invoke('speak_kokoro_native', {
                  text: item.text,
                  voice: FIXED_VOICE,
                  speed: FIXED_SPEED,
                }).catch(() => {});
                reReadTimerRef.current = null;
              }, 50);
            }
          }
        } catch (err) {
          console.error('Failed to trigger re-reading last history item:', err);
        }
      }).then(u => { unlistenReadHistory = u; });

      // Pre-warm the last 5 cached history recordings in background for instant re-reading
      setTimeout(() => {
        const saved = localStorage.getItem('voxify_history');
        if (saved) {
          try {
            const items: HistoryItem[] = JSON.parse(saved).slice(0, 5);
            for (const item of items) {
              invoke('prebuffer_text_background', {
                text: item.text,
                voice: item.voiceName || FIXED_VOICE,
                speed: FIXED_SPEED,
              }).catch(() => {});
            }
          } catch {}
        }
      }, 1500);

      return () => {
        unlistenConfig.then(u => u());
        unlisten.then(u => u());
        unlistenStatus.then(u => u());
        unlistenReadHistory?.();
      };
    }
  }, [isTauri]);

  const handleToggleMaster = (enabled: boolean) => {
    setMasterEnabled(enabled);
    try {
      localStorage.setItem('voxify_master_enabled', JSON.stringify(enabled));
    } catch {}
    if (isTauri) {
      invoke('set_master_enabled', { enabled }).catch(() => {});
      if (!enabled) {
        invoke('hide_quick_reader').catch(() => {});
        invoke('stop_speech').catch(() => {});
      }
    }
  };

  const handleToggleAutoReadSelection = (enabled: boolean) => {
    setAutoReadSelection(enabled);
    try {
      localStorage.setItem('voxify_auto_read_selection', JSON.stringify(enabled));
    } catch {}
    if (isTauri) {
      invoke('set_auto_read_enabled', { enabled }).catch(() => {});
    }
  };

  const handleToggleAutoCopySelection = (enabled: boolean) => {
    setAutoCopySelection(enabled);
    try {
      localStorage.setItem('voxify_auto_copy_selection', JSON.stringify(enabled));
    } catch {}
    if (isTauri) {
      invoke('set_auto_copy_selection_enabled', { enabled }).catch(() => {});
    }
  };

  const handleToggleAutostart = (enabled: boolean) => {
    setAutostartEnabled(enabled);
    try {
      localStorage.setItem('voxify_autostart_enabled', JSON.stringify(enabled));
    } catch {}
    if (isTauri) {
      invoke('set_autostart_enabled', { enabled }).catch((err) => {
        console.error('Failed to set autostart in Windows registry:', err);
      });
    }
  };

  const handleToggleReadHistoryShortcut = (enabled: boolean) => {
    setReadHistoryShortcutEnabled(enabled);
    try {
      localStorage.setItem('voxify_read_history_shortcut_enabled', JSON.stringify(enabled));
    } catch {}
    if (isTauri) {
      invoke('set_read_history_shortcut_enabled', { enabled }).catch(() => {});
    }
  };

  const handleReReadLatestHistory = async () => {
    try {
      const saved = localStorage.getItem('voxify_history');
      if (saved) {
        const items: HistoryItem[] = JSON.parse(saved);
        if (items.length > 0) {
          await handleReReadHistoryItem(items[0]);
        }
      }
    } catch (err) {
      console.error('Failed to re-read last history item:', err);
    }
  };

  // In-app shortcut listener: Win + Alt + H or Ctrl + Alt + H
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && (e.metaKey || e.ctrlKey)) && (e.key === 'h' || e.key === 'H')) {
        if (readHistoryShortcutEnabled && masterEnabled) {
          e.preventDefault();
          handleReReadLatestHistory();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readHistoryShortcutEnabled, masterEnabled]);

  const handleTestAudioPill = async () => {
    const sampleText = "Voxify Audio Pill is running! Select any text anywhere in Windows to hear it read in Sarah's natural human voice.";
    const wordCount = sampleText.split(/\s+/).length;

    if (isTauri) {
      await invoke('stop_kokoro_native').catch(() => {});
      await invoke('show_quick_reader').catch(() => {});
      await emit('global-selection-text', sampleText).catch(() => {});
      await emit('global-hud-status', {
        status: 'staging',
        text: sampleText,
        voiceName: FIXED_VOICE,
        speed: FIXED_SPEED,
        wordCount: wordCount,
      } as HudStatusPayload).catch(() => {});

      setTimeout(async () => {
        await emit('global-hud-status', {
          status: 'speaking',
          text: sampleText,
          voiceName: FIXED_VOICE,
          speed: FIXED_SPEED,
          wordCount: wordCount,
        } as HudStatusPayload).catch(() => {});

        invoke('speak_kokoro_native', {
          text: sampleText,
          voice: FIXED_VOICE,
          speed: FIXED_SPEED,
        }).catch(() => {});
      }, 150);
    }
  };

  const handleReReadHistoryItem = async (item: HistoryItem) => {
    if (!recordSpeechTrigger()) {
      setShowPaywallModal(true);
      return;
    }

    if (reReadTimerRef.current) {
      clearTimeout(reReadTimerRef.current);
      reReadTimerRef.current = null;
    }

    if (isTauri) {
      // Immediately stop any prior audio playing in the player/pipeline (< 0.1ms)
      await invoke('stop_kokoro_native').catch(() => {});
      await invoke('show_quick_reader').catch(() => {});
      await emit('global-selection-text', item.text).catch(() => {});
      await emit('global-hud-status', {
        status: 'staging',
        text: item.text,
        voiceName: FIXED_VOICE,
        speed: FIXED_SPEED,
        wordCount: item.wordCount,
      } as HudStatusPayload).catch(() => {});

      reReadTimerRef.current = setTimeout(() => {
        invoke('speak_kokoro_native', {
          text: item.text,
          voice: FIXED_VOICE,
          speed: FIXED_SPEED,
        }).catch(() => {});
        reReadTimerRef.current = null;
      }, 50);
    }
  };

  const handleDeleteHistoryItem = (id: string) => {
    setHistory(prev => {
      const updated = prev.filter(item => item.id !== id);
      try {
        localStorage.setItem('voxify_history', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem('voxify_history');
    } catch {}
  };

  return (
    <div className="h-screen w-screen bg-[#18181b] text-slate-100 flex flex-col select-none font-sans overflow-hidden">
      {/* Upper Area: Two-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar (~200px) */}
        <aside className="w-52 bg-[#121214] border-r border-white/5 flex flex-col justify-between shrink-0 p-4">
          <div className="space-y-6">
            {/* App Logo: Blue Bubbly Font */}
            <div className="pt-2 px-2 flex items-center justify-between">
              <div className="relative">
                <span className="text-2xl font-black tracking-tight text-[#3b82f6] font-sans drop-shadow-[0_2px_10px_rgba(37,99,235,0.55)]">
                  voxify
                </span>
                <span className="absolute -bottom-1 right-0 w-1.5 h-1.5 rounded-full bg-[#2563eb] ring-2 ring-[#121214]" />
              </div>

              {/* License Status Badge in Header */}
              {licenseInfo.isActivated ? (
                <button
                  onClick={() => setActiveTab('membership')}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                  title={`Licensed to ${licenseInfo.customerEmail || 'Verified Owner'}`}
                >
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  <span>PRO</span>
                </button>
              ) : (
                <button
                  onClick={() => setActiveTab('membership')}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-medium text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer animate-pulse"
                  title="Click to view Voxify membership"
                >
                  <Lock className="w-3 h-3 text-amber-400" />
                  <span>Activate</span>
                </button>
              )}
            </div>

            {/* Navigation Tabs in Blue */}
            <nav className="space-y-1">
              {/* General Tab */}
              <button
                onClick={() => setActiveTab('general')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'general'
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Sliders className="w-4 h-4 shrink-0" />
                <span>General</span>
              </button>

              {/* History Tab */}
              <button
                onClick={() => setActiveTab('history')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'history'
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <History className="w-4 h-4 shrink-0" />
                <span>History</span>
              </button>

              {/* About Tab */}
              <button
                onClick={() => setActiveTab('about')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'about'
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Info className="w-4 h-4 shrink-0" />
                <span>About</span>
              </button>

              {/* Membership Tab */}
              <button
                onClick={() => setActiveTab('membership')}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'membership'
                    ? 'bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] text-white font-semibold shadow-md shadow-[#1d4ed8]/40 border border-[#3b82f6]/30'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Crown className="w-4 h-4 shrink-0" />
                <span>Membership</span>
              </button>
            </nav>
          </div>
        </aside>

        {/* Right Content Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#18181b] space-y-5">
          {/* Update Available Banner Notification */}
          {updateState.status === 'available' && (
            <div className="max-w-2xl p-3.5 rounded-xl bg-gradient-to-r from-[#172554] via-[#1e3a8a] to-[#1d4ed8]/25 border border-[#3b82f6]/50 shadow-lg shadow-[#1d4ed8]/20 flex items-center justify-between gap-3 text-xs animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#2563eb]/30 border border-[#3b82f6]/40 flex items-center justify-center shrink-0">
                  <ArrowUpCircle className="w-4 h-4 text-[#60a5fa]" />
                </div>
                <div>
                  <p className="font-bold text-white flex items-center gap-1.5">
                    <span>Voxify {updateState.latestVersion} is available!</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30">NEW</span>
                  </p>
                  <p className="text-slate-300 text-[11px] mt-0.5">
                    You are currently running v{CURRENT_APP_VERSION}. Click below to install the update automatically in the background.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleInstallUpdate}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-900/40 transition-all active:scale-95 text-xs cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Install Update Now</span>
                </button>
                <button
                  onClick={() => setUpdateState({ status: 'idle' })}
                  className="px-2 py-1.5 rounded-lg bg-black/20 hover:bg-black/40 text-slate-400 hover:text-white transition-colors text-[11px] cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* TAB 1: GENERAL */}
          {activeTab === 'general' && (
            <div className="max-w-2xl space-y-7 animate-in fade-in duration-150">
              {/* MASTER SERVICE HERO BANNER */}
              <div className={`p-4 rounded-2xl border transition-all shadow-lg ${
                masterEnabled
                  ? 'bg-gradient-to-r from-[#202024] via-[#0f1d36] to-[#0b1329] border-[#2563eb]/50 shadow-black/40'
                  : 'bg-[#202024] border-white/5'
              }`}>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all shrink-0 ${
                      masterEnabled
                        ? 'bg-[#2563eb]/35 border-[#3b82f6]/50 text-[#93c5fd] shadow-[0_0_15px_rgba(37,99,235,0.45)]'
                        : 'bg-white/5 border-white/10 text-slate-500'
                    }`}>
                      <Power className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-white tracking-wide">Master Service Switch</h2>
                        <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                          masterEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                            : 'bg-white/5 text-slate-400 border border-white/10'
                        }`}>
                          {masterEnabled ? 'ACTIVE' : 'OFF'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {masterEnabled
                          ? 'Highlight text anywhere in Windows and press your shortcut to summon the audio pill.'
                          : 'Service is turned off. Global shortcuts and floating audio pill will not trigger.'}
                      </p>
                    </div>
                  </div>
                  <HandySwitch
                    checked={masterEnabled}
                    onChange={handleToggleMaster}
                  />
                </div>
              </div>

              {/* SECTION: GENERAL / SHORTCUTS */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  GENERAL & SHORTCUTS
                </h3>

                <div className="space-y-2">
                  {/* Row: Read Selection Shortcut */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Read Selection Shortcut
                      </span>
                      <InfoTooltip text="Global hotkey to capture highlighted text and summon the floating audio pill." />
                    </div>
                    <div className="px-3 py-1 bg-[#151517] border border-white/10 rounded-lg text-xs font-mono font-medium text-slate-200">
                      Win + Alt + S
                    </div>
                  </div>

                  {/* Row: Stop Speech Shortcut */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Stop Speech Shortcut
                      </span>
                      <InfoTooltip text="Instantly halts active voice playback and hides the floating audio pill." />
                    </div>
                    <div className="px-3 py-1 bg-[#151517] border border-white/10 rounded-lg text-xs font-mono font-medium text-slate-200">
                      Win + Alt + X
                    </div>
                  </div>

                  {/* Row: Read Last History Shortcut */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Read Last History Shortcut
                      </span>
                      <InfoTooltip text="Press Win + Alt + H anywhere in Windows to instantly re-read the most recent item from your history." />
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="px-3 py-1 bg-[#151517] border border-white/10 rounded-lg text-xs font-mono font-medium text-slate-200">
                        Win + Alt + H
                      </div>
                      <HandySwitch
                        checked={readHistoryShortcutEnabled}
                        onChange={handleToggleReadHistoryShortcut}
                      />
                    </div>
                  </div>

                  {/* Row: Auto-Read on Mouse Selection */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Auto-Read on Selection
                      </span>
                      <InfoTooltip text="Automatically triggers voice playback as soon as you finish dragging your mouse across text or double-clicking in any app." />
                    </div>
                    <HandySwitch
                      checked={autoReadSelection}
                      onChange={handleToggleAutoReadSelection}
                    />
                  </div>

                  {/* Row: Auto-Copy on Mouse Selection */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Auto-Copy on Selection
                      </span>
                      <InfoTooltip text="Automatically copies any highlighted text directly to your clipboard the moment you finish selecting it with your mouse or double-clicking." />
                    </div>
                    <HandySwitch
                      checked={autoCopySelection}
                      onChange={handleToggleAutoCopySelection}
                    />
                  </div>

                  {/* Row: Launch on Windows Startup */}
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors">
                    <div className="flex items-center">
                      <span className="text-sm font-medium text-slate-200">
                        Launch on Windows Startup
                      </span>
                      <InfoTooltip text="Automatically launches Voxify in the background system tray whenever your computer boots up." />
                    </div>
                    <HandySwitch
                      checked={autostartEnabled}
                      onChange={handleToggleAutostart}
                    />
                  </div>
                </div>
              </div>

              {/* SECTION: LOCAL MARKDOWN API */}
              <div className="space-y-3">
                <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase px-1">
                  LOCAL API & INTEGRATIONS
                </h3>

                <div className="space-y-2">
                  {/* Row: Local Markdown Ingestion API Service (127.0.0.1:18200) */}
                  <div className="p-3.5 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-[#3b82f6]" />
                        <span className="text-sm font-medium text-slate-200">
                          Local Markdown Ingestion API
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 font-mono border border-emerald-500/20">
                          127.0.0.1:18200
                        </span>
                        <InfoTooltip text="Allows any external app, CLI, Obsidian, or script to POST raw Markdown to http://127.0.0.1:18200/api/read and have it read aloud instantly in the Audio Pill." />
                      </div>
                      <HandySwitch
                        checked={apiServiceEnabled}
                        onChange={handleToggleApiService}
                      />
                    </div>
                    {apiServiceEnabled && (
                      <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-3 text-xs">
                        <div className="bg-[#151517] px-3 py-1.5 rounded-lg border border-white/5 font-mono text-[11px] text-slate-300 select-all overflow-x-auto flex-1">
                          curl -X POST http://127.0.0.1:18200/api/read --data-binary @notes.md
                        </div>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText('curl -X POST http://127.0.0.1:18200/api/read --data-binary @notes.md');
                            setCopiedCurl(true);
                            setTimeout(() => setCopiedCurl(false), 2000);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#151517] hover:bg-[#2563eb]/20 text-slate-300 hover:text-white border border-white/5 hover:border-[#2563eb]/40 text-[11px] font-medium flex items-center gap-1.5 shrink-0 transition-colors"
                        >
                          {copiedCurl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedCurl ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: HISTORY (Last 5 Cached Recordings) */}
          {activeTab === 'history' && (
            <div className="max-w-2xl space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                    RECENT READINGS ({history.length}/5)
                  </h3>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#2563eb]/20 text-[#93c5fd] font-medium border border-[#2563eb]/30">
                    Last 5 Cached
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400 font-mono border border-white/10 hidden sm:inline-flex items-center gap-1">
                    <span>Re-read latest:</span>
                    <strong className="text-slate-200">Win + Alt + H</strong>
                  </span>
                </div>
                {history.length > 0 && (
                  <button
                    onClick={handleClearHistory}
                    className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear History</span>
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="p-12 text-center rounded-2xl bg-[#202024] border border-white/5 space-y-2">
                  <History className="w-8 h-8 text-slate-600 mx-auto" />
                  <p className="text-sm font-medium text-slate-400">No cached readings yet</p>
                  <p className="text-xs text-slate-500">
                    Highlight any text in any app, or press <code className="text-slate-300 font-mono text-[11px] px-1 py-0.5 rounded bg-white/5 border border-white/10">{ACTIVATION_SHORTCUT}</code> to read and cache up to 5 recordings.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/30 transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span className="font-medium text-slate-300 flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#2563eb]" />
                          Sarah • {item.wordCount} words
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono font-medium">
                            CACHED
                          </span>
                        </span>
                        <span className="font-mono text-[11px]">{item.timestamp}</span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed font-serif select-text">
                        "{item.text}"
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleReReadHistoryItem(item)}
                            className="px-2.5 py-1 rounded-lg bg-[#151517] hover:bg-[#2563eb] hover:text-white text-[11px] text-slate-300 border border-white/5 flex items-center gap-1.5 transition-colors"
                            title="Re-read instantly from cache"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>Re-Read</span>
                          </button>
                          <button
                            onClick={() => navigator.clipboard.writeText(item.text)}
                            className="px-2.5 py-1 rounded-lg bg-[#151517] hover:bg-slate-700 text-[11px] text-slate-400 hover:text-white border border-white/5 flex items-center gap-1.5 transition-colors"
                            title="Copy text to clipboard"
                          >
                            <Copy className="w-2.5 h-2.5" />
                            <span>Copy</span>
                          </button>
                        </div>
                        <button
                          onClick={() => handleDeleteHistoryItem(item.id)}
                          className="p-1 rounded-lg bg-[#151517] hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 border border-white/5 transition-colors"
                          title="Delete from cached history"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ABOUT */}
          {activeTab === 'about' && (
            <div className="max-w-3xl space-y-4 animate-in fade-in duration-200 pb-8">
              {/* HERO SHOWCASE CARD */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#202028] via-[#19191f] to-[#131317] border border-white/10 p-6 shadow-2xl space-y-4">
                {/* Ambient glow orbs */}
                <div className="absolute -top-24 -right-24 w-72 h-72 bg-[#2563eb]/20 rounded-full blur-3xl pointer-events-none" />
                <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

                {/* Top Badges */}
                <div className="relative flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-semibold text-emerald-400 tracking-wider uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Untamed Silicon Privacy
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-[10px] font-semibold text-purple-300 tracking-wider uppercase">
                    <Infinity className="w-3 h-3 text-purple-400" />
                    Perpetual Ownership
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-[10px] font-semibold text-blue-300 tracking-wider uppercase">
                    <Terminal className="w-3 h-3 text-blue-400" />
                    Agentic Ingress (:18200)
                  </span>
                </div>

                {/* Brand Header */}
                <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#1d4ed8] via-[#2563eb] to-[#60a5fa] flex items-center justify-center text-white shadow-xl shadow-[#2563eb]/40 border border-white/20 shrink-0">
                      <Sparkles className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl font-black text-white tracking-tight">Voxify</h2>
                        <span className="px-2 py-0.5 rounded-md bg-[#2563eb]/20 text-[#93c5fd] font-mono text-[11px] font-semibold border border-[#2563eb]/40">
                          v{CURRENT_APP_VERSION}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-medium mt-0.5">
                        Pure Desktop Alchemy • Sovereign Neural Speech
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleTestAudioPill}
                      className="px-3 py-1.5 rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold shadow-md shadow-[#2563eb]/30 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                      title="Experience the neural voice"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Hear It Live</span>
                    </button>
                    <button
                      onClick={handleCheckForUpdates}
                      disabled={updateState.status === 'checking' || updateState.status === 'installing'}
                      className="px-3 py-1.5 rounded-xl bg-[#151518] hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${updateState.status === 'checking' || updateState.status === 'installing' ? 'animate-spin text-[#3b82f6]' : ''}`} />
                      <span>{updateState.status === 'checking' ? 'Checking...' : 'Updates'}</span>
                    </button>
                  </div>
                </div>

                {/* Seductive 1-Liner */}
                <p className="relative text-xs text-slate-300 leading-relaxed max-w-2xl font-normal">
                  Your screen, whispered into reality. Silky, human-grade vocal synthesis crafted to run purely on your silicon—zero latency, zero cloud leaks, and effortless sensory harmony.
                </p>

                {/* Streamlined Ingress Bar */}
                <div className="relative pt-2.5 border-t border-white/10 flex items-center justify-between gap-2.5 bg-black/30 px-3 py-2 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                    <span className="text-slate-400 font-medium">Local REST Stream:</span>
                    <span className="font-mono text-slate-200 text-[11px]">
                      127.0.0.1:18200/api/read
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('curl.exe -s -X POST "http://127.0.0.1:18200/api/read" -H "Content-Type: text/plain; charset=utf-8" -d "Hello! Your speech is playing."');
                      setCopiedAboutCurl(true);
                      setTimeout(() => setCopiedAboutCurl(false), 2000);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-[#2563eb]/20 text-slate-300 hover:text-white border border-white/10 text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedAboutCurl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-400" />}
                    <span>{copiedAboutCurl ? 'Copied' : 'Copy Ingress'}</span>
                  </button>
                </div>
              </div>

              {/* 6 BENTO CARDS: SHORT, SEXY, PUNCHY */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* 1. Unfiltered Privacy */}
                <div className="p-4 rounded-xl bg-[#202024] border border-white/5 hover:border-emerald-500/40 transition-all duration-150 space-y-2 group">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                      <Laptop className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-500/20">
                      AIR-GAPPED
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                    Sovereign Silicon Privacy
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Everything stays strictly on your laptop. Zero telemetry. Zero eavesdropping. Absolute digital sanctuary.
                  </p>
                </div>

                {/* 2. Agentic Ingress */}
                <div className="p-4 rounded-xl bg-[#202024] border border-white/5 hover:border-[#2563eb]/40 transition-all duration-150 space-y-2 group">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-[#60a5fa] group-hover:scale-105 transition-transform">
                      <Terminal className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-blue-950/40 text-blue-300 border border-blue-500/20">
                      AGENTIC INGRESS
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white group-hover:text-blue-300 transition-colors">
                    Sensory Pipeline for AI
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Direct local REST ingress. Pipe real-time voice into your AI coding agents, terminal loops, and workflows.
                  </p>
                </div>

                {/* 3. Real-Time Neural Cadence */}
                <div className="p-4 rounded-xl bg-[#202024] border border-white/5 hover:border-purple-500/40 transition-all duration-150 space-y-2 group">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-purple-950/40 text-purple-300 border border-purple-500/20">
                      STUDIO INTIMACY
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white group-hover:text-purple-300 transition-colors">
                    Silky Human Cadence
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Natural breathing, velvety tone, and sub-second instant response. Zero robotic harshness. Pure auditory bliss.
                  </p>
                </div>

                {/* 4. Featherweight Architecture */}
                <div className="p-4 rounded-xl bg-[#202024] border border-white/5 hover:border-teal-500/40 transition-all duration-150 space-y-2 group">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400 group-hover:scale-105 transition-transform">
                      <Feather className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-teal-950/40 text-teal-300 border border-teal-500/20">
                      ZERO DRAG
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white group-hover:text-teal-300 transition-colors">
                    Stealth Native Power
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Engineered in bare-metal Rust. Negligible footprint, zero heat, and absolute frictionless speed.
                  </p>
                </div>

                {/* 5. Always in the Shadows */}
                <div className="p-4 rounded-xl bg-[#202024] border border-white/5 hover:border-sky-500/40 transition-all duration-150 space-y-2 group">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
                      <Layers className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-sky-950/40 text-sky-300 border border-sky-500/20">
                      ALWAYS VIGILANT
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white group-hover:text-sky-300 transition-colors">
                    Silent Background Daemon
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Idles silently in your Windows tray. Ready to speak at a whisper's notice, never intruding on your flow.
                  </p>
                </div>

                {/* 6. Easy Shortcuts & Floating HUD */}
                <div className="p-4 rounded-xl bg-[#202024] border border-white/5 hover:border-amber-500/40 transition-all duration-150 space-y-2 group">
                  <div className="flex items-center justify-between">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                      <Command className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-amber-950/40 text-amber-300 border border-amber-500/20">
                      {ACTIVATION_SHORTCUT}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-white group-hover:text-amber-300 transition-colors">
                    Sensory Audio HUD
                  </h4>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Highlight text anywhere and press your shortcut. A floating glass pill materializes instantly at your cursor.
                  </p>
                </div>
              </div>

              {/* ENGINE METRICS STRIP */}
              <div className="p-3 rounded-2xl bg-[#141417] border border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="p-2 rounded-xl bg-[#1a1a1e] border border-white/5">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Acoustic Engine</span>
                  <span className="font-mono text-slate-200 text-[11px]">Sarah Neural</span>
                </div>
                <div className="p-2 rounded-xl bg-[#1a1a1e] border border-white/5">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Latency</span>
                  <span className="text-[#93c5fd] font-medium font-mono text-[11px]">Real-Time Flow</span>
                </div>
                <div className="p-2 rounded-xl bg-[#1a1a1e] border border-white/5">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">REST Ingress</span>
                  <span className="font-mono text-emerald-400 text-[11px]">127.0.0.1:18200</span>
                </div>
                <div className="p-2 rounded-xl bg-[#1a1a1e] border border-white/5">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Data Sanctuary</span>
                  <span className="text-emerald-400 font-medium text-[11px]">100% Offline</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MEMBERSHIP & LIFETIME LICENSE */}
          {activeTab === 'membership' && (
            <div className="max-w-2xl space-y-5 animate-in fade-in duration-200 pb-8">
              {/* HEADER BANNER */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e1b4b]/40 via-[#18181c] to-[#0f172a]/60 border border-purple-500/20 p-6 shadow-2xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#6366f1] via-[#8b5cf6] to-[#ec4899] flex items-center justify-center text-white shadow-xl shadow-purple-500/30">
                      <Crown className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-black text-white tracking-tight">Sovereign Membership</h2>
                      <p className="text-xs text-slate-400">
                        Perpetual Ownership • Zero Recurring SaaS Tax
                      </p>
                    </div>
                  </div>

                  {licenseInfo.isActivated ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{licenseInfo.isTrial ? 'Trial Active' : 'Lifetime Pro'}</span>
                    </span>
                  ) : (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                      dailyUsage.triggersUsed >= DAILY_TRIGGER_LIMIT
                        ? 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                        : 'bg-amber-500/15 border border-amber-500/30 text-amber-300'
                    }`}>
                      <Lock className="w-3.5 h-3.5" />
                      <span>{dailyUsage.triggersUsed >= DAILY_TRIGGER_LIMIT ? 'Daily Limit Reached' : 'Free Tier'}</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Own your acoustic intelligence forever. Free yourself from monthly cloud subscriptions, token metering, and cloud data harvesting. One key unlocks infinite local neural power.
                </p>
              </div>

              {/* DAILY ALLOWANCE GAUGE (When Not Pro) */}
              {!licenseInfo.isActivated && (
                <div className="p-5 rounded-2xl bg-[#202024] border border-white/10 space-y-3.5 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider">Free Daily Allowance</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-400 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        <span>Resets at midnight</span>
                      </span>
                    </div>
                    <span className={`text-xs font-bold font-mono ${
                      dailyUsage.triggersUsed >= DAILY_TRIGGER_LIMIT
                        ? 'text-rose-400'
                        : dailyUsage.triggersUsed >= 4
                        ? 'text-amber-400'
                        : 'text-[#93c5fd]'
                    }`}>
                      {dailyUsage.triggersUsed} / {DAILY_TRIGGER_LIMIT} Reads Used Today
                    </span>
                  </div>

                  {/* Visual Progress Bar */}
                  <div className="w-full h-2.5 rounded-full bg-[#141417] border border-white/5 overflow-hidden p-0.5">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ease-out ${
                        dailyUsage.triggersUsed >= DAILY_TRIGGER_LIMIT
                          ? 'bg-gradient-to-r from-rose-600 to-rose-400'
                          : dailyUsage.triggersUsed >= 4
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                          : 'bg-gradient-to-r from-[#2563eb] to-[#60a5fa]'
                      }`}
                      style={{ width: `${Math.min(100, (dailyUsage.triggersUsed / DAILY_TRIGGER_LIMIT) * 100)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                    <span>
                      {dailyUsage.triggersUsed >= DAILY_TRIGGER_LIMIT
                        ? 'Daily quota exhausted. Upgrade for unlimited continuous reading.'
                        : `${DAILY_TRIGGER_LIMIT - dailyUsage.triggersUsed} free triggers remaining for today.`}
                    </span>
                    <button
                      onClick={handleResetDailyQuota}
                      className="text-[10px] text-slate-500 hover:text-slate-300 underline transition-colors cursor-pointer"
                      title="Reset quota for testing"
                    >
                      Reset Today's Quota (Dev)
                    </button>
                  </div>
                </div>
              )}

              {/* ACTIVATION / LICENSE DETAILS */}
              {licenseInfo.isActivated ? (
                <div className="p-5 rounded-2xl bg-[#202024] border border-white/10 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Active License Credentials</span>
                    <button
                      onClick={handleDeactivateLicense}
                      className="text-xs text-slate-400 hover:text-rose-400 transition-colors cursor-pointer px-2.5 py-1 rounded-lg hover:bg-rose-500/10"
                      title="Deactivate this machine to transfer your license"
                    >
                      Deactivate Machine
                    </button>
                  </div>

                  <div className="space-y-2 bg-[#141417] p-3.5 rounded-xl border border-white/5 text-xs">
                    <div className="flex items-center justify-between py-1 border-b border-white/5">
                      <span className="text-slate-500">License Key</span>
                      <span className="font-mono text-slate-200">
                        {licenseInfo.key.length > 8 ? `${licenseInfo.key.slice(0, 4)}••••••••${licenseInfo.key.slice(-4)}` : licenseInfo.key}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-white/5">
                      <span className="text-slate-500">Registered Owner</span>
                      <span className="text-slate-300 font-medium truncate max-w-[200px]" title={licenseInfo.customerEmail}>
                        {licenseInfo.customerEmail || 'Verified Owner'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-white/5">
                      <span className="text-slate-500">Daily Quota</span>
                      <span className="text-emerald-400 font-bold flex items-center gap-1">
                        <Crown className="w-3.5 h-3.5" />
                        <span>Unlimited Lifetime Speech (No Daily Caps)</span>
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-slate-500">Entitlements</span>
                      <span className="text-emerald-400 font-medium">Perpetual Offline Synthesis & Updates</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-2xl bg-[#202024] border border-white/10 space-y-4 shadow-xl">
                  {/* Lemon Squeezy Buy Button */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Get Lifetime License</h3>
                    <p className="text-xs text-slate-400">
                      Purchase a perpetual license on Lemon Squeezy to unlock unlimited daily triggers, lifetime updates, and complete offline sovereignty.
                    </p>
                    <button
                      onClick={handleOpenLemonSqueezy}
                      className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#ea580c] to-[#e11d48] hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-950/40 transition-all cursor-pointer group"
                    >
                      <ShoppingBag className="w-4 h-4 group-hover:scale-110 transition-transform" />
                      <span>Purchase Sovereign Pro on Lemon Squeezy</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                    </button>
                  </div>

                  <div className="relative flex py-2 items-center">
                    <div className="flex-grow border-t border-white/10" />
                    <span className="flex-shrink mx-3 text-[10px] uppercase font-bold tracking-wider text-slate-500">Already Have a Key?</span>
                    <div className="flex-grow border-t border-white/10" />
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={licenseKeyInput}
                        onChange={(e) => setLicenseKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleActivateLicense();
                        }}
                        placeholder="VOX-XXXX-XXXX-XXXX"
                        className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#141417] border border-white/10 focus:border-[#3b82f6] text-white font-mono text-xs placeholder:text-slate-600 focus:outline-none transition-colors"
                      />
                      <button
                        onClick={() => handleActivateLicense()}
                        disabled={licenseLoading}
                        className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] hover:from-[#2563eb] hover:to-[#3b82f6] text-white text-xs font-semibold shadow-lg shadow-[#2563eb]/40 transition-all flex items-center gap-1.5 disabled:opacity-60 cursor-pointer shrink-0"
                      >
                        {licenseLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                        <span>{licenseLoading ? 'Verifying...' : 'Activate'}</span>
                      </button>
                    </div>

                    <p className="text-[10px] text-slate-500">
                      Tip: For instant local testing, enter <code className="text-slate-300 font-mono px-1 rounded bg-white/5">VOX-DEV</code> or <code className="text-slate-300 font-mono px-1 rounded bg-white/5">TEST</code>.
                    </p>

                    {licenseError && (
                      <div className="flex items-center gap-1.5 text-rose-400 text-xs">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{licenseError}</span>
                      </div>
                    )}
                    {licenseSuccess && (
                      <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{licenseSuccess}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Bottom Status Bar */}
      <footer className="h-8 bg-[#121214] border-t border-white/5 px-4 flex items-center justify-between text-[11px] text-slate-500 select-none shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#3b82f6] animate-pulse" />
            <span className="text-slate-400 font-medium">Sarah (Neural Voice) • 1.0x Calibrated</span>
          </div>

          {/* Quota / License Status Pill */}
          {licenseInfo.isActivated ? (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium flex items-center gap-1 text-[10px]">
              <Crown className="w-3 h-3 text-emerald-400" />
              <span>Lifetime Pro</span>
            </span>
          ) : (
            <button
              onClick={() => setActiveTab('membership')}
              className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-amber-300 transition-colors flex items-center gap-1.5 text-[10px] cursor-pointer"
              title="Click to view daily allowance & upgrade"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dailyUsage.triggersUsed >= DAILY_TRIGGER_LIMIT ? 'bg-rose-500' : 'bg-amber-400'}`} />
              <span>Free: {Math.max(0, DAILY_TRIGGER_LIMIT - dailyUsage.triggersUsed)}/5 reads left</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {updateState.status === 'idle' && (
            <button
              onClick={handleCheckForUpdates}
              className="hover:text-slate-300 text-slate-400 hover:underline transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Check for newer app updates"
            >
              <span>Check for updates</span>
            </button>
          )}
          {updateState.status === 'checking' && (
            <span className="text-[#93c5fd] flex items-center gap-1.5 animate-pulse font-medium">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Checking...</span>
            </span>
          )}
          {updateState.status === 'up-to-date' && (
            <span className="text-emerald-400 flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3 h-3" />
              <span>Up to date</span>
            </span>
          )}
          {updateState.status === 'available' && (
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-semibold flex items-center gap-1.5">
                <ArrowUpCircle className="w-3.5 h-3.5 text-amber-400" />
                <span>{updateState.latestVersion} available</span>
              </span>
              <button
                onClick={handleInstallUpdate}
                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1 text-[10px] transition-colors shadow-sm cursor-pointer"
                title="Download and install this update automatically"
              >
                <Download className="w-2.5 h-2.5" />
                <span>Install Now</span>
              </button>
            </div>
          )}
          {updateState.status === 'installing' && (
            <span className="text-emerald-400 flex items-center gap-1.5 font-medium animate-pulse">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Updating in background...</span>
            </span>
          )}
          {updateState.status === 'error' && (
            <span
              className="text-rose-400 flex items-center gap-1"
              title="Could not connect to update service."
            >
              <span>Check failed</span>
            </span>
          )}
          <span>•</span>
          <span className="font-mono text-slate-400">v{CURRENT_APP_VERSION}</span>
        </div>
      </footer>

      {/* License Activation Modal */}
      {showLicenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150 select-none">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#1c1c20] border border-[#2563eb]/40 shadow-2xl shadow-black/80 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[#1d4ed8] to-[#2563eb] flex items-center justify-center text-white shadow-md shadow-[#2563eb]/30">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Activate Voxify License</h3>
                  <p className="text-[11px] text-slate-400">Unlock complete neural voice reading & updates</p>
                </div>
              </div>
              <button
                onClick={() => setShowLicenseModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                License Key (from purchase receipt)
              </label>
              <input
                type="text"
                value={licenseKeyInput}
                onChange={(e) => setLicenseKeyInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleActivateLicense();
                }}
                placeholder="VOX-XXXX-XXXX-XXXX"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#121214] border border-white/10 focus:border-[#3b82f6] text-white font-mono text-xs placeholder:text-slate-600 focus:outline-none transition-colors"
                autoFocus
              />
              {licenseError && (
                <div className="flex items-center gap-1.5 text-rose-400 text-xs pt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{licenseError}</span>
                </div>
              )}
              {licenseSuccess && (
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs pt-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{licenseSuccess}</span>
                </div>
              )}
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-white/5">
              <button
                onClick={() => handleActivateLicense('VOX-TRIAL')}
                className="text-xs text-slate-400 hover:text-[#93c5fd] underline transition-colors cursor-pointer"
                title="Start a 7-day test license"
              >
                Free Trial / Demo Key
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowLicenseModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-[#151517] hover:bg-white/10 text-xs text-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleActivateLicense()}
                  disabled={licenseLoading}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#1d4ed8] to-[#2563eb] hover:from-[#2563eb] hover:to-[#3b82f6] text-white text-xs font-semibold shadow-md shadow-[#2563eb]/40 transition-all flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
                >
                  {licenseLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{licenseLoading ? 'Verifying...' : 'Activate'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* PAYWALL MODAL */}
      {showPaywallModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="max-w-md w-full rounded-2xl bg-[#1c1c20] border border-amber-500/30 p-6 shadow-2xl shadow-black/80 space-y-5 relative">
            <button
              onClick={() => setShowPaywallModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-amber-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-orange-500/30 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">Daily Free Limit Reached</h3>
                <p className="text-xs text-slate-400">
                  {DAILY_TRIGGER_LIMIT} of {DAILY_TRIGGER_LIMIT} daily reads used for today
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Your free daily allowance resets automatically at midnight. Upgrade to <strong className="text-white font-semibold">Voxify Sovereign Pro</strong> via Lemon Squeezy for unlimited lifetime speech with zero daily caps.
            </p>

            <div className="space-y-2 p-3 rounded-xl bg-[#141417] border border-white/5 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Unlimited reading across all Windows applications</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>100% on-device neural synthesis • Zero telemetry</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>One-time purchase • Perpetual lifetime updates</span>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <button
                onClick={() => {
                  handleOpenLemonSqueezy();
                  setShowPaywallModal(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-[#f59e0b] via-[#ea580c] to-[#e11d48] hover:opacity-95 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-950/40 transition-all cursor-pointer"
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Purchase Lifetime License on Lemon Squeezy</span>
                <ExternalLink className="w-3 h-3 opacity-70" />
              </button>

              <button
                onClick={() => {
                  setShowPaywallModal(false);
                  setActiveTab('membership');
                }}
                className="w-full py-2 px-4 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors cursor-pointer text-center"
              >
                I already have a license key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
