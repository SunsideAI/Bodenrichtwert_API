/**
 * Debug-Script: Rohe API-Antworten für fehlgeschlagene Adapter
 *
 * Nutzung: npx tsx debug-raw-responses.ts
 *
 * Zeigt die rohen JSON-Properties / XML-Texte die von den
 * WFS/WMS-Endpunkten kommen, damit wir die richtigen Feldnamen finden.
 */

const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function section(title: string) {
  console.log(`\n${CYAN}${'═'.repeat(60)}${RESET}`);
  console.log(`${CYAN}  ${title}${RESET}`);
  console.log(`${CYAN}${'═'.repeat(60)}${RESET}\n`);
}

function sub(label: string, text: string, maxLen = 1500) {
  console.log(`${YELLOW}  ${label}:${RESET}`);
  console.log(`${DIM}${text.slice(0, maxLen)}${text.length > maxLen ? '...(truncated)' : ''}${RESET}\n`);
}

async function fetchText(url: string, timeout = 10000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'BRW-API/1.0 debug', Accept: 'application/geo+json, application/json, text/xml' },
      signal: AbortSignal.timeout(timeout),
    });
    const status = `${res.status} ${res.statusText}`;
    const text = await res.text();
    return `[${status}] ${text}`;
  } catch (err: any) {
    return `[ERROR] ${err.message}`;
  }
}

async function debugHE() {
  section('HE Hessen – WFS GeoJSON Properties');

  // Frankfurt Zeil
  const lat = 50.1109, lon = 8.6821;
  const d = 0.0005;
  const bbox = `${lat - d},${lon - d},${lat + d},${lon + d},urn:ogc:def:crs:EPSG::4258`;
  const wfsUrl = 'https://www.gds.hessen.de/wfs2/boris/cgi-bin/brw/2024/wfs';

  // JSON query
  const jsonUrl = `${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature&typeNames=boris:BR_BodenrichtwertZonal&bbox=${bbox}&outputFormat=application/json&count=3`;
  console.log(`  ${DIM}URL: ${jsonUrl.slice(0, 150)}...${RESET}\n`);

  const resp = await fetchText(jsonUrl);
  if (resp) {
    // Try to parse JSON and show properties
    const bodyStart = resp.indexOf('{');
    if (bodyStart >= 0) {
      try {
        const json = JSON.parse(resp.slice(bodyStart));
        if (json.features?.length) {
          for (let i = 0; i < Math.min(json.features.length, 2); i++) {
            const p = json.features[i].properties;
            sub(`Feature ${i} – ALLE Properties`, JSON.stringify(p, null, 2));
          }
        } else {
          sub('Antwort (kein Feature)', resp.slice(0, 1500));
        }
      } catch {
        sub('Antwort (kein JSON)', resp.slice(0, 1500));
      }
    } else {
      sub('Antwort (kein JSON)', resp.slice(0, 1500));
    }
  }

  // Also try GML to see element names
  const gmlUrl = `${wfsUrl}?service=WFS&version=2.0.0&request=GetFeature&typeNames=boris:BR_BodenrichtwertZonal&bbox=${bbox}&count=1`;
  const gmlResp = await fetchText(gmlUrl);
  if (gmlResp) {
    sub('GML Antwort (erste Feature)', gmlResp.slice(0, 2000));
  }
}

async function debugHH() {
  section('HH Hamburg – WFS GetCapabilities');

  const wfsUrl = 'https://geodienste.hamburg.de/HH_WFS_Bodenrichtwerte';
  const capUrl = `${wfsUrl}?service=WFS&version=2.0.0&request=GetCapabilities`;
  console.log(`  ${DIM}URL: ${capUrl}${RESET}\n`);

  const resp = await fetchText(capUrl, 15000);
  if (resp) {
    sub('GetCapabilities (erste 2000 chars)', resp.slice(0, 2000));

    // Extract all Name elements
    const body = resp.slice(resp.indexOf('<') >= 0 ? resp.indexOf('<') : 0);
    const names = [...body.matchAll(/<(?:[a-zA-Z]+:)?Name>([^<]+)<\/(?:[a-zA-Z]+:)?Name>/g)]
      .map(m => m[1]);
    console.log(`  ${YELLOW}Alle <Name> Elemente:${RESET} ${names.length > 0 ? names.join(', ') : '(keine gefunden)'}\n`);

    // Also check for FeatureType sections
    const ftMatches = [...body.matchAll(/<(?:[a-zA-Z]+:)?FeatureType[^>]*>/g)];
    console.log(`  ${YELLOW}FeatureType Sektionen:${RESET} ${ftMatches.length}\n`);
  }

  // Also try WFS 1.1.0
  const cap11Url = `${wfsUrl}?service=WFS&version=1.1.0&request=GetCapabilities`;
  const resp11 = await fetchText(cap11Url, 15000);
  if (resp11) {
    sub('WFS 1.1.0 GetCapabilities (erste 1500 chars)', resp11.slice(0, 1500));
  }
}

async function debugSN() {
  section('SN Sachsen – WMS GetFeatureInfo mit brw_2024');

  const lat = 51.3397, lon = 12.3731;
  const d = 0.001;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const baseUrl = 'https://www.landesvermessung.sachsen.de/fp/http-proxy/svc';

  // Try the discovered layer brw_2024 with cfg=boris_2024
  for (const format of ['text/xml', 'text/html', 'application/json', 'text/plain']) {
    const url = `${baseUrl}?cfg=boris_2024&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=brw_2024&QUERY_LAYERS=brw_2024&SRS=EPSG:4326&BBOX=${bbox}&WIDTH=101&HEIGHT=101&X=50&Y=50&INFO_FORMAT=${encodeURIComponent(format)}&FEATURE_COUNT=5&STYLES=&FORMAT=image/png`;
    const resp = await fetchText(url);
    if (resp) sub(`brw_2024 [${format}]`, resp.slice(0, 1500));
  }
}

async function debugSH() {
  section('SH Schleswig-Holstein – WMS GetCapabilities');

  const urls = [
    'https://service.gdi-sh.de/WMS_SH_FD_VBORIS',
    'https://service.gdi-sh.de/WMS_SH_BORIS',
  ];

  for (const wmsUrl of urls) {
    const capUrl = `${wmsUrl}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetCapabilities`;
    console.log(`  ${DIM}URL: ${capUrl}${RESET}\n`);
    const resp = await fetchText(capUrl, 15000);
    if (resp) {
      sub(`GetCapabilities von ${wmsUrl}`, resp.slice(0, 2000));

      // Extract Layer names
      const body = resp.slice(resp.indexOf('<') >= 0 ? resp.indexOf('<') : 0);
      const names = [...body.matchAll(/<Name>([^<]+)<\/Name>/g)].map(m => m[1]);
      if (names.length > 0) {
        console.log(`  ${YELLOW}Layer-Namen:${RESET} ${names.join(', ')}\n`);
      }
    }
  }
}

async function debugMV() {
  section('MV Mecklenburg-Vorpommern – WFS + WMS Endpoints');

  const endpoints = [
    { url: 'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wfs', type: 'WFS' },
    { url: 'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wms', type: 'WMS' },
    { url: 'https://www.geodaten-mv.de/geoserver/bodenrichtwerte/wfs', type: 'WFS' },
    { url: 'https://www.geodaten-mv.de/geoserver/bodenrichtwerte/wms', type: 'WMS' },
  ];

  for (const ep of endpoints) {
    const service = ep.type;
    const version = service === 'WFS' ? '2.0.0' : '1.1.1';
    const capUrl = `${ep.url}?service=${service}&version=${version}&request=GetCapabilities`;
    const resp = await fetchText(capUrl);
    if (resp) sub(`${ep.type} GetCap: ${ep.url}`, resp.slice(0, 800));
  }
}

async function main() {
  console.log(`\n${BOLD}Debug: Rohe API-Antworten für 5 fehlgeschlagene Adapter${RESET}\n`);

  await debugHE();
  await debugHH();
  await debugSN();
  await debugSH();
  await debugMV();

  console.log(`\n${BOLD}Fertig. Bitte die Ausgabe oben kopieren und an Claude senden.${RESET}\n`);
}

main().catch(console.error);
