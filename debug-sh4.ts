/**
 * Debug script: Extract VBORIS DANord app config to find working service URLs
 * The WMS at service.gdi-sh.de is broken (GetMap fails too).
 * The DANord VBORIS viewer works — it must use different URLs.
 */

const lat = 54.3233;
const lon = 10.1228;

async function tryFetch(label: string, url: string, timeout = 10000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'BRW-API/1.0 (lebenswert.de)',
        'Accept': 'application/json, text/html, */*',
      },
      signal: AbortSignal.timeout(timeout),
    });
    const text = await res.text();
    console.log(`\n${label}`);
    console.log(`  Status: ${res.status}, Content-Type: ${res.headers.get('content-type')}, Length: ${text.length}`);
    if (text.length < 2000) {
      console.log(`  Response: ${text.substring(0, 1500).replace(/\n/g, '\\n')}`);
    } else {
      console.log(`  Response (first 1500): ${text.substring(0, 1500).replace(/\n/g, '\\n')}`);
    }
    return text;
  } catch (err) {
    console.log(`\n${label}`);
    console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function main() {
  console.log('=== 1. Get VBORIS app configuration from DANord ===\n');

  // map.apps typical config endpoints
  const configUrls = [
    'https://danord.gdi-sh.de/viewer/resources/apps/VBORIS/app.json',
    'https://danord.gdi-sh.de/viewer/rest/apps/VBORIS',
    'https://danord.gdi-sh.de/viewer/rest/apps/VBORIS?f=json',
  ];

  let appConfig: any = null;
  for (const url of configUrls) {
    const text = await tryFetch(`App config: ${url}`, url);
    if (text && text.startsWith('{')) {
      try {
        appConfig = JSON.parse(text);
        break;
      } catch {}
    }
  }

  // Extract all URLs from the config
  if (appConfig) {
    const jsonStr = JSON.stringify(appConfig);
    const urls = [...new Set(jsonStr.match(/https?:\/\/[^"\\]+/gi) || [])];
    console.log('\n\nAll URLs found in app config:');
    for (const url of urls) {
      console.log(`  ${url}`);
    }

    // Look for specific service URLs
    const serviceUrls = urls.filter(u =>
      u.includes('MapServer') || u.includes('WMS') || u.includes('WFS') ||
      u.includes('wms') || u.includes('wfs') || u.includes('arcgis') ||
      u.includes('VBORIS') || u.includes('boris')
    );
    if (serviceUrls.length) {
      console.log('\n\nService URLs found:');
      for (const url of serviceUrls) {
        console.log(`  ${url}`);
      }
    }
  }

  console.log('\n\n=== 2. Try map.apps bundles/config ===\n');

  // map.apps stores map layer configs in bundles
  await tryFetch('VBORIS bundles',
    'https://danord.gdi-sh.de/viewer/resources/apps/VBORIS/bundles.json');

  console.log('\n\n=== 3. Try direct ArcGIS MapServer at internal URL (may be proxied) ===\n');

  // The internal URL from GetCapabilities was watkipw023.dpaorinp.de:6443
  // Try if danord proxies to this
  const proxyBases = [
    'https://danord.gdi-sh.de/viewer/proxy',
    'https://danord.gdi-sh.de/viewer/proxy/https/watkipw023.dpaorinp.de:6443/arcgis/services/FACHDATEN/VBORIS/MapServer',
    'https://danord.gdi-sh.de/proxy',
  ];
  for (const base of proxyBases) {
    await tryFetch(`Proxy: ${base}`, `${base}?f=json`);
  }

  console.log('\n\n=== 4. Try different WMS base URLs from config ===\n');

  // Maybe the viewer uses a different WMS endpoint URL
  const alternativeWmsUrls = [
    'https://danord.gdi-sh.de/WMS_SH_FD_VBORIS',
    'https://danord.gdi-sh.de/viewer/proxy/WMS_SH_FD_VBORIS',
    // Try the internal ArcGIS WMS directly through different proxies
    'https://service.gdi-sh.de/SH_FD_VBORIS',
    'https://service.gdi-sh.de/FACHDATEN_VBORIS',
  ];

  for (const url of alternativeWmsUrls) {
    await tryFetch(`Alt WMS: ${url}`,
      `${url}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`);
  }

  console.log('\n\n=== 5. Try the working WMS URL with GetMap (smaller bbox, simpler params) ===\n');

  // Maybe GetMap fails because of specific params. Try simplest possible request.
  const wmsBase = 'https://service.gdi-sh.de/WMS_SH_FD_VBORIS';

  // Try with EPSG:25832 and correct UTM coords for Kiel
  const utmE = 573026;
  const utmN = 6020074;

  // Simplest GetMap
  await tryFetch('GetMap simple PNG',
    `${wmsBase}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Bodenrichtwertzonen_2024&CRS=EPSG:25832&BBOX=${utmE-50},${utmN-50},${utmE+50},${utmN+50}&WIDTH=100&HEIGHT=100&FORMAT=image/png&STYLES=`);

  // Try without STYLES
  await tryFetch('GetMap no STYLES',
    `${wmsBase}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Bodenrichtwertzonen_2024&CRS=EPSG:25832&BBOX=${utmE-50},${utmN-50},${utmE+50},${utmN+50}&WIDTH=100&HEIGHT=100&FORMAT=image/png`);

  // Try WMS 1.1.1
  await tryFetch('GetMap 1.1.1',
    `${wmsBase}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Bodenrichtwertzonen_2024&SRS=EPSG:25832&BBOX=${utmE-50},${utmN-50},${utmE+50},${utmN+50}&WIDTH=100&HEIGHT=100&FORMAT=image/png&STYLES=`);

  // Try with TRANSPARENT=TRUE (sometimes needed for ArcGIS)
  await tryFetch('GetMap TRANSPARENT',
    `${wmsBase}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Bodenrichtwertzonen_2024&CRS=EPSG:25832&BBOX=${utmE-50},${utmN-50},${utmE+50},${utmN+50}&WIDTH=100&HEIGHT=100&FORMAT=image/png&STYLES=&TRANSPARENT=TRUE`);

  console.log('\n\n=== 6. Inspect VBORIS HTML for embedded config ===\n');

  // The VBORIS viewer HTML may contain embedded service URLs
  const viewerHtml = await tryFetch('VBORIS viewer HTML',
    'https://danord.gdi-sh.de/viewer/resources/apps/VBORIS/index.html');

  if (viewerHtml) {
    // Look for data-* attributes or script configs
    const scriptSrcs = viewerHtml.match(/src="([^"]+)"/gi) || [];
    console.log('\n  Script sources:');
    for (const src of scriptSrcs.slice(0, 10)) {
      console.log(`    ${src}`);
    }

    // Look for init.js or config references
    const configRefs = viewerHtml.match(/(?:config|init|app)\.(js|json)/gi) || [];
    console.log('\n  Config references:');
    for (const ref of configRefs) {
      console.log(`    ${ref}`);
    }
  }
}

main().catch(console.error);
