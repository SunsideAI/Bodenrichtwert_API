/**
 * Debug script: Test SH WMS GetFeatureInfo with EPSG:25832
 */

const lat = 54.3233;
const lon = 10.1228;
const wmsUrl = 'https://service.gdi-sh.de/WMS_SH_FD_VBORIS';

// WGS84 to UTM Zone 32N conversion
function wgs84ToUtm32(lat: number, lon: number): { easting: number; northing: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const lon0 = 9;
  const e2 = 2 * f - f * f;
  const latRad = lat * Math.PI / 180;
  const lon0Rad = lon0 * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const C = (e2 / (1 - e2)) * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lon0Rad);
  const M = a * (
    (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * latRad
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * latRad)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * latRad)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * latRad)
  );
  const easting = 500000 + k0 * N * (
    A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5 / 120
  );
  const northing = k0 * (
    M + N * Math.tan(latRad) * (
      A ** 2 / 2
      + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
      + (61 - 58 * T + T ** 2 + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6 / 720
    )
  );
  return { easting, northing };
}

const { easting, northing } = wgs84ToUtm32(lat, lon);
console.log(`UTM coordinates: E=${easting.toFixed(2)}, N=${northing.toFixed(2)}`);

const layers = ['Bodenrichtwertzonen_2024', 'Richtwertpositionen_2024', 'VBORIS'];
const utmDelta = 100;
const delta = 0.001;

async function testStrategy(layer: string, version: string, srsParam: string, srs: string, bbox: string, xyParams: [string, string], infoFormat: string) {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: version,
    REQUEST: 'GetFeatureInfo',
    LAYERS: layer,
    QUERY_LAYERS: layer,
    [srsParam]: srs,
    BBOX: bbox,
    WIDTH: '101',
    HEIGHT: '101',
    [xyParams[0]]: '50',
    [xyParams[1]]: '50',
    INFO_FORMAT: infoFormat,
    FEATURE_COUNT: '5',
    STYLES: '',
    FORMAT: 'image/png',
  });

  const url = `${wmsUrl}?${params}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    const label = `${layer} [${version}/${srs}/${infoFormat}]`;
    console.log(`\n${label}`);
    console.log(`  Status: ${res.status}, Length: ${text.length}`);
    console.log(`  Response: ${text.substring(0, 500).replace(/\n/g, '\\n')}`);
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  console.log('\n=== SH WMS Debug ===\n');

  for (const layer of layers) {
    // Strategy 1: WMS 1.3.0 + EPSG:25832 (UTM bbox)
    const utmBbox = `${easting - utmDelta},${northing - utmDelta},${easting + utmDelta},${northing + utmDelta}`;
    await testStrategy(layer, '1.3.0', 'CRS', 'EPSG:25832', utmBbox, ['I', 'J'], 'text/html');
    await testStrategy(layer, '1.3.0', 'CRS', 'EPSG:25832', utmBbox, ['I', 'J'], 'text/plain');
    await testStrategy(layer, '1.3.0', 'CRS', 'EPSG:25832', utmBbox, ['I', 'J'], 'application/vnd.ogc.gml');

    // Strategy 2: WMS 1.3.0 + EPSG:4326 (lat,lon bbox)
    const wgs84Bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta}`;
    await testStrategy(layer, '1.3.0', 'CRS', 'EPSG:4326', wgs84Bbox, ['I', 'J'], 'text/html');

    // Strategy 3: WMS 1.1.1 + EPSG:25832 (UTM bbox)
    await testStrategy(layer, '1.1.1', 'SRS', 'EPSG:25832', utmBbox, ['X', 'Y'], 'text/html');
    await testStrategy(layer, '1.1.1', 'SRS', 'EPSG:25832', utmBbox, ['X', 'Y'], 'text/plain');
  }

  // Also try GetMap to confirm the layer renders at these coords
  console.log('\n=== GetMap test (to confirm layer renders at these coords) ===');
  const utmBbox = `${easting - utmDelta},${northing - utmDelta},${easting + utmDelta},${northing + utmDelta}`;
  const gmParams = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: 'Bodenrichtwertzonen_2024',
    CRS: 'EPSG:25832',
    BBOX: utmBbox,
    WIDTH: '256',
    HEIGHT: '256',
    FORMAT: 'image/png',
    STYLES: '',
  });
  try {
    const res = await fetch(`${wmsUrl}?${gmParams}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`  GetMap status: ${res.status}, content-type: ${res.headers.get('content-type')}, size: ${res.headers.get('content-length')}`);
    if (!res.headers.get('content-type')?.includes('image')) {
      const text = await res.text();
      console.log(`  Response: ${text.substring(0, 300)}`);
    }
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }

  // Check if the layer is queryable via GetCapabilities
  console.log('\n=== Check queryable attribute ===');
  const capParams = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetCapabilities',
  });
  try {
    const res = await fetch(`${wmsUrl}?${capParams}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    const xml = await res.text();
    // Find queryable attribute for BRW layers
    const layerBlocks = xml.match(/<Layer[^>]*>[\s\S]*?<Name>Bodenrichtwertzonen_2024<\/Name>[\s\S]*?<\/Layer>/i);
    if (layerBlocks) {
      console.log(`  Layer block: ${layerBlocks[0].substring(0, 500)}`);
    } else {
      // Try broader search
      const queryableMatches = [...xml.matchAll(/<Layer\s+queryable="(\d)"[^>]*>[\s\S]*?<Name>([^<]+)<\/Name>/gi)];
      console.log(`  Queryable layers found: ${queryableMatches.length}`);
      for (const m of queryableMatches.slice(0, 10)) {
        console.log(`    queryable="${m[1]}" → ${m[2]}`);
      }
    }
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }
}

main().catch(console.error);
