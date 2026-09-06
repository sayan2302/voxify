/**
 * Persistent IndexedDB storage for synthesized TTS audio.
 * Allows instant (0-5ms) retrieval of pre-synthesized sentences across reloads and chapter navigation.
 */

const DB_NAME = 'vocalis_tts_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'synthesized_audio';

interface CachedAudioRecord {
  key: string;
  rawPcm: Float32Array;
  sampleRate: number;
  duration: number;
  createdAt: number;
}

class AudioCacheDb {
  private static instance: AudioCacheDb | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryCache = new Map<string, { rawPcm: Float32Array; sampleRate: number; duration: number }>();

  private constructor() {}

  public static getInstance(): AudioCacheDb {
    if (!AudioCacheDb.instance) {
      AudioCacheDb.instance = new AudioCacheDb();
    }
    return AudioCacheDb.instance;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn('[AudioCacheDb] Failed to open IndexedDB:', request.error);
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  public async get(key: string): Promise<{ rawPcm: Float32Array; sampleRate: number; duration: number } | null> {
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }

    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);

        req.onsuccess = () => {
          const rec = req.result as CachedAudioRecord | undefined;
          if (rec && rec.rawPcm) {
            const data = {
              rawPcm: rec.rawPcm,
              sampleRate: rec.sampleRate || 24000,
              duration: rec.duration || (rec.rawPcm.length / (rec.sampleRate || 24000)),
            };
            this.memoryCache.set(key, data);
            resolve(data);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => {
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  }

  public async set(key: string, rawPcm: Float32Array, sampleRate: number, duration: number): Promise<void> {
    const data = { rawPcm, sampleRate, duration };
    this.memoryCache.set(key, data);

    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record: CachedAudioRecord = {
          key,
          rawPcm,
          sampleRate,
          duration,
          createdAt: Date.now(),
        };
        store.put(record);

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve(); // Non-blocking
      });
    } catch (err) {
      console.warn('[AudioCacheDb] Write error (memory cache used):', err);
    }
  }

  public async has(key: string): Promise<boolean> {
    if (this.memoryCache.has(key)) return true;
    const res = await this.get(key);
    return res !== null;
  }

  public async getAllCachedKeys(): Promise<Set<string>> {
    const set = new Set<string>(this.memoryCache.keys());
    try {
      const db = await this.getDb();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAllKeys();

        req.onsuccess = () => {
          const keys = req.result as string[];
          if (keys && Array.isArray(keys)) {
            for (const k of keys) set.add(k);
          }
          resolve(set);
        };

        req.onerror = () => {
          resolve(set);
        };
      });
    } catch {
      return set;
    }
  }

  public async clear(): Promise<void> {
    this.memoryCache.clear();
    try {
      const db = await this.getDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    } catch (err) {
      console.warn('[AudioCacheDb] Clear error:', err);
    }
  }
}

export const AudioCache = AudioCacheDb.getInstance();
