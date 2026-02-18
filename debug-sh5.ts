/**
 * Debug script: SH WSS ags-relay + Referer-based _DANORD access
 *
 * Findings so far:
 * - WMS_SH_FD_VBORIS: GetCapabilities works, GetMap/GetFeatureInfo fail
 * - WMS_SH_FD_VBORIS_DANORD: 403 (requires auth)
 * - App config reveals WSS ags-relay pattern for ArcGIS REST
 * - Backend at watkipw023 (VBORIS MapServer)
 */

const lat = 54.3233;
const lon = 10.1228;
const utmE = 573026;
const utmN = 6020074;

async function tryFetch(label: string, url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    console.log(`\n${label}`);
    console.log(`  Status: ${res.status}, CT: ${res.headers.get('content-type')}, Len: ${text.length}`);
    if (text.length < 1500) {
      console.log(`  ${text.replace(/\n/g, '\\n').substring(0, 1200)}`);
    } else {
      console.log(`  ${text.replace(/\n/g, '\\n').substring(0, 1200)}...`);
    }
    return text;
  } catch (err) {
    console.log(`\n${label}`);
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function main() {
  console.log('=== 1. WSS ags-relay for VBORIS ArcGIS REST ===\n');

  // The app config had: service.gdi-sh.de/wss/service/ags-relay/watkipw021/guest/arcgis/rest/services/...
  // VBORIS is at watkipw023. Try various host/user combos:
  const relayBases = [
    'https://service.gdi-sh.de/wss/service/ags-relay/watkipw023/guest/arcgis/rest/services/FACHDATEN/VBORIS/MapServer',
    'https://service.gdi-sh.de/wss/service/ags-relay/watkipw023/guest/arcgis/services/FACHDATEN/VBORIS/MapServer',
    'https://service.gdi-sh.de/wss/service/ags-relay/watkipw023/arcgis/rest/services/FACHDATEN/VBORIS/MapServer',
    // Maybe the relay uses a different hostname
    'https://service.gdi-sh.de/wss/service/ags-relay/watkipw023.dpaorinp.de/guest/arcgis/rest/services/FACHDATEN/VBORIS/MapServer',
  ];

  for (const base of relayBases) {
    await tryFetch(`REST: ${base}`, `${base}?f=json`);
  }

  console.log('\n\n=== 2. _DANORD WMS with Referer header ===\n');

  const danordWms = 'https://service.gdi-sh.de/WMS_SH_FD_VBORIS_DANORD';
  const referers = [
    'https://danord.gdi-sh.de/viewer/resources/apps/VBORIS/index.html',
    'https://danord.gdi-sh.de/',
    'https://danord.gdi-sh.de',
  ];

  for (const ref of referers) {
    // Try GetCapabilities first
    await tryFetch(`DANORD GetCap (Referer: ${ref})`,
      `${danordWms}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`,
      { 'Referer': ref, 'Origin': 'https://danord.gdi-sh.de' });
  }

  // If GetCapabilities works with referer, try GetFeatureInfo
  const delta = 100;
  const gfiUrl = `${danordWms}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=Bodenrichtwertzonen_2024&QUERY_LAYERS=Bodenrichtwertzonen_2024&CRS=EPSG:25832&BBOX=${utmE-delta},${utmN-delta},${utmE+delta},${utmN+delta}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/html&FEATURE_COUNT=5&STYLES=&FORMAT=image/png`;

  await tryFetch('DANORD GetFeatureInfo (with Referer)',
    gfiUrl,
    { 'Referer': 'https://danord.gdi-sh.de/viewer/resources/apps/VBORIS/index.html', 'Origin': 'https://danord.gdi-sh.de' });

  console.log('\n\n=== 3. Try WSS relay for WMS (not REST) ===\n');

  // Maybe the WSS relays to the WMS endpoint too
  const wssWmsBases = [
    'https://service.gdi-sh.de/wss/service/ags-relay/watkipw023/guest/arcgis/services/FACHDATEN/VBORIS/MapServer/WmsServer',
    'https://service.gdi-sh.de/wss/service/ags-relay/watkipw023/guest/arcgis/services/FACHDATEN/VBORIS/MapServer/WMSServer',
  ];

  for (const base of wssWmsBases) {
    await tryFetch(`WSS WMS GetCap: ${base}`,
      `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`);
  }

  console.log('\n\n=== 4. Try identify via WSS relay ===\n');

  // If the REST API is accessible, try identify
  const identifyBases = [
    'https://service.gdi-sh.de/wss/service/ags-relay/watkipw023/guest/arcgis/rest/services/FACHDATEN/VBORIS/MapServer/identify',
  ];

  for (const base of identifyBases) {
    const identifyParams = new URLSearchParams({
      geometry: `${utmE},${utmN}`,
      geometryType: 'esriGeometryPoint',
      sr: '25832',
      layers: 'all',
      tolerance: '10',
      mapExtent: `${utmE-200},${utmN-200},${utmE+200},${utmN+200}`,
      imageDisplay: '400,400,96',
      returnGeometry: 'false',
      f: 'json',
    });
    await tryFetch(`Identify: ${base}`, `${base}?${identifyParams}`);
  }

  console.log('\n\n=== 5. Try the "bodenrichtwertefuergrundsteuerzweckesh" app ===\n');

  // From the app config, there's a reference to another app
  await tryFetch('Grundsteuer app',
    'https://danord.gdi-sh.de/viewer/resources/apps/bodenrichtwertefuergrundsteuerzweckesh/app.json');

  console.log('\n\n=== 6. Try XSLT approach (the DEV.xsl from config) ===\n');

  // The config had a VBORIS_DEV.xsl - maybe it's used to transform WMS responses
  await tryFetch('VBORIS_DEV.xsl',
    'https://danord.gdi-sh.de/viewer/payload/apps/VBORIS/VBORIS_DEV.xsl');

  console.log('\n\n=== 7. Quick check: does the base WMS work from a browser-like request? ===\n');

  // Maybe the issue is just our User-Agent or missing headers
  const wmsBase = 'https://service.gdi-sh.de/WMS_SH_FD_VBORIS';
  const d = 100;

  // Try with browser-like headers
  await tryFetch('Base WMS GetMap (browser headers)',
    `${wmsBase}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Bodenrichtwertzonen_2024&CRS=EPSG:25832&BBOX=${utmE-d},${utmN-d},${utmE+d},${utmN+d}&WIDTH=256&HEIGHT=256&FORMAT=image/png&STYLES=`,
    {
      'Accept': 'image/png,image/*,*/*',
      'Referer': 'https://danord.gdi-sh.de/',
    });

  // Try GetFeatureInfo with browser headers
  await tryFetch('Base WMS GetFeatureInfo (browser headers)',
    `${wmsBase}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=Bodenrichtwertzonen_2024&QUERY_LAYERS=Bodenrichtwertzonen_2024&CRS=EPSG:25832&BBOX=${utmE-d},${utmN-d},${utmE+d},${utmN+d}&WIDTH=101&HEIGHT=101&I=50&J=50&INFO_FORMAT=text/html&FEATURE_COUNT=5&STYLES=&FORMAT=image/png`,
    {
      'Accept': 'text/html,*/*',
      'Referer': 'https://danord.gdi-sh.de/',
    });
}

main().catch(console.error);
