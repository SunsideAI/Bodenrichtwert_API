import type { NormalizedBRW } from './adapters/base.js';
/**
 * JSON-File-Cache mit 6 Monaten TTL.
 * BRW aendert sich nur 1-2x/Jahr. Kein SQLite = keine native deps.
 */
export declare const cache: {
    get(key: string): NormalizedBRW | null;
    set(key: string, brw: NormalizedBRW): void;
    stats(): {
        entries: number;
        cache_path: string;
        ttl_months: number;
    };
    cleanup(): number;
    clear(): number;
};
