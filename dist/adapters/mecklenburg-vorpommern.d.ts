import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Mecklenburg-Vorpommern Adapter
 *
 * Versucht zuerst den öffentlichen WFS-Endpunkt, fällt bei 401 auf
 * alternative WMS/WFS-Endpunkte zurück.
 * Daten: Bodenrichtwerte nach BORIS.MV2.1 Datenmodell
 * CRS: EPSG:25833 (UTM Zone 33N)
 * Lizenz: GutALVO M-V (frei zugänglich)
 */
export declare class MecklenburgVorpommernAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private readonly wfsUrls;
    private readonly wmsUrls;
    private discoveredWmsLayers;
    private readonly wmsLayerCandidates;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private discoverWmsLayers;
    private tryWfsQuery;
    private tryWmsQuery;
    /**
     * Parse the best feature from a (possibly multi-layer) text/plain or GML response.
     * MV uses VBORIS short-form fields: brwkon, stag, entw, nuta, gabe, ortst, class.
     * For group layer, prefer building land over forest/agriculture.
     */
    private parseBestFeature;
    private extractValue;
    private extractField;
    healthCheck(): Promise<boolean>;
}
