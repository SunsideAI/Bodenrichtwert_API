/**
 * Debug script: Find alternative SH endpoints
 * The WMS layers are NOT queryable - need WFS, DANord API, or BORIS-D
 */

const lat = 54.3233;
const lon = 10.1228;

async function tryFetch(label: string, url: string) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    console.log(`\n${label}`);
    console.log(`  Status: ${res.status}, Length: ${text.length}`);
    console.log(`  Response: ${text.substring(0, 600).replace(/\n/g, '\\n')}`);
    return text;
  } catch (err) {
    console.log(`\n${label}`);
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function main() {
  console.log('=== 1. Try WFS endpoints for SH ===');

  // Try WFS equivalents of the WMS URL
  await tryFetch('WFS_SH_FD_VBORIS GetCap',
    'https://service.gdi-sh.de/WFS_SH_FD_VBORIS?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities');
  await tryFetch('WFS_SH_BORIS GetCap',
    'https://service.gdi-sh.de/WFS_SH_BORIS?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities');
  await tryFetch('dienste WFS_SH_FD_VBORIS GetCap',
    'https://dienste.gdi-sh.de/WFS_SH_FD_VBORIS?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities');

  // GeoServer WFS (sh-mis)
  await tryFetch('sh-mis GeoServer WFS GetCap',
    'https://sh-mis.schleswig-holstein.de/geoserver/vboris/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities');

  console.log('\n\n=== 2. Try DANord BORIS viewer API ===');

  // DANord viewer typically uses ArcGIS/MapServer or similar backend
  // Common SH geo-portal URLs
  await tryFetch('DANord BORIS viewer',
    'https://danord.gdi-sh.de/viewer/resources/apps/BRW/index.html');
  await tryFetch('DANord BORIS REST services',
    'https://danord.gdi-sh.de/arcgis/rest/services');

  // Try SH ALKIS/BORIS MapServer
  await tryFetch('SH Boris MapServer',
    'https://service.gdi-sh.de/SH_BORIS?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities');

  console.log('\n\n=== 3. Try BORIS-D (central German BORIS) for SH ===');

  // BORIS-D sometimes provides data for individual states
  // WFS endpoint
  await tryFetch('BORIS-D WFS GetCap',
    'https://sg.geodatenzentrum.de/wfs_borisd?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities');
  // Try BORIS-D WFS query for SH coordinates
  await tryFetch('BORIS-D WFS bbox query',
    `https://sg.geodatenzentrum.de/wfs_borisd?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&typeNames=Bodenrichtwert&bbox=${lat - 0.001},${lon - 0.001},${lat + 0.001},${lon + 0.001},urn:ogc:def:crs:EPSG::4326&count=5`);

  // BORIS-D WMS
  await tryFetch('BORIS-D WMS GetCap',
    'https://sg.geodatenzentrum.de/wms_borisd?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities');

  console.log('\n\n=== 4. Try other SH-specific endpoints ===');

  // Sometimes there are separate services for download (FD = Fachdienst)
  await tryFetch('SH FD VBORIS GetCap (full)',
    'https://service.gdi-sh.de/WMS_SH_FD_VBORIS?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities');

  // Try with WMS GetFeatureInfo and different layer naming
  // Maybe the layers need to be queried as sub-layers of a group
  const wmsBase = 'https://service.gdi-sh.de/WMS_SH_FD_VBORIS';

  // Try older Stichtag layers
  for (const layer of ['Bodenrichtwertzonen_2022', 'Bodenrichtwertzonen_2020', 'Richtwertpositionen_2022']) {
    const utmE = 573026;
    const utmN = 6020074;
    const d = 100;
    const params = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetFeatureInfo',
      LAYERS: layer, QUERY_LAYERS: layer,
      CRS: 'EPSG:25832',
      BBOX: `${utmE-d},${utmN-d},${utmE+d},${utmN+d}`,
      WIDTH: '101', HEIGHT: '101', I: '50', J: '50',
      INFO_FORMAT: 'text/html', FEATURE_COUNT: '5', STYLES: '', FORMAT: 'image/png',
    });
    await tryFetch(`Older layer: ${layer}`, `${wmsBase}?${params}`);
  }

  console.log('\n\n=== 5. Try SH open data / download services ===');

  // SH open data portal
  await tryFetch('SH Open Data BORIS',
    'https://opendata.schleswig-holstein.de/dataset/bodenrichtwerte');

  // Check if there's an OGC API Features endpoint
  await tryFetch('SH OGC API Features',
    'https://service.gdi-sh.de/OAF_SH_FD_VBORIS?f=json');
  await tryFetch('dienste OGC API Features',
    'https://dienste.gdi-sh.de/OAF_SH_FD_VBORIS?f=json');
}

main().catch(console.error);
