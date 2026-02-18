/**
 * Debug script for Round 3: HH, SN, MV
 * Dumps raw API responses to understand what data format we get.
 */

async function debugHH() {
  console.log('\n=== HH (Hamburg) ===');
  const wfsUrl = 'https://geodienste.hamburg.de/HH_WFS_Bodenrichtwerte';
  const lat = 53.5530, lon = 9.9925;
  const delta = 0.0005;
  const bbox = `${lat - delta},${lon - delta},${lat + delta},${lon + delta},urn:ogc:def:crs:EPSG::4326`;

  // Try the discovered type names
  const typeNames = [
    'app:lgv_brw_zoniert_alle',
    'app:lgv_brw_zonen_2017',
    'app:lgv_brw_zonen_2016',
  ];

  for (const typeName of typeNames) {
    // Try JSON
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: typeName,
        bbox: bbox,
        outputFormat: 'application/json',
        count: '5',
      });
      const res = await fetch(`${wfsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });
      console.log(`\n  ${typeName} [JSON] → ${res.status} ${res.statusText}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`  Response (500 chars): ${text.substring(0, 500)}`);
        // If JSON, check features
        if (text.trimStart().startsWith('{')) {
          const json = JSON.parse(text);
          console.log(`  Features: ${json.features?.length || 0}`);
          if (json.features?.length) {
            console.log(`  First feature props:`, JSON.stringify(json.features[0].properties, null, 2).substring(0, 800));
          }
        }
      }
    } catch (e: any) {
      console.log(`  ${typeName} [JSON] → ERROR: ${e.message}`);
    }

    // Try GML (no outputFormat)
    try {
      const params = new URLSearchParams({
        service: 'WFS',
        version: '2.0.0',
        request: 'GetFeature',
        typeNames: typeName,
        bbox: bbox,
        count: '5',
      });
      const res = await fetch(`${wfsUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });
      console.log(`\n  ${typeName} [GML] → ${res.status} ${res.statusText}`);
      if (res.ok) {
        const text = await res.text();
        console.log(`  Response (800 chars): ${text.substring(0, 800)}`);
      }
    } catch (e: any) {
      console.log(`  ${typeName} [GML] → ERROR: ${e.message}`);
    }
  }

  // Also try WMS GetFeatureInfo as alternative for HH
  console.log('\n  --- HH WMS fallback ---');
  const wmsUrl = 'https://geodienste.hamburg.de/HH_WMS_Bodenrichtwerte';
  const wmsDelta = 0.001;
  const wmsBbox = `${lon - wmsDelta},${lat - wmsDelta},${lon + wmsDelta},${lat + wmsDelta}`;
  for (const layer of ['app:lgv_brw_zoniert_alle', 'lgv_brw_zoniert_alle', '0', '1']) {
    for (const fmt of ['text/plain', 'text/xml', 'application/json']) {
      try {
        const params = new URLSearchParams({
          SERVICE: 'WMS',
          VERSION: '1.1.1',
          REQUEST: 'GetFeatureInfo',
          LAYERS: layer,
          QUERY_LAYERS: layer,
          SRS: 'EPSG:4326',
          BBOX: wmsBbox,
          WIDTH: '101',
          HEIGHT: '101',
          X: '50',
          Y: '50',
          INFO_FORMAT: fmt,
          FEATURE_COUNT: '5',
          STYLES: '',
          FORMAT: 'image/png',
        });
        const res = await fetch(`${wmsUrl}?${params}`, {
          headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
          signal: AbortSignal.timeout(8000),
        });
        console.log(`  WMS [${layer}/${fmt}] → ${res.status}`);
        if (res.ok) {
          const text = await res.text();
          if (text.trim().length > 10 && !text.includes('ServiceException')) {
            console.log(`    Response (500 chars): ${text.substring(0, 500)}`);
          }
        }
      } catch (e: any) {
        console.log(`  WMS [${layer}/${fmt}] → ERROR: ${e.message}`);
      }
    }
  }
}

async function debugSN() {
  console.log('\n=== SN (Sachsen) ===');
  const proxyUrl = 'https://www.landesvermessung.sachsen.de/fp/http-proxy/svc';
  const lat = 51.3397, lon = 12.3731;
  const delta = 0.001;
  const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

  // First: Try GetCapabilities to discover actual layers
  console.log('  --- GetCapabilities ---');
  for (const cfg of ['boris_2024', 'boris_2023']) {
    try {
      const params = new URLSearchParams({
        cfg: cfg,
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetCapabilities',
      });
      const res = await fetch(`${proxyUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });
      console.log(`  GetCap [${cfg}] → ${res.status}`);
      if (res.ok) {
        const xml = await res.text();
        // Extract all <Name> elements to find layer names
        const names = [...xml.matchAll(/<Name>([^<]+)<\/Name>/gi)]
          .map(m => m[1].trim())
          .filter(n => n.length > 0 && n.length < 100);
        console.log(`  Layers: ${names.join(', ')}`);
      }
    } catch (e: any) {
      console.log(`  GetCap [${cfg}] → ERROR: ${e.message}`);
    }
  }

  // Try different layer names
  console.log('  --- GetFeatureInfo ---');
  const layerNames = ['brw_2024', 'brw_bauland_2024', 'brw_2023', 'brw_bauland_2023', '0'];
  for (const layer of layerNames) {
    const year = layer.match(/\d{4}/)?.[0] || '2024';
    try {
      const params = new URLSearchParams({
        cfg: `boris_${year}`,
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetFeatureInfo',
        LAYERS: layer,
        QUERY_LAYERS: layer,
        SRS: 'EPSG:4326',
        BBOX: bbox,
        WIDTH: '101',
        HEIGHT: '101',
        X: '50',
        Y: '50',
        INFO_FORMAT: 'text/plain',
        FEATURE_COUNT: '5',
        STYLES: '',
        FORMAT: 'image/png',
      });
      const res = await fetch(`${proxyUrl}?${params}`, {
        headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
        signal: AbortSignal.timeout(10000),
      });
      console.log(`\n  [${layer} / cfg=${year}] → ${res.status} (${res.headers.get('content-type')})`);
      if (res.ok) {
        const text = await res.text();
        console.log(`  Response (500 chars): ${text.substring(0, 500)}`);
      }
    } catch (e: any) {
      console.log(`  [${layer}] → ERROR: ${e.message}`);
    }
  }
}

async function debugMV() {
  console.log('\n=== MV (Mecklenburg-Vorpommern) ===');
  const lat = 53.6355, lon = 11.4015;
  const delta = 0.001;
  const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;

  const wmsUrl = 'https://www.geodaten-mv.de/dienste/bodenrichtwerte_wms';

  // GetCapabilities - show ALL layers
  console.log('  --- WMS GetCapabilities ---');
  try {
    const params = new URLSearchParams({
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetCapabilities',
    });
    const res = await fetch(`${wmsUrl}?${params}`, {
      headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
      signal: AbortSignal.timeout(10000),
    });
    console.log(`  GetCap → ${res.status}`);
    if (res.ok) {
      const xml = await res.text();
      const names = [...xml.matchAll(/<Name>([^<]+)<\/Name>/gi)]
        .map(m => m[1].trim())
        .filter(n => n.length > 0 && n.length < 120);
      console.log(`  ALL layer names: ${names.join(', ')}`);

      // Show supported GetFeatureInfo formats
      const fmtMatch = xml.match(/GetFeatureInfo[\s\S]*?<\/GetFeatureInfo>/i);
      if (fmtMatch) {
        const formats = [...fmtMatch[0].matchAll(/<Format>([^<]+)<\/Format>/gi)]
          .map(m => m[1].trim());
        console.log(`  Supported INFO_FORMATs: ${formats.join(', ')}`);
      }
    }
  } catch (e: any) {
    console.log(`  GetCap → ERROR: ${e.message}`);
  }

  // Try GetFeatureInfo with discovered layer and various formats
  console.log('  --- GetFeatureInfo ---');
  const layers = ['bodenrichtwerte', 'bodenrichtwert', 'BRW', '0'];
  const formats = ['text/plain', 'text/xml', 'application/json', 'application/vnd.ogc.gml', 'text/html'];
  for (const layer of layers) {
    for (const fmt of formats) {
      try {
        const params = new URLSearchParams({
          SERVICE: 'WMS',
          VERSION: '1.1.1',
          REQUEST: 'GetFeatureInfo',
          LAYERS: layer,
          QUERY_LAYERS: layer,
          SRS: 'EPSG:4326',
          BBOX: bbox,
          WIDTH: '101',
          HEIGHT: '101',
          X: '50',
          Y: '50',
          INFO_FORMAT: fmt,
          FEATURE_COUNT: '5',
          STYLES: '',
          FORMAT: 'image/png',
        });
        const res = await fetch(`${wmsUrl}?${params}`, {
          headers: { 'User-Agent': 'BRW-API/1.0 (lebenswert.de)' },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const text = await res.text();
          if (text.trim().length > 10 && !text.includes('ServiceException') && !text.includes('ExceptionReport')) {
            console.log(`\n  [${layer}/${fmt}] → ${res.status} (${text.length} chars)`);
            console.log(`    Response (500 chars): ${text.substring(0, 500)}`);
          }
        }
      } catch {
        // skip
      }
    }
  }
}

async function main() {
  console.log('Debug Round 3 – Raw API responses for HH, SN, MV\n');
  await Promise.all([debugHH(), debugSN(), debugMV()]);
  console.log('\n=== DONE ===');
}

main().catch(console.error);
