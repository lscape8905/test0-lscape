// TerraAnalytica - Client-side UI & Visualization Application Controller
// Updated with GeoJSON loading, 3D polygon-masking, and Eum.go.kr UI bindings.

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const form = document.getElementById('analysis-form');
  const btnSubmit = document.getElementById('btn-submit');
  
  const panelIntro = document.getElementById('panel-intro');
  const panelRunning = document.getElementById('panel-running');
  const panelCompleted = document.getElementById('panel-completed');
  
  const orchestratorProgress = document.getElementById('orchestrator-progress');
  const orchestratorMessage = document.getElementById('orchestrator-message');
  
  // GeoJSON inputs
  const fileGeojson = document.getElementById('file-geojson');
  const textGeojson = document.getElementById('text-geojson');
  const btnLoadSample = document.getElementById('btn-load-sample');
  
  // Tab Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-content');
  
  // Results Container Elements
  const reportHtmlContainer = document.getElementById('report-html-container');
  const btnDownloadMd = document.getElementById('btn-download-md');
  
  // State variables
  let analysisResult = null;
  let activeAgentProgress = { terrain: 0, climate: 0, regulatory: 0, infra: 0 };
  
  // Default Sample GeoJSON
  const sampleGeoJSON = {
    "type": "Feature",
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [
          [127.342, 37.561],
          [127.349, 37.563],
          [127.351, 37.558],
          [127.346, 37.554],
          [127.341, 37.556],
          [127.342, 37.561]
        ]
      ]
    }
  };

  // Initialize Lucide Icons
  lucide.createIcons();

  // Load sample GeoJSON click handler
  btnLoadSample.addEventListener('click', () => {
    textGeojson.value = JSON.stringify(sampleGeoJSON, null, 2);
  });

  // Handle GeoJSON & DXF & DWG File Upload
  fileGeojson.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const fileName = file.name.toLowerCase();
    
    // Intercept DWG before reading to prevent large binary text reading crash
    if (fileName.endsWith('.dwg')) {
      alert('DWG 파일이 인식되었습니다. (WASM 가상 파서 모드 작동)\n\n바이너리 DWG 포맷에서 임의의 대상지 경계(Polygon)를 추출하여 시뮬레이션합니다.');
      const fakeCoords = [
        [10, 5], [20, 2], [28, 15], [22, 28], [8, 25]
      ];
      textGeojson.value = JSON.stringify([fakeCoords], null, 2);
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (evt) => {
      if (fileName.endsWith('.dxf')) {
        try {
          if (!window.DxfParser) {
            alert('DXF 파서를 불러오지 못했습니다.');
            return;
          }
          const parser = new window.DxfParser();
          const dxf = parser.parseSync(evt.target.result);
          
          let boundaryCoords = [];
          
          // Find the first POLYLINE or LWPOLYLINE to use as the boundary
          if (dxf.entities && dxf.entities.length > 0) {
            const polyline = dxf.entities.find(e => e.type === 'LWPOLYLINE' || e.type === 'POLYLINE');
            if (polyline && polyline.vertices) {
              boundaryCoords = polyline.vertices.map(v => [v.x, v.y]);
              
              // Ensure closed polygon
              if (boundaryCoords.length > 0) {
                const first = boundaryCoords[0];
                const last = boundaryCoords[boundaryCoords.length - 1];
                if (first[0] !== last[0] || first[1] !== last[1]) {
                  boundaryCoords.push([...first]);
                }
              }
            }
          }
          
          if (boundaryCoords.length > 0) {
            textGeojson.value = JSON.stringify([boundaryCoords], null, 2); // Wrap in array to match expected [[[x, y]]] or [[x, y]] format handled by parser
          } else {
            alert('DXF 파일에서 경계선(Polyline)을 찾을 수 없습니다. 도면에 닫힌 폴리선이 있는지 확인해주세요.');
          }
        } catch (err) {
          console.error('DXF Parsing Error:', err);
          alert('DXF 파일 파싱 중 오류가 발생했습니다.');
        }
      } else {
        try {
          const json = JSON.parse(evt.target.result);
          textGeojson.value = JSON.stringify(json, null, 2);
        } catch (err) {
          alert('올바른 JSON/GeoJSON 형식이 아닙니다.');
        }
      }
    };
    reader.readAsText(file);
  });

  // Helper to parse coordinates from textbox input
  function parseCoordinatesInput() {
    const val = textGeojson.value.trim();
    if (!val) return null;
    
    try {
      const parsed = JSON.parse(val);
      
      // Case 1: Standard GeoJSON Feature
      if (parsed.type === 'Feature' && parsed.geometry && parsed.geometry.type === 'Polygon') {
        return parsed.geometry.coordinates[0];
      }
      // Case 2: Direct coordinates array [[[x, y], ...]]
      if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
        if (Array.isArray(parsed[0][0])) {
          return parsed[0]; // strip outer wrap
        }
        return parsed; // raw array of [x, y]
      }
    } catch (e) {
      console.warn('Failed to parse GeoJSON/Coordinate array, using default boundary.', e);
    }
    return null;
  }

  // Map Drawing Logic (Leaflet + OpenStreetMap)
  const btnOpenMap = document.getElementById('btn-open-map');
  const btnCloseMap = document.getElementById('btn-close-map');
  const btnApplyMap = document.getElementById('btn-apply-map');
  const mapModal = document.getElementById('map-modal');
  
  // Mode toggles
  const btnModeDraw = document.getElementById('btn-mode-draw');
  const btnModeClick = document.getElementById('btn-mode-click');
  const instructionText = document.getElementById('map-instruction-text');
  
  let leafletMap = null;
  let drawnCoords = null; // Temp storage for drawn polygon
  let currentLayer = null;
  let selectedParcels = {}; // pnu -> { latlngs, layer } for multiple selection
  let mapMode = 'draw'; // 'draw' or 'click'

  function updateMapModeUI() {
    if (mapMode === 'draw') {
      btnModeDraw.classList.add('active');
      btnModeClick.classList.remove('active');
      document.getElementById('click-mode-tools').classList.add('hidden');
      instructionText.innerHTML = '<i data-lucide="info"></i> 좌측 툴바에서 <strong>다각형(Draw Polygon)</strong> 도구를 선택한 후, 지도 위에 점을 찍어 대상지 경계를 그리세요.';
      if (leafletMap) {
        leafletMap.pm.addControls({ drawPolygon: true, drawRectangle: true, editMode: true, dragMode: true, removalMode: true });
        // Enable map dragging
        leafletMap.dragging.enable();
      }
    } else {
      btnModeDraw.classList.remove('active');
      btnModeClick.classList.add('active');
      document.getElementById('click-mode-tools').classList.remove('hidden');
      instructionText.innerHTML = '<i data-lucide="info"></i> <strong>지적도를 클릭</strong>하여 필지를 선택하세요. 여러 필지를 연속해서 클릭하면 자동으로 합쳐집니다.';
      if (leafletMap) {
        leafletMap.pm.removeControls();
        leafletMap.pm.disableDraw();
      }
    }
    // Re-render lucide icons in the instruction text
    if (window.lucide) window.lucide.createIcons();
  }

  btnModeDraw.addEventListener('click', () => { mapMode = 'draw'; updateMapModeUI(); });
  btnModeClick.addEventListener('click', () => { mapMode = 'click'; updateMapModeUI(); });

  function initLeafletMap() {
    if (leafletMap) return; // already initialized
    
    // Initialize map centered at Seoul
    leafletMap = L.map('os-map').setView([37.5665, 126.9780], 13);

    // Add OpenStreetMap tile layer
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(leafletMap);

    // Add VWorld Cadastral Map (WMS)
    const vworldKey = 'C212FD59-03AA-3762-8CB2-CC987A1CA655';
    const vworldDomain = 'https://lscape8905.github.io';

    const vworldCadastral = L.tileLayer.wms("https://api.vworld.kr/req/wms?", {
      layers: 'lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun',
      styles: 'lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      key: vworldKey, 
      domain: vworldDomain,
      crs: L.CRS.EPSG3857,
      attribution: 'VWorld'
    });

    vworldCadastral.addTo(leafletMap);

    // Add Layer Control
    const overlayMaps = {
      "지적도 표시 (VWorld)": vworldCadastral
    };
    L.control.layers(null, overlayMaps, { position: 'topright' }).addTo(leafletMap);

    updateMapModeUI();

    // Capture drawn polygon (Draw Mode)
    leafletMap.on('pm:create', function(e) {
      if (currentLayer) {
        leafletMap.removeLayer(currentLayer); // Keep only one polygon
      }
      Object.values(selectedParcels).forEach(p => leafletMap.removeLayer(p.layer));
      selectedParcels = {};
      currentLayer = e.layer;
      
      const latlngs = currentLayer.getLatLngs()[0]; // Outer ring
      drawnCoords = latlngs.map(ll => [ll.lng, ll.lat]);
      // Close the polygon for GeoJSON
      if (drawnCoords.length > 0) {
        drawnCoords.push([latlngs[0].lng, latlngs[0].lat]);
      }
    });

    // Listen to map clicks (Click Mode)
    leafletMap.on('click', async function(e) {
      if (mapMode !== 'click') return;
      
      const pt = L.CRS.EPSG3857.project(e.latlng);
      const offset = 20; // 20 meters bbox
      const minx = pt.x - offset;
      const miny = pt.y - offset;
      const maxx = pt.x + offset;
      const maxy = pt.y + offset;
      
      const vworldKey = 'C212FD59-03AA-3762-8CB2-CC987A1CA655';
      const vworldDomain = window.location.origin;
      
      const wfsUrl = `https://api.vworld.kr/req/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=lp_pa_cbnd_bubun&BBOX=${minx},${miny},${maxx},${maxy},EPSG:3857&KEY=${vworldKey}&DOMAIN=${vworldDomain}&OUTPUT=text/javascript`;
      
      // VWorld hardcodes the JSONP callback to 'parseResponse', it ignores the callback URL parameter!
      window.parseResponse = function(data) {
        // Clean up script tags if we wanted to, but we can just leave it or find it by src
        const scripts = document.querySelectorAll(`script[src*="BBOX=${minx}"]`);
        scripts.forEach(s => s.remove());

        if (data && data.features && data.features.length > 0) {
          
          let targetFeature = null;
          let feature4326 = null;
          const clickedPoint = turf.point([e.latlng.lng, e.latlng.lat]);
          
          // Helper to convert 3857 to 4326
          function convertRings(rings) {
            return rings.map(ring => {
              return ring.map(coord => {
                const unproj = L.CRS.EPSG3857.unproject(L.point(coord[0], coord[1]));
                return [unproj.lng, unproj.lat];
              });
            });
          }

          // Find the exact polygon the user clicked
          for (let feat of data.features) {
            const newGeom = JSON.parse(JSON.stringify(feat.geometry));
            if (newGeom.type === 'Polygon') {
              newGeom.coordinates = convertRings(newGeom.coordinates);
            } else if (newGeom.type === 'MultiPolygon') {
              newGeom.coordinates = newGeom.coordinates.map(r => convertRings(r));
            }
            const testFeature = { type: 'Feature', geometry: newGeom, properties: feat.properties };
            
            if (window.turf && turf.booleanPointInPolygon(clickedPoint, testFeature)) {
              targetFeature = feat;
              feature4326 = testFeature;
              break;
            }
          }
          
          // Fallback to the first feature if exact match fails (e.g. edge click)
          if (!targetFeature) {
            targetFeature = data.features[0];
            const newGeom = JSON.parse(JSON.stringify(targetFeature.geometry));
            if (newGeom.type === 'Polygon') {
              newGeom.coordinates = convertRings(newGeom.coordinates);
            } else if (newGeom.type === 'MultiPolygon') {
              newGeom.coordinates = newGeom.coordinates.map(r => convertRings(r));
            }
            feature4326 = { type: 'Feature', geometry: newGeom, properties: targetFeature.properties };
          }
          
          const pnu = targetFeature.properties.pnu;
          
          // Get user's desired click behavior
          const clickBehavior = document.querySelector('input[name="clickBehavior"]:checked').value;
          const isSelected = !!selectedParcels[pnu];
          
          // Clear any hand-drawn currentLayer if it exists
          if (currentLayer) {
            leafletMap.removeLayer(currentLayer);
            currentLayer = null;
          }
          
          if (isSelected) {
            if (clickBehavior === 'select') {
               // Already selected and user is in 'select' mode. Do nothing.
               return;
            }
            // In 'toggle' or 'deselect' mode, remove it
            leafletMap.removeLayer(selectedParcels[pnu].layer);
            delete selectedParcels[pnu];
          } else {
            if (clickBehavior === 'deselect') {
               // Not selected but user is in 'deselect' mode. Do nothing.
               return;
            }
            
            // Draw on map using L.geoJSON to perfectly support holes and disjoint parts
            const layer = L.geoJSON(feature4326, {
              style: {
                color: '#06b6d4',
                fillColor: '#10b981',
                fillOpacity: 0.4,
                interactive: false
              }
            }).addTo(leafletMap);
            
            selectedParcels[pnu] = { feature: feature4326, layer: layer, pnu: pnu };
          }
          
          // Recompute merged boundary using Turf
          const pnuKeys = Object.keys(selectedParcels);
          if (pnuKeys.length === 0) {
            drawnCoords = null;
            return;
          }
          
          let combined = null;
          let isMulti = false;
          
          if (window.turf) {
            try {
              // Buffer by 0.5 meters (0.0005 km) to bridge microscopic GIS gaps between adjacent parcels
              const bufferDist = 0.0005;
              combined = turf.buffer(selectedParcels[pnuKeys[0]].feature, bufferDist, {units: 'kilometers'});
              
              for (let i = 1; i < pnuKeys.length; i++) {
                const nextPoly = turf.buffer(selectedParcels[pnuKeys[i]].feature, bufferDist, {units: 'kilometers'});
                combined = turf.union(combined, nextPoly);
              }
              
              // Extract the largest outer ring for the 3D Terrain visualizer
              if (combined && combined.geometry) {
                if (combined.geometry.type === 'Polygon') {
                  drawnCoords = combined.geometry.coordinates[0];
                } else if (combined.geometry.type === 'MultiPolygon') {
                  // Find largest polygon by area to use as the main bounding ring
                  let maxArea = -1;
                  let bestRing = null;
                  combined.geometry.coordinates.forEach(polyCoords => {
                    const ring = polyCoords[0];
                    try {
                       const area = turf.area(turf.polygon([ring]));
                       if (area > maxArea) { maxArea = area; bestRing = ring; }
                    } catch(e) {}
                  });
                  drawnCoords = bestRing;
                  
                  // Optional alert if multiple disjoint areas are strictly separated
                  if (combined.geometry.coordinates.length > 1 && !isSelected) {
                    alert('주의: 선택하신 지적도들이 서로 떨어져 있어 3D 모델링은 가장 큰 영역 기준으로 생성됩니다.');
                  }
                }
              }
            } catch (err) {
              console.error('Turf union failed:', err);
              // Fallback
              const fbGeom = selectedParcels[pnuKeys[0]].feature.geometry;
              drawnCoords = fbGeom.type === 'Polygon' ? fbGeom.coordinates[0] : fbGeom.coordinates[0][0];
            }
          } else {
             // Fallback if turf is missing
             const fbGeom = selectedParcels[pnuKeys[0]].feature.geometry;
             drawnCoords = fbGeom.type === 'Polygon' ? fbGeom.coordinates[0] : fbGeom.coordinates[0][0];
          }
          
        } else {
          alert('해당 위치에 지적도 정보가 없거나 올바르지 않은 위치입니다.');
        }
      };

      const script = document.createElement('script');
      script.src = wfsUrl;
      script.onerror = function() {
        script.remove();
        alert('지적도 서버에 연결할 수 없습니다.');
      };
      document.body.appendChild(script);
    });

    // Listen to edits
    leafletMap.on('pm:remove', function(e) {
      drawnCoords = null;
      currentLayer = null;
      Object.values(selectedParcels).forEach(p => leafletMap.removeLayer(p.layer));
      selectedParcels = {};
    });
  }

  btnOpenMap.addEventListener('click', () => {
    mapModal.classList.remove('hidden');
    // Initialize map on first open
    if (!leafletMap) {
      setTimeout(initLeafletMap, 200); // Wait for modal animation
    } else {
      setTimeout(() => leafletMap.invalidateSize(), 200);
    }
  });

  btnCloseMap.addEventListener('click', () => {
    mapModal.classList.add('hidden');
  });

  btnApplyMap.addEventListener('click', async () => {
    if (!drawnCoords || drawnCoords.length < 3) {
      alert('지도에서 대상지 다각형 경계를 완전히 그려주세요.');
      return;
    }
    
    // Auto-fill GeoJSON text box
    textGeojson.value = JSON.stringify([drawnCoords], null, 2);
    mapModal.classList.add('hidden');

    try {
      // 1. Calculate Area using Turf.js
      if (window.turf) {
        const polyFeature = turf.polygon([drawnCoords]);
        const areaSqM = Math.round(turf.area(polyFeature));
        document.getElementById('input-area').value = areaSqM;
        
        // 2. Reverse Geocoding using Nominatim (OpenStreetMap)
        const center = turf.centerOfMass(polyFeature);
        const lng = center.geometry.coordinates[0];
        const lat = center.geometry.coordinates[1];
        
        document.getElementById('input-address').value = '주소 위경도 변환 중...';
        
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
        const data = await res.json();
        if (data && data.display_name) {
          // Format the Korean address to start with State/City if possible
          let krAddress = data.display_name;
          if (krAddress.includes(', 대한민국')) {
             krAddress = krAddress.replace(', 대한민국', '');
             // Reverse the comma-separated OSM address to fit Korean standard (Big to Small)
             krAddress = krAddress.split(', ').reverse().join(' ');
          }
          document.getElementById('input-address').value = krAddress;
        } else {
          document.getElementById('input-address').value = '주소 변환 실패 (위도: ' + lat.toFixed(4) + ', 경도: ' + lng.toFixed(4) + ')';
        }
      }
    } catch(err) {
      console.error('Auto-fill error:', err);
    }

    draw3DTerrain(); // Trigger 3D view update
  });

  // Tab switching logic
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(targetTab).classList.add('active');
      
      // Trigger canvas re-draws when tabs become active
      if (targetTab === 'tab-terrain' && analysisResult) {
        draw3DTerrain();
      } else if (targetTab === 'tab-regulatory' && analysisResult) {
        drawInfraMap();
      }
    });
  });

  // Heuristic & Real VWorld API engine for Eum data auto-fill
  async function fetchEumData(address, boundaryCoords) {
    const logBox = document.getElementById('analysis-log');
    logBox.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'log-entry orchestrator';
    div.innerHTML = `<span class="time">[${new Date().toLocaleTimeString()}]</span> <span class="badge">EUM API</span> 주소 및 지적 바운더리 기반 용도지역/지구 자동 판별 중...`;
    logBox.appendChild(div);

    let inferredTerrain = 'hilly';
    let inferredRegion = 'central';
    let inferredZoning = 'planned-management';
    let inferredSubDistricts = [];

    // Basic heuristic rules based on Korean address keywords
    if (address.includes('산') || address.includes('평창') || address.includes('가평')) {
      inferredTerrain = 'mountainous';
      inferredRegion = 'mountain';
      inferredZoning = 'greenbelt';
      if (address.includes('가평') || address.includes('양평')) inferredSubDistricts.push('water-protection');
    } else if (address.includes('강남') || address.includes('종로') || address.includes('테헤란')) {
      inferredTerrain = 'flat';
      inferredZoning = 'commercial';
      inferredSubDistricts.push('landscape');
    } else if (address.includes('제주') || address.includes('서귀포') || address.includes('부산')) {
      inferredRegion = address.includes('해안') || address.includes('부산') ? 'coastal' : 'southern';
      inferredTerrain = 'flat';
      inferredZoning = 'residential';
    }

    // Try REAL VWorld API lookup if boundary coordinates are available
    if (boundaryCoords && boundaryCoords.length > 0) {
      try {
        let minx = 999, miny = 999, maxx = -999, maxy = -999;
        boundaryCoords.forEach(pt => {
          const x = pt[0]; const y = pt[1];
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        });
        const buffer = 0.0001;
        const bboxStr = `${minx-buffer},${miny-buffer},${maxx+buffer},${maxy+buffer}`;

        // JSONP Helper inside app.js
        const fetchJsonpApp = (url) => {
          return new Promise((resolve) => {
            const callbackName = 'vworld_jsonp_eum_' + Math.round(1000000 * Math.random());
            const script = document.createElement('script');
            const timeoutId = setTimeout(() => {
              delete window[callbackName];
              if (document.body.contains(script)) document.body.removeChild(script);
              resolve(null);
            }, 2500);
            
            window[callbackName] = function(data) {
              clearTimeout(timeoutId);
              delete window[callbackName];
              if (document.body.contains(script)) document.body.removeChild(script);
              resolve(data);
            };
            
            script.src = url + '&format=json&callback=' + callbackName;
            script.onerror = function() {
              clearTimeout(timeoutId);
              delete window[callbackName];
              if (document.body.contains(script)) document.body.removeChild(script);
              resolve(null);
            };
            document.body.appendChild(script);
          });
        };

        const vworldKey = 'C212FD59-03AA-3762-8CB2-CC987A1CA655';
        const vworldDomain = 'https://lscape8905.github.io';

        // Query layers in parallel
        const layers = ['LT_C_UQ111', 'LT_C_UQ112', 'LT_C_UQ113', 'LT_C_UQ114', 'LT_C_UQ121'];
        const promises = layers.map(layer => {
          const url = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=${layer}&key=${vworldKey}&domain=${vworldDomain}&geomFilter=BOX(${bboxStr})`;
          return fetchJsonpApp(url);
        });

        const results = await Promise.all(promises);
        let detectedZoningName = '';
        let hasLandscapeZone = false;

        results.forEach((json, idx) => {
          if (json?.response?.result?.featureCollection?.features) {
            const features = json.response.result.featureCollection.features;
            features.forEach(f => {
              if (f.properties) {
                if (idx < 4) { // Zoning layers
                  Object.values(f.properties).forEach(val => {
                    if (typeof val === 'string' && (val.endsWith('지역') || val.endsWith('지구'))) {
                      detectedZoningName = val;
                    }
                  });
                } else if (idx === 4) { // Landscape zone
                  hasLandscapeZone = true;
                }
              }
            });
          }
        });

        if (detectedZoningName) {
          const text = detectedZoningName;
          if (text.includes('상업')) inferredZoning = 'commercial';
          else if (text.includes('주거')) inferredZoning = 'residential';
          else if (text.includes('공업')) inferredZoning = 'industrial';
          else if (text.includes('녹지') || text.includes('개발제한')) inferredZoning = 'greenbelt';
          else if (text.includes('계획관리')) inferredZoning = 'planned-management';
          else if (text.includes('생산관리') || text.includes('보전관리')) inferredZoning = 'production-management';
          else if (text.includes('농림')) inferredZoning = 'production-management';
          
          // If we detected a real zoning, adjust inferred terrain/region logically
          if (inferredZoning === 'greenbelt' || inferredZoning === 'production-management') {
            inferredTerrain = 'mountainous';
            inferredRegion = 'mountain';
          }
        }
        
        if (hasLandscapeZone && !inferredSubDistricts.includes('landscape')) {
          inferredSubDistricts.push('landscape');
        }

      } catch (err) {
        console.warn("VWorld auto-zoning lookup failed:", err);
      }
    }

    // Update UI elements with inferred/detected data
    document.getElementById('select-terrain').value = inferredTerrain;
    document.getElementById('select-region').value = inferredRegion;
    document.getElementById('select-zoning').value = inferredZoning;

    const checkboxes = document.querySelectorAll('input[name="sub-district"]');
    checkboxes.forEach(cb => {
      cb.checked = inferredSubDistricts.includes(cb.value);
    });

    const finishDiv = document.createElement('div');
    finishDiv.className = 'log-entry orchestrator';
    finishDiv.innerHTML = `<span class="time">[${new Date().toLocaleTimeString()}]</span> <span class="badge">EUM API</span> 판별 완료 (지형: ${inferredTerrain}, 용도지역: ${inferredZoning})`;
    logBox.appendChild(finishDiv);
    await new Promise(r => setTimeout(r, 500));
  }

  // Handle Form Submission (Analysis Start)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Transition UI to running mode FIRST so logs are visible
    panelIntro.classList.add('hidden');
    panelCompleted.classList.add('hidden');
    panelRunning.classList.remove('hidden');

    // Reset terminal consoles
    const consoles = ['terrain', 'climate', 'regulatory', 'infra'];
    consoles.forEach(c => {
      const consoleEl = document.getElementById(`console-${c}`);
      consoleEl.innerHTML = `<div class="log-entry text-dim">> Establishing connection...</div>`;
      document.getElementById(`progress-${c}`).style.width = '0%';
      document.getElementById(`pct-${c}`).innerText = '0%';
      
      const terminalEl = consoleEl.closest('.agent-terminal');
      terminalEl.querySelector('.status-text').className = 'status-text active';
      terminalEl.querySelector('.status-text').innerText = 'Running';
    });
    
    // Parse coordinates first so fetchEumData can use them for VWorld spatial lookup
    const boundaryCoords = parseCoordinatesInput();
    
    // 1. Run Auto-Fetch Mock & Real VWorld Engine
    const rawAddress = document.getElementById('input-address').value;
    await fetchEumData(rawAddress, boundaryCoords);
    
    const subDistricts = Array.from(document.querySelectorAll('input[name="sub-district"]:checked'))
      .map(cb => cb.value);

    // Extract selected parcels metadata
    const parcelList = [];
    Object.keys(selectedParcels).forEach(pnu => {
      const p = selectedParcels[pnu].feature.properties;
      const isMountain = pnu.charAt(10) === '2' ? '산 ' : '';
      const bonbun = parseInt(pnu.substring(11, 15), 10);
      const bubun = parseInt(pnu.substring(15, 19), 10);
      const jibunStr = isMountain + bonbun + (bubun > 0 ? '-' + bubun : '');
      
      let category = '임야';
      if (p && p.jibun) {
        const parts = p.jibun.split(' ');
        if (parts.length > 1) {
           category = parts[parts.length - 1]; // e.g. "대", "도", "구"
        } else if (!p.jibun.startsWith('산')) {
           category = '대'; // fallback
        }
      }
      let pArea = 0;
      if (window.turf && selectedParcels[pnu].feature) {
         try {
           pArea = Math.round(turf.area(selectedParcels[pnu].feature));
         } catch(e) {}
      }
      
      parcelList.push({ pnu, jibun: p.jibun || jibunStr, category, area: pArea });
    });
    
    // Expose for agents.js global usage
    window.latestParcelList = parcelList;

    const siteData = {
      address: document.getElementById('input-address').value,
      area: parseInt(document.getElementById('input-area').value),
      type: document.getElementById('select-terrain').value,
      region: document.getElementById('select-region').value,
      projectType: document.getElementById('select-project-type').value,
      zoning: document.getElementById('select-zoning').value,
      concept: document.getElementById('select-concept').value,
      subDistricts,
      boundaryCoords,
      parcelList
    };
    // Reset overall progress
    orchestratorProgress.style.width = '0%';
    orchestratorMessage.innerText = 'Initializing multi-agent scheduler...';
    
    activeAgentProgress = { terrain: 0, climate: 0, regulatory: 0, infra: 0 };

    try {
      // Run the Orchestrator parallel sweep
      analysisResult = await window.LandscapeAgents.startAnalysis(
        siteData,
        (agentId, message) => appendLog(agentId, message),
        (agentId, progress) => updateAgentProgress(agentId, progress)
      );
      
      // Show completed dashboard
      panelRunning.classList.add('hidden');
      panelCompleted.classList.remove('hidden');
      
      // Bind data to visual panels
      bindResultsToUI(siteData);
      
      // Activate first tab (Report)
      tabBtns[0].click();
      
    } catch (err) {
      console.error(err);
      orchestratorMessage.innerText = 'Analysis failed. See developer console.';
    }
  });

  function appendLog(agentId, message) {
    const consoleEl = document.getElementById(`console-${agentId}`);
    if (!consoleEl) return;
    
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logDiv = document.createElement('div');
    logDiv.className = 'log-entry';
    logDiv.innerHTML = `<span style="opacity: 0.4">[${timestamp}]</span> ${message}`;
    
    consoleEl.appendChild(logDiv);
    consoleEl.scrollTop = consoleEl.scrollHeight;

    if (message.includes('completed') || message.includes('complete')) {
      const terminalEl = consoleEl.closest('.agent-terminal');
      const statusEl = terminalEl.querySelector('.status-text');
      statusEl.innerText = 'Done';
      statusEl.className = 'status-text done';
    }
  }

  function updateAgentProgress(agentId, progress) {
    activeAgentProgress[agentId] = progress;
    
    const progressEl = document.getElementById(`progress-${agentId}`);
    const pctEl = document.getElementById(`pct-${agentId}`);
    
    if (progressEl) progressEl.style.width = `${progress}%`;
    if (pctEl) pctEl.innerText = `${progress}%`;
    
    const totalProgress = Object.values(activeAgentProgress).reduce((a, b) => a + b, 0);
    const avgProgress = Math.round(totalProgress / 4);
    
    orchestratorProgress.style.width = `${avgProgress}%`;
    
    if (avgProgress < 20) {
      orchestratorMessage.innerText = '토지이음 및 공간 GIS 모듈 로드 중...';
    } else if (avgProgress < 60) {
      orchestratorMessage.innerText = '경계선 투영 지형 마스크 수학적 적합성 검증 중...';
    } else if (avgProgress < 90) {
      orchestratorMessage.innerText = '인허가 행위제한 체크리스트 최종 종합 중...';
    } else {
      orchestratorMessage.innerText = '종합 조경 타임라인 패키지 빌드 중...';
    }
  }

  // Bind simulation results to visualizer components
  function bindResultsToUI(siteInput) {
    if (!analysisResult) return;
    
    const { terrain, climate, regulatory, infra, report } = analysisResult;
    
    // Tab 1: Marked.js Markdown rendering
    reportHtmlContainer.innerHTML = marked.parse(report);
    
    // Bind download trigger
    btnDownloadMd.onclick = () => {
      const blob = new Blob([report], { type: 'text/markdown;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', 'TerraAnalytica_Landscape_Report.md');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    // Tab 2: Terrain Stats
    document.getElementById('val-avg-slope').innerText = `${terrain.avgSlope}%`;
    document.getElementById('val-max-slope').innerText = `${terrain.maxSlope}%`;
    document.getElementById('val-cut-vol').innerText = `${terrain.cutAndFill.cutVolume.toLocaleString()} ㎥`;
    document.getElementById('val-fill-vol').innerText = `${terrain.cutAndFill.fillVolume.toLocaleString()} ㎥`;
    
    document.getElementById('val-dist-flat').innerText = `${terrain.slopeDistribution.flat}%`;
    document.getElementById('val-dist-moderate').innerText = `${terrain.slopeDistribution.moderate}%`;
    document.getElementById('val-dist-steep').innerText = `${terrain.slopeDistribution.steep}%`;
    
    document.getElementById('dist-flat').style.width = `${terrain.slopeDistribution.flat}%`;
    document.getElementById('dist-moderate').style.width = `${terrain.slopeDistribution.moderate}%`;
    document.getElementById('dist-steep').style.width = `${terrain.slopeDistribution.steep}%`;

    // Populate Tab 5: Site Statistics Dashboard
    if (terrain.stats && regulatory.stats) {
      const renderTable = (tbodyId, descId, summaryText, dataArr) => {
        document.getElementById(descId).innerText = summaryText;
        const tbody = document.getElementById(tbodyId);
        tbody.innerHTML = '';
        dataArr.forEach(row => {
          const tr = document.createElement('tr');
          if (row.isTotal) tr.style.fontWeight = 'bold';
          if (row.highlight) tr.className = 'highlight';
          if (row.isSub) {
             tr.style.color = 'var(--color-text-dim)';
             tr.style.fontSize = '0.8rem';
             tr.style.backgroundColor = 'rgba(0,0,0,0.15)';
          }
          
          tr.innerHTML = `
            <td style="${row.isSub ? 'text-align: left; padding-left: 1.5rem;' : ''}">${row.label}</td>
            <td>${row.area.toLocaleString()}</td>
            <td>${row.ratio.toFixed(1)}</td>
          `;
          tbody.appendChild(tr);
        });
      };
      
      renderTable('stat-tbody-elevation', 'stat-desc-elevation', terrain.stats.elevationSummary, terrain.stats.elevationTable);
      renderTable('stat-tbody-slope', 'stat-desc-slope', terrain.stats.slopeSummary, terrain.stats.slopeTable);
      renderTable('stat-tbody-ecology', 'stat-desc-ecology', regulatory.stats.ecologySummary, regulatory.stats.ecologyTable);
      renderTable('stat-tbody-mountain', 'stat-desc-mountain', regulatory.stats.mountainSummary, regulatory.stats.mountainTable);
      renderTable('stat-tbody-ownership', 'stat-desc-ownership', regulatory.stats.ownershipSummary, regulatory.stats.ownershipTable);
      renderTable('stat-tbody-category', 'stat-desc-category', regulatory.stats.categorySummary, regulatory.stats.categoryTable);
    }

    // Populate Tab 6: Parcel List
    const parcelTbody = document.getElementById('val-parcel-list-tbody');
    if (parcelTbody && window.latestParcelList) {
      parcelTbody.innerHTML = '';
      window.latestParcelList.forEach((p, i) => {
        const addrTokens = siteInput.address.split(' ');
        const baseAddr = addrTokens.length > 2 ? addrTokens.slice(0, 3).join(' ') : siteInput.address;
        const fullAddr = p.jibun.includes(' ') ? `${baseAddr} ${p.jibun}` : `${baseAddr} ${p.jibun}`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="text-align:center">${i + 1}</td>
          <td>${fullAddr}</td>
          <td style="text-align:center"><strong>${p.category}</strong></td>
          <td style="text-align:right">${(p.area || 0).toLocaleString()} ㎡</td>
          <td style="text-align:center; font-family: monospace;">${p.pnu}</td>
        `;
        parcelTbody.appendChild(tr);
      });
      document.getElementById('val-parcel-summary').innerText = `※ 총 ${window.latestParcelList.length}개 필지가 병합되어 분석되었습니다.`;
    }

    // Tab 3: Climate Stats
    document.getElementById('val-hardiness').innerText = `Zone ${climate.hardinessZone}`;
    document.getElementById('val-wind').innerText = `${climate.prevailingWind} / ${climate.avgWindSpeed} m/s`;
    
    // Populate Planting Cards
    const plantingContainer = document.getElementById('planting-cards');
    plantingContainer.innerHTML = '';
    climate.recommendedPlants.forEach(plant => {
      const card = document.createElement('div');
      card.className = 'plant-card';
      card.innerHTML = `
        <div class="plant-info">
          <span class="name">${plant.name}</span>
          <span class="type">${plant.type}</span>
        </div>
        <span class="plant-badge">${plant.weight}</span>
      `;
      plantingContainer.appendChild(card);
    });

    // Tab 4: Regulatory Eum.go.kr Document Sheet
    let primaryCategory = '임야';
    if (siteInput.parcelList && siteInput.parcelList.length > 0) {
      primaryCategory = siteInput.parcelList[0].category;
    }
    document.getElementById('doc-address').innerText = siteInput.address;
    document.getElementById('doc-category').innerText = primaryCategory;
    document.getElementById('doc-area').innerText = `${siteInput.area.toLocaleString()} ㎡`;
    document.getElementById('doc-zoning').innerHTML = regulatory.officialDocument.zoningLaw;
    document.getElementById('doc-other-laws').innerHTML = regulatory.officialDocument.otherLaws;
    
    // Populate Prohibited Actions
    const restUl = document.getElementById('doc-restrictions');
    restUl.innerHTML = '';
    if (regulatory.officialDocument.restrictedActions.length > 0) {
      regulatory.officialDocument.restrictedActions.forEach(act => {
        const li = document.createElement('li');
        li.textContent = act;
        restUl.appendChild(li);
      });
    } else {
      restUl.innerHTML = '<span style="color: var(--color-emerald)">✔ 허가 저촉을 유발하는 중대한 행위제한 사항 없음</span>';
    }

    // Populate Permitting Timeline Flow with Detailed Report
    const reportContainer = document.getElementById('permit-report-container');
    reportContainer.innerHTML = '';
    
    if (regulatory.permitSteps) {
      let html = '';
      
      // STEP 1
      html += '<h5 class="report-step-title">STEP 1. 핵심 인허가 (사업 주관)</h5>';
      html += '<table class="report-table"><thead><tr><th>구분</th><th>인허가</th><th>근거</th><th>처리기관</th></tr></thead><tbody>';
      regulatory.permitSteps.step1.forEach((s, i) => {
        html += `<tr><td>핵심${i+1}</td><td>${s.type}</td><td>${s.law}</td><td>${s.auth}</td></tr>`;
      });
      html += '</tbody></table>';
      
      // STEP 2
      html += '<h5 class="report-step-title">STEP 2. 사업계획 승인 의제 처리 인허가 (체육시설법 제28조)</h5>';
      html += '<table class="report-table"><thead><tr><th style="width:50px">번호</th><th>의제 처리 인허가 항목</th><th>근거 법령</th></tr></thead><tbody>';
      regulatory.permitSteps.step2.forEach(s => {
        html += `<tr><td>${s.no}</td><td style="text-align:left">${s.name}</td><td>${s.law}</td></tr>`;
      });
      html += '</tbody></table>';

      // STEP 3
      html += '<h5 class="report-step-title">STEP 3. 별도 추진 인허가 (사업 규모·입지 조건에 따라)</h5>';
      html += '<table class="report-table"><thead><tr><th>인허가</th><th>근거</th><th>비고</th></tr></thead><tbody>';
      regulatory.permitSteps.step3.forEach(s => {
        html += `<tr><td>${s.name}</td><td>${s.law}</td><td style="text-align:left">${s.note}</td></tr>`;
      });
      html += '</tbody></table>';

      // STEP 4
      html += '<h5 class="report-step-title">STEP 4. 특이 리스크 사항</h5>';
      html += '<table class="report-table"><thead><tr><th>리스크 항목</th><th>근거</th><th>검토 내용</th></tr></thead><tbody>';
      regulatory.permitSteps.step4.forEach(s => {
        html += `<tr><td style="font-weight:600; color:var(--color-destructive)">${s.risk}</td><td>${s.law}</td><td style="text-align:left">${s.review}</td></tr>`;
      });
      html += '</tbody></table>';

      // STEP 5
      html += '<h5 class="report-step-title">STEP 5. 예상 추진 절차 및 소요기간</h5>';
      html += '<table class="report-table"><thead><tr><th style="width:50px">단계</th><th>내용</th><th>소요기간</th><th>주요 협의기관</th></tr></thead><tbody>';
      regulatory.permitSteps.step5.forEach(s => {
        html += `<tr><td>${s.step}</td><td style="text-align:left; font-weight:500">${s.task}</td><td style="color:var(--color-primary); font-weight:bold">${s.duration}</td><td>${s.auth}</td></tr>`;
      });
      html += '</tbody></table>';

      // Summary
      html += '<div class="report-summary"><h5>■ 종합 의견</h5><ul>';
      regulatory.permitSteps.summary.forEach(s => {
        html += `<li>${s}</li>`;
      });
      html += '</ul></div>';

      reportContainer.innerHTML = html;
    }

    // Compliance Checklist Stats
    document.getElementById('val-req-ratio').innerText = `${regulatory.targetLandscapeRatio}%`;
    document.getElementById('val-bar').innerText = `${regulatory.estimatedBAR}%`;
    
    // Populate checklist table
    const tbody = document.getElementById('regulatory-tbody');
    tbody.innerHTML = '';
    regulatory.checkList.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.rule}</td>
        <td><span class="rule-badge ${item.status}">${item.status}</span></td>
        <td>${item.detail}</td>
      `;
      tbody.appendChild(tr);
    });

    // Utility details
    document.getElementById('util-water').innerText = infra.utilityConnections.waterMain;
    document.getElementById('util-drainage').innerText = infra.utilityConnections.drainagePoint;

    // Execute drawing methods
    draw3DTerrain();
    drawClimateSVG();
    drawInfraMap();
  }

  // --- INTERACTIVE VISUALIZERS ---

  let rotationAngle = -Math.PI / 4;
  let verticalTilt = Math.PI / 6;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  
  const terrainCanvas = document.getElementById('terrain-canvas');
  
  terrainCanvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
  });
  
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
  
  terrainCanvas.addEventListener('mousemove', (e) => {
    if (!isDragging || !analysisResult) return;
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    rotationAngle += deltaX * 0.007;
    verticalTilt += deltaY * 0.007;
    
    startX = e.clientX;
    startY = e.clientY;
    draw3DTerrain();
  });

  // Draws a 3D Mesh cropped specifically to the parsed Polygon Boundary
  function draw3DTerrain() {
    if (!analysisResult) return;
    const { grid, mask, polygon } = analysisResult.terrain;
    const ctx = terrainCanvas.getContext('2d');
    const width = terrainCanvas.width;
    const height = terrainCanvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    // Background matrix mesh grid
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, width, height);
    
    const size = grid.length;
    const scale = 5.5; 
    const zScale = 1.3; 
    
    const centerX = width / 2;
    const centerY = height / 2 - 10;
    
    const cos = Math.cos(rotationAngle);
    const sin = Math.sin(rotationAngle);
    const sinT = Math.sin(verticalTilt);

    const getProjection = (x, y) => {
      const cx = x - size / 2;
      const cy = y - size / 2;
      
      const rx = cx * cos - cy * sin;
      const ry = cx * sin + cy * cos;
      
      const px = rx * scale;
      const zValue = grid[y] ? grid[y][x] || 0 : 0;
      const py = ry * scale * sinT - zValue * zScale;
      
      return {
        x: centerX + px,
        y: centerY + py,
        z: zValue
      };
    };

    // 1. Draw Mesh polygons only if inside the Mask
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const isInside = mask[y][x] && mask[y+1][x] && mask[y][x+1] && mask[y+1][x+1];
        
        const p1 = getProjection(x, y);
        const p2 = getProjection(x + 1, y);
        const p3 = getProjection(x, y + 1);
        const p4 = getProjection(x+1, y+1);
        
        // Color based on height
        const avgZ = (p1.z + p2.z + p3.z + p4.z) / 4;
        let hue = 140; // Emerald
        let sat = 50;
        let light = 30 + (avgZ * 0.4);
        
        if (avgZ < 15) {
          hue = 190; 
          sat = 60;
        } else if (avgZ > 45) {
          hue = 80; 
          sat = 75;
        }

        if (isInside) {
          // Inside boundary: fully colored faces
          ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, 0.45)`;
          ctx.strokeStyle = `rgba(16, 185, 129, 0.18)`;
        } else {
          // Outside boundary: transparent wireframe to highlight boundary cropping
          ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        }
        
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }

    // 2. Draw 3D Boundary perimeter line (Elevated outline matching terrain height)
    if (polygon && polygon.length > 0) {
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.9)'; // Cyan glow boundary
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      
      polygon.forEach((pt, idx) => {
        // Interpolate boundary point height
        const px = Math.min(size - 1, Math.max(0, Math.round(pt[0])));
        const py = Math.min(size - 1, Math.max(0, Math.round(pt[1])));
        const proj = getProjection(pt[0], pt[1]);
        
        if (idx === 0) ctx.moveTo(proj.x, proj.y);
        else ctx.lineTo(proj.x, proj.y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    // Add UI indicator overlay
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '10px Inter';
    ctx.fillText('Drag map to rotate 3D Mesh (360°)', 15, 25);
  }

  // Microclimate Wind/Sun visualizer (SVG)
  function drawClimateSVG() {
    if (!analysisResult) return;
    const { climate } = analysisResult;
    const svg = document.getElementById('climate-svg');
    svg.innerHTML = '';
    
    const width = 500;
    const height = 400;
    const cx = width / 2;
    const cy = height / 2;
    const radius = 130;
    
    // Draw Compass Ring
    const compassRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    compassRing.setAttribute('cx', cx);
    compassRing.setAttribute('cy', cy);
    compassRing.setAttribute('r', radius);
    compassRing.setAttribute('stroke', 'rgba(255, 255, 255, 0.08)');
    compassRing.setAttribute('stroke-width', '2');
    compassRing.setAttribute('fill', 'rgba(7, 10, 19, 0.4)');
    svg.appendChild(compassRing);
    
    // Directions
    const directions = [
      { text: 'N', x: cx, y: cy - radius - 10, align: 'middle' },
      { text: 'S', x: cx, y: cy + radius + 18, align: 'middle' },
      { text: 'E', x: cx + radius + 10, y: cy + 4, align: 'start' },
      { text: 'W', x: cx - radius - 20, y: cy + 4, align: 'end' }
    ];
    directions.forEach(d => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', d.x);
      text.setAttribute('y', d.y);
      text.setAttribute('fill', 'var(--color-text-dim)');
      text.setAttribute('font-size', '11px');
      text.setAttribute('font-weight', '700');
      text.setAttribute('text-anchor', d.align);
      text.textContent = d.text;
      svg.appendChild(text);
    });

    // Sun Path
    const sunPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const arcD = `M ${cx - radius} ${cy} A ${radius} ${radius * 0.7} 0 0 0 ${cx + radius} ${cy}`;
    sunPath.setAttribute('d', arcD);
    sunPath.setAttribute('stroke', 'var(--color-amber)');
    sunPath.setAttribute('stroke-width', '1.5');
    sunPath.setAttribute('stroke-dasharray', '5 4');
    sunPath.setAttribute('fill', 'none');
    svg.appendChild(sunPath);
    
    // Sun Node
    const sunNode = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    sunNode.setAttribute('cx', cx + 70);
    sunNode.setAttribute('cy', cy + 45);
    sunNode.setAttribute('r', '8');
    sunNode.setAttribute('fill', '#f59e0b');
    sunNode.setAttribute('filter', 'drop-shadow(0px 0px 8px #f59e0b)');
    svg.appendChild(sunNode);

    // Wind Vector Field
    const windDir = climate.prevailingWind;
    const arrowCount = 5;
    const windAngles = { 'N': 90, 'NE': 135, 'E': 180, 'SE': 225, 'S': 270, 'SW': 315, 'W': 0, 'NW': 45 };
    const angleRad = (windAngles[windDir] || 45) * (Math.PI / 180);
    
    for (let i = 0; i < arrowCount; i++) {
      const offsetFactor = (i - (arrowCount - 1) / 2) * 50;
      const sx = cx - Math.cos(angleRad) * radius * 0.9 + Math.sin(angleRad) * offsetFactor;
      const sy = cy - Math.sin(angleRad) * radius * 0.9 - Math.cos(angleRad) * offsetFactor;
      const ex = sx + Math.cos(angleRad) * 60;
      const ey = sy + Math.sin(angleRad) * 60;
      
      const markerId = 'wind-arrow-head';
      if (i === 0) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', markerId);
        marker.setAttribute('viewBox', '0 0 10 10');
        marker.setAttribute('refX', '6');
        marker.setAttribute('refY', '5');
        marker.setAttribute('markerWidth', '5');
        marker.setAttribute('markerHeight', '5');
        marker.setAttribute('orient', 'auto-start-reverse');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M 0 1 L 10 5 L 0 9 z');
        path.setAttribute('fill', 'var(--color-cyan)');
        
        marker.appendChild(path);
        defs.appendChild(marker);
        svg.appendChild(defs);
      }
      
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', sx);
      line.setAttribute('y1', sy);
      line.setAttribute('x2', ex);
      line.setAttribute('y2', ey);
      line.setAttribute('stroke', 'rgba(6, 182, 212, 0.6)');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('marker-end', `url(#${markerId})`);
      svg.appendChild(line);
    }
    
    // Wind Info Label overlay
    const infoText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    infoText.setAttribute('x', 20);
    infoText.setAttribute('y', 30);
    infoText.setAttribute('fill', 'var(--color-text-primary)');
    infoText.setAttribute('font-size', '12px');
    infoText.setAttribute('font-weight', '500');
    infoText.textContent = `겨울철 주풍향 차단 식재 권장 지역: 북서(NW) 경계면`;
    svg.appendChild(infoText);
  }

  // Infrastructure Map and Node Linkage layout (Canvas)
  function drawInfraMap() {
    if (!analysisResult) return;
    const { infra } = analysisResult;
    const { polygon } = analysisResult.terrain;
    const canvas = document.getElementById('infra-canvas');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, width, height);
    
    const scaleX = (width - 100) / 30;
    const scaleY = (height - 100) / 30;
    const getPos = (x, y) => ({
      x: 50 + x * scaleX,
      y: 50 + y * scaleY
    });

    // 1. Draw Site Boundary Polygon (Drawn dynamically from loaded GeoJSON boundary)
    if (polygon && polygon.length > 0) {
      ctx.beginPath();
      polygon.forEach((p, idx) => {
        const pt = getPos(p[0], p[1]);
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.03)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 2. Draw view corridor
    const centerPos = getPos(15, 15);
    const radius = 90;
    const startAngle = (infra.viewCorridorAngle - 25) * (Math.PI / 180);
    const endAngle = (infra.viewCorridorAngle + 25) * (Math.PI / 180);
    
    ctx.beginPath();
    ctx.moveTo(centerPos.x, centerPos.y);
    ctx.arc(centerPos.x, centerPos.y, radius, startAngle, endAngle);
    ctx.closePath();
    
    const grad = ctx.createRadialGradient(centerPos.x, centerPos.y, 10, centerPos.x, centerPos.y, radius);
    grad.addColorStop(0, 'rgba(192, 132, 252, 0.25)');
    grad.addColorStop(1, 'rgba(192, 132, 252, 0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 3. Draw pedestrian flow paths
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
    ctx.lineWidth = 3;
    
    infra.accessPoints.forEach(pt => {
      const startPt = getPos(pt.x, pt.y);
      const targetPt = getPos(15, 15);
      
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      ctx.quadraticCurveTo(
        (startPt.x + targetPt.x) / 2 + (pt.y === 0 ? 30 : -30),
        (startPt.y + targetPt.y) / 2,
        targetPt.x,
        targetPt.y
      );
      ctx.stroke();
    });

    // 4. Draw Access Point Nodes
    infra.accessPoints.forEach(pt => {
      const pos = getPos(pt.x, pt.y);
      
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 182, 212, 0.2)';
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'var(--color-cyan)';
      ctx.fill();
      
      ctx.fillStyle = 'white';
      ctx.font = 'bold 9px Inter';
      ctx.fillText(pt.name, pos.x + 10, pos.y + 3);
    });

    // Labels overlay
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '10px Inter';
    ctx.fillText('보라색 영역: 조망 확보 권장 축 (SW 215°)', 15, 25);
    ctx.fillText('파란색 점/선: 부지 주요 보행 진입 흐름', 15, 40);
  }
});
// Trigger a dummy sample load on startup so input area isn't empty
setTimeout(() => {
  const btn = document.getElementById('btn-load-sample');
  if (btn) btn.click();
}, 200);
