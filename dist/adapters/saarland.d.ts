import type { BodenrichtwertAdapter, NormalizedBRW } from './base.js';
/**
 * Saarland Adapter
 *
 * Nutzt den WMS GetFeatureInfo-Endpunkt über MapServ (primär, bestätigt)
 * und Mapbender (Fallback).
 *
 * MapServ: https://geoportal.saarland.de/gdi-sl/mapserv (BORIS map files)
 *   → Bestätigt: steuer_boris_2022.map / Layer STEUER_BORIS / EPSG:25832
 * Mapbender: https://geoportal.saarland.de/mapbender/php/wms.php (layer_id=48720)
 *   → Layer BORISSL2024 (nicht queryable via GetFeatureInfo)
 *
 * HINWEIS: Der ArcGIS WFS (Boden_WFS) enthält nur Bodenkunde-Daten,
 * KEINE Bodenrichtwerte! Deshalb rein WMS-basiert.
 *
 * CRS: EPSG:25832 (UTM Zone 32N, nativ), auch EPSG:4326 versucht
 * Lizenz: © LVGL Saarland
 */
export declare class SaarlandAdapter implements BodenrichtwertAdapter {
    state: string;
    stateCode: string;
    isFallback: boolean;
    private readonly mapbenderUrl;
    private readonly mapbenderParams;
    private readonly mapservEndpoints;
    private readonly mapservUrl;
    private knownLayers;
    private discoveredMapbenderLayers;
    private discoveredMapservLayers;
    getBodenrichtwert(lat: number, lon: number): Promise<NormalizedBRW | null>;
    private queryMapbender;
    private queryMapserv;
    private queryWmsWithStrategies;
    private queryWms;
    private discoverLayers;
    private wgs84ToUtm32;
    private parseTextPlain;
    private parseXml;
    private parseHtml;
    private extractNumber;
    private extractField;
    /** '01.01.2024' → '2024-01-01' */
    private convertDate;
    healthCheck(): Promise<boolean>;
}
