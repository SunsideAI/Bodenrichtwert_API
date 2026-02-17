import type { NormalizedBRW } from './adapters/base.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

const CACHE_PATH = process.env.CACHE_PATH || './data/cache.json';
const TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 Monate

interface CacheEntry {
  data: NormalizedBRW;
  created_at: number;
}

type CacheStore = Record<string, CacheEntry>;

// Sicherstellen dass das data-Verzeichnis existiert
const dir = dirname(CACHE_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Cache aus Datei laden
let store: CacheStore = {};
try {
  if (existsSync(CACHE_PATH)) {
    store = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  }
} catch {
  store = {};
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced Write – sammelt und schreibt alle 5s */
function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    try {
      writeFileSync(CACHE_PATH, JSON.stringify(store), 'utf-8');
    } catch (err) {
      console.error('Cache write error:', err);
    }
    writeTimer = null;
  }, 5000);
}

/**
 * JSON-File-Cache mit 6 Monaten TTL.
 * BRW aendert sich nur 1-2x/Jahr. Kein SQLite = keine native deps.
 */
export const cache = {
  get(key: string): NormalizedBRW | null {
    const entry = store[key];
    if (!entry) return null;
    if (Date.now() - entry.created_at > TTL_MS) {
      delete store[key];
      return null;
    }
    return entry.data;
  },

  set(key: string, brw: NormalizedBRW): void {
    store[key] = { data: brw, created_at: Date.now() };
    scheduleSave();
  },

  stats() {
    return {
      entries: Object.keys(store).length,
      cache_path: CACHE_PATH,
      ttl_months: 6,
    };
  },

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const key of Object.keys(store)) {
      if (now - store[key].created_at > TTL_MS) {
        delete store[key];
        removed++;
      }
    }
    if (removed > 0) scheduleSave();
    return removed;
  },

  clear(): number {
    const count = Object.keys(store).length;
    store = {};
    scheduleSave();
    return count;
  },
};

// Startup: abgelaufene UND fehlerhafte Einträge (wert=0) entfernen
cache.cleanup();
{
  let purged = 0;
  for (const key of Object.keys(store)) {
    if (!store[key].data.wert || store[key].data.wert === 0) {
      delete store[key];
      purged++;
    }
  }
  if (purged > 0) {
    console.log(`Cache: ${purged} fehlerhafte Einträge (wert=0) entfernt`);
    scheduleSave();
  }
}
console.log(`Cache loaded: ${Object.keys(store).length} entries`);
