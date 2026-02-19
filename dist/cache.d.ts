import type { NormalizedBRW } from './adapters/base.js';
import type { ImmoScoutPrices } from './utils/immoscout-scraper.js';
interface CacheEntry<T> {
    data: T;
    created_at: number;
}
export declare const cache: {
    get(key: string): NormalizedBRW | null;
    set(key: string, data: NormalizedBRW): void;
    stats(): {
        entries: number;
        cache_path: string;
        ttl_days: number;
    };
    cleanup(): number;
    clear(): number;
    /** Direktzugriff auf den internen Store (für Startup-Cleanup) */
    _store: Record<string, CacheEntry<NormalizedBRW>>;
    _scheduleSave: () => void;
};
export declare const immoCache: {
    get(key: string): ImmoScoutPrices | null;
    set(key: string, data: ImmoScoutPrices): void;
    stats(): {
        entries: number;
        cache_path: string;
        ttl_days: number;
    };
    cleanup(): number;
    clear(): number;
    /** Direktzugriff auf den internen Store (für Startup-Cleanup) */
    _store: Record<string, CacheEntry<ImmoScoutPrices>>;
    _scheduleSave: () => void;
};
export {};
