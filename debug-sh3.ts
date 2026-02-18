/**
 * Debug script: SH ArcGIS REST API + queryable layer analysis
 * Backend is ArcGIS MapServer - try native REST identify/query
 */

const lat = 54.3233;
const lon = 10.1228;
const wmsUrl = 'https://service.gdi-sh.de/WMS_SH_FD_VBORIS';

async function tryFetch(label: string, url: string, timeout = 10000) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    console.log(`\n${label}`);
    console.log(`  Status: ${res.status}, Content-Type: ${res.headers.get('content-type')}, Length: ${text.length}`);
    console.log(`  Response: ${text.substring(0, 800).replace(/\n/g, '\\n')}`);
    return text;
  } catch (err) {
    console.log(`\n${label}`);
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function main() {
  console.log('=== 1. Parse GetCapabilities for queryable layers ===');

  const capParams = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetCapabilities',
  });
  try {
    const res = await fetch(`${wmsUrl}?${capParams}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    const xml = await res.text();

    // Find ALL Layer elements with queryable attribute
    const layerPattern = /<Layer\s([^>]*)>[\s\S]*?<Name>([^<]*)<\/Name>/gi;
    let match;
    console.log('\nAll layers with attributes:');
    while ((match = layerPattern.exec(xml)) !== null) {
      const attrs = match[1];
      const name = match[2];
      const queryable = attrs.match(/queryable="(\d)"/)?.[1] || 'not set';
      if (name.includes('Bodenrichtwert') || name.includes('Richtwert') || name.includes('Verfahren') || queryable === '1') {
        console.log(`  queryable="${queryable}" → ${name}`);
      }
    }

    // Also look for the OnlineResource/URL pattern to find REST endpoints
    const urlMatches = xml.match(/https?:\/\/[^"<\s]+arcgis[^"<\s]*/gi);
    if (urlMatches) {
      console.log('\nArcGIS URLs found in capabilities:');
      for (const u of [...new Set(urlMatches)].slice(0, 5)) {
        console.log(`  ${u}`);
      }
    }
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\n\n=== 2. Try ArcGIS REST API ===');

  // The WMS backend is at watkipw023.dpaorinp.de:6443/arcgis/services/FACHDATEN/VBORIS/MapServer
  // Try REST equivalents through the public proxy
  const restBases = [
    'https://service.gdi-sh.de/arcgis/rest/services/FACHDATEN/VBORIS/MapServer',
    'https://service.gdi-sh.de/ArcGIS/rest/services/FACHDATEN/VBORIS/MapServer',
    'https://service.gdi-sh.de/WMS_SH_FD_VBORIS/MapServer',
    'https://dienste.gdi-sh.de/arcgis/rest/services/FACHDATEN/VBORIS/MapServer',
  ];

  for (const base of restBases) {
    await tryFetch(`ArcGIS REST: ${base}`, `${base}?f=json`);
  }

  console.log('\n\n=== 3. Try DANord viewer with different app names ===');

  const appNames = ['Bodenrichtwerte', 'BORIS', 'VBORIS', 'bodenrichtwerte', 'boris', 'Grundstueckswerte'];
  for (const app of appNames) {
    await tryFetch(`DANord: ${app}`,
      `https://danord.gdi-sh.de/viewer/resources/apps/${app}/index.html`);
  }

  // Try DANord REST API directly
  await tryFetch('DANord REST apps list',
    'https://danord.gdi-sh.de/viewer/resources/apps?f=json');
  await tryFetch('DANord REST root',
    'https://danord.gdi-sh.de/viewer/rest/');

  console.log('\n\n=== 4. Try SH Geoportal / Gutachterausschuss endpoints ===');

  // Gutachterausschuss SH might have a direct portal
  await tryFetch('GAA-SH BORIS portal',
    'https://borissh.de');
  await tryFetch('GAA-SH BORIS portal 2',
    'https://www.borissh.de');
  await tryFetch('GAA-SH BORIS portal 3',
    'https://boris.schleswig-holstein.de');
  await tryFetch('OAGSH BRW portal',
    'https://www.oagsh.de');

  console.log('\n\n=== 5. Try SH WMS with GetMap (verify coords are in data extent) ===');

  // Try GetMap with a simple, known-working request
  // Use CRS:84 which is lon,lat (no axis swap)
  const gmParams = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
    LAYERS: 'Bodenrichtwertzonen_2024',
    CRS: 'CRS:84',
    BBOX: `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`,
    WIDTH: '256', HEIGHT: '256',
    FORMAT: 'image/png', STYLES: '',
  });
  try {
    const res = await fetch(`${wmsUrl}?${gmParams}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`\nGetMap CRS:84: Status ${res.status}, Content-Type: ${res.headers.get('content-type')}, Size: ${res.headers.get('content-length')}`);
    if (!res.headers.get('content-type')?.includes('image')) {
      const text = await res.text();
      console.log(`  Response: ${text.substring(0, 500)}`);
    } else {
      // Got an image - the service works for GetMap!
      const buf = await res.arrayBuffer();
      console.log(`  Got image! ${buf.byteLength} bytes`);
    }
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }

  // Also try GetMap with EPSG:25832
  const utmE = 573026;
  const utmN = 6020074;
  const gmParams2 = new URLSearchParams({
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
    LAYERS: 'Bodenrichtwertzonen_2024',
    CRS: 'EPSG:25832',
    BBOX: `${utmE - 200},${utmN - 200},${utmE + 200},${utmN + 200}`,
    WIDTH: '256', HEIGHT: '256',
    FORMAT: 'image/png', STYLES: '',
  });
  try {
    const res = await fetch(`${wmsUrl}?${gmParams2}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`\nGetMap EPSG:25832: Status ${res.status}, Content-Type: ${res.headers.get('content-type')}, Size: ${res.headers.get('content-length')}`);
    if (!res.headers.get('content-type')?.includes('image')) {
      const text = await res.text();
      console.log(`  Response: ${text.substring(0, 500)}`);
    } else {
      const buf = await res.arrayBuffer();
      console.log(`  Got image! ${buf.byteLength} bytes`);
    }
  } catch (err) {
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\n\n=== 6. Try Esri-specific GetFeatureInfo with all layer IDs ===');
  // ArcGIS WMS maps layer IDs to numeric IDs (0, 1, 2, ...)
  // Maybe the named layers aren't queryable but numeric IDs are
  for (const layerId of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21']) {
    const params = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
      LAYERS: layerId, QUERY_LAYERS: layerId,
      CRS: 'CRS:84',
      BBOX: `${lon - 0.001},${lat - 0.001},${lon + 0.001},${lat + 0.001}`,
      WIDTH: '101', HEIGHT: '101', I: '50', J: '50',
      INFO_FORMAT: 'text/html', FEATURE_COUNT: '5', STYLES: '', FORMAT: 'image/png',
    });
    try {
      const res = await fetch(`${wmsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(8000),
      });
      const text = await res.text();
      const hasData = text.length > 30 && !text.includes('<html><body></body></html>') && !text.includes('ServiceException');
      if (hasData) {
        console.log(`\n  Layer ${layerId}: ${res.status}, ${text.length} chars *** HAS DATA ***`);
        console.log(`    ${text.substring(0, 500).replace(/\n/g, '\\n')}`);
      } else {
        process.stdout.write(`.`);
      }
    } catch {
      process.stdout.write(`x`);
    }
  }
  console.log('\n');
}

main().catch(console.error);
