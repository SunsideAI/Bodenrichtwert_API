import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
function createFileCache(filePath, ttlMs, label) {
    // Sicherstellen dass das Verzeichnis existiert
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    // Cache aus Datei laden
    let store = {};
    try {
        if (existsSync(filePath)) {
            store = JSON.parse(readFileSync(filePath, 'utf-8'));
        }
    }
    catch {
        store = {};
    }
    let writeTimer = null;
    function scheduleSave() {
        if (writeTimer)
            return;
        writeTimer = setTimeout(() => {
            try {
                writeFileSync(filePath, JSON.stringify(store), 'utf-8');
            }
            catch (err) {
                console.error(`${label} cache write error:`, err);
            }
            writeTimer = null;
        }, 5000);
    }
    const instance = {
        get(key) {
            const entry = store[key];
            if (!entry)
                return null;
            if (Date.now() - entry.created_at > ttlMs) {
                delete store[key];
                return null;
            }
            return entry.data;
        },
        set(key, data) {
            store[key] = { data, created_at: Date.now() };
            scheduleSave();
        },
        stats() {
            return {
                entries: Object.keys(store).length,
                cache_path: filePath,
                ttl_days: Math.round(ttlMs / (24 * 60 * 60 * 1000)),
            };
        },
        cleanup() {
            const now = Date.now();
            let removed = 0;
            for (const key of Object.keys(store)) {
                if (now - store[key].created_at > ttlMs) {
                    delete store[key];
                    removed++;
                }
            }
            if (removed > 0)
                scheduleSave();
            return removed;
        },
        clear() {
            const count = Object.keys(store).length;
            store = {};
            scheduleSave();
            return count;
        },
        /** Direktzugriff auf den internen Store (für Startup-Cleanup) */
        _store: store,
        _scheduleSave: scheduleSave,
    };
    return instance;
}
// ═══════════════════════════════════════════════
// BRW-Cache (6 Monate TTL, Key = "lat:lon")
// ═══════════════════════════════════════════════
const BRW_CACHE_PATH = process.env.CACHE_PATH || './data/cache.json';
const BRW_TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000; // ~6 Monate
export const cache = createFileCache(BRW_CACHE_PATH, BRW_TTL_MS, 'BRW');
// Startup: abgelaufene + fehlerhafte Einträge (wert=0) entfernen
cache.cleanup();
{
    let purged = 0;
    for (const key of Object.keys(cache._store)) {
        if (!cache._store[key].data.wert || cache._store[key].data.wert === 0) {
            delete cache._store[key];
            purged++;
        }
    }
    if (purged > 0) {
        console.log(`BRW-Cache: ${purged} fehlerhafte Einträge (wert=0) entfernt`);
        cache._scheduleSave();
    }
}
console.log(`BRW-Cache loaded: ${cache.stats().entries} entries`);
// ═══════════════════════════════════════════════
// ImmoScout-Cache (90 Tage TTL, Key = "bundesland:stadt")
// ═══════════════════════════════════════════════
const IMMO_CACHE_PATH = process.env.IMMO_CACHE_PATH || './data/immo-cache.json';
const IMMO_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 Tage
export const immoCache = createFileCache(IMMO_CACHE_PATH, IMMO_TTL_MS, 'ImmoScout');
immoCache.cleanup();
console.log(`ImmoScout-Cache loaded: ${immoCache.stats().entries} entries`);
//# sourceMappingURL=cache.js.map