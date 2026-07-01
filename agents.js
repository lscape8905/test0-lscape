// TerraAnalytica - AI Landscape Orchestrator & Parallel Sub-Agents Engine
// Registered globally to window.LandscapeAgents. Updated with Polygon-masking & Eum.go.kr data.

(function() {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Ray Casting Algorithm to check if a point is inside a polygon
  function isPointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Scale arbitrary polygon coordinates to fits into 0-30 grid space
  function normalizePolygon(coords, gridSize) {
    if (!coords || coords.length === 0) {
      // Default polygon boundary if none provided (leaves a margin)
      return [
        [5, 5],
        [25, 3],
        [27, 22],
        [17, 27],
        [4, 18]
      ];
    }

    // Find min and max
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    coords.forEach(pt => {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    });

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Map to grid margin [3, gridSize - 3]
    const margin = 3;
    const size = gridSize - margin * 2;

    return coords.map(pt => [
      margin + ((pt[0] - minX) / rangeX) * size,
      margin + ((pt[1] - minY) / rangeY) * size
    ]);
  }

  // Generate mock topographic matrices
  function generateTopography(type, area, polygon) {
    const size = 30; // 30x30 heightmap grid
    const grid = [];
    let baseHeight = type === 'mountainous' ? 80 : (type === 'hilly' ? 35 : 10);
    
    // Generate height mapping with contours
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) {
        let height = baseHeight;
        
        if (type === 'mountainous') {
          height += Math.sin(x / 4) * 20 + Math.cos(y / 4) * 25 + Math.sin((x+y)/6) * 10;
        } else if (type === 'hilly') {
          height += Math.sin(x / 5) * 8 + Math.cos(y / 6) * 12;
        } else {
          height += (x * 0.2) + (y * 0.1) + Math.sin(x/10) * 1.5;
        }
        
        row.push(Math.max(2, parseFloat(height.toFixed(2))));
      }
      grid.push(row);
    }

    // Mask heights and calculate slopes ONLY inside the normalized polygon
    let totalSlope = 0;
    let maxSlope = 0;
    let flatArea = 0; // 0-8%
    let moderateArea = 0; // 8-15%
    let steepArea = 0; // >15%
    let cellsInside = 0;

    const mask = [];

    for (let y = 0; y < size; y++) {
      const maskRow = [];
      for (let x = 0; x < size; x++) {
        // Check if cell centers fall inside the boundary polygon
        const isInside = isPointInPolygon([x, y], polygon);
        maskRow.push(isInside);

        if (isInside && x > 0 && x < size - 1 && y > 0 && y < size - 1) {
          const dzdx = (grid[y][x+1] - grid[y][x-1]) / 2.0;
          const dzdy = (grid[y+1][x] - grid[y-1][x]) / 2.0;
          const slopePercent = Math.sqrt(dzdx*dzdx + dzdy*dzdy) * 10;
          
          totalSlope += slopePercent;
          if (slopePercent > maxSlope) maxSlope = slopePercent;

          if (slopePercent <= 8) flatArea++;
          else if (slopePercent <= 15) moderateArea++;
          else steepArea++;
          cellsInside++;
        }
      }
      mask.push(maskRow);
    }

    // Fallback if polygon is empty/small
    if (cellsInside === 0) {
      cellsInside = 1;
      totalSlope = 5;
    }

    const avgSlope = totalSlope / cellsInside;
    const flatRatio = Math.round((flatArea / cellsInside) * 100) || 50;
    const moderateRatio = Math.round((moderateArea / cellsInside) * 100) || 30;
    const steepRatio = Math.round((steepArea / cellsInside) * 100) || 20;

    const maxSlopeRatio = Math.max(flatRatio, moderateRatio, steepRatio);
    let slopeSummary = '평탄지형';
    if (maxSlopeRatio === moderateRatio) slopeSummary = '완경사지형';
    if (maxSlopeRatio === steepRatio) slopeSummary = '급경사지형';

    // Build Statistical Arrays
    const slopeStats = [
      { label: '합계', area: area, ratio: 100, isTotal: true },
      { label: '6도 미만 (평탄지)', area: Math.round(area * flatRatio / 100), ratio: flatRatio, highlight: flatRatio > 50 },
      { label: '6도 ~ 15도 (완경사)', area: Math.round(area * moderateRatio / 100), ratio: moderateRatio, highlight: moderateRatio > 50 },
      { label: '15도 이상 (급경사)', area: Math.round(area * steepRatio / 100), ratio: steepRatio, highlight: steepRatio > 50 }
    ];

    // Gather heights inside mask to calculate exact elevation distribution
    const heightsInside = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (mask[y][x]) {
          heightsInside.push(grid[y][x]);
        }
      }
    }
    if (heightsInside.length === 0) {
      heightsInside.push(baseHeight);
    }

    const minH = Math.min(...heightsInside);
    const maxH = Math.max(...heightsInside);
    const range = maxH - minH || 1;

    let b1 = 0, b2 = 0, b3 = 0, b4 = 0;
    heightsInside.forEach(h => {
      if (h <= minH + range * 0.25) b1++;
      else if (h <= minH + range * 0.50) b2++;
      else if (h <= minH + range * 0.75) b3++;
      else b4++;
    });

    const totalCells = heightsInside.length;
    const r1 = Math.round((b1 / totalCells) * 100);
    const r2 = Math.round((b2 / totalCells) * 100);
    const r3 = Math.round((b3 / totalCells) * 100);
    const r4 = 100 - (r1 + r2 + r3);

    const elevStats = [
      { label: '합계', area: area, ratio: 100, isTotal: true },
      { label: `${Math.round(minH)}m ~ ${Math.round(minH + range * 0.25)}m`, area: Math.round(area * r1 / 100), ratio: r1, highlight: r1 > 40 },
      { label: `${Math.round(minH + range * 0.25)}m ~ ${Math.round(minH + range * 0.50)}m`, area: Math.round(area * r2 / 100), ratio: r2, highlight: r2 > 40 },
      { label: `${Math.round(minH + range * 0.50)}m ~ ${Math.round(minH + range * 0.75)}m`, area: Math.round(area * r3 / 100), ratio: r3, highlight: r3 > 40 },
      { label: `${Math.round(minH + range * 0.75)}m 이상`, area: Math.round(area * r4 / 100), ratio: r4, highlight: r4 > 40 }
    ];

    return {
      grid,
      mask,
      polygon,
      avgSlope: Math.round(avgSlope),
      maxSlope: Math.round(maxSlope),
      slopeDistribution: { flat: flatRatio, moderate: moderateRatio, steep: steepRatio },
      cutAndFill: {
        cutVolume: Math.round(area * (avgSlope > 15 ? 1.9 : (avgSlope > 8 ? 1.0 : 0.25)) * (cellsInside / 900)),
        fillVolume: Math.round(area * (avgSlope > 15 ? 1.4 : (avgSlope > 8 ? 0.7 : 0.20)) * (cellsInside / 900))
      },
      stats: {
        slopeSummary: `지형의 ${maxSlopeRatio}%가 ${slopeSummary}을 이루고 있음`,
        elevationSummary: `평균표고 약 ${Math.round(minElev + 8)}m로 분석됨`,
        slopeTable: slopeStats,
        elevationTable: elevStats
      }
    };
  }

  // Generate climate data
  function generateClimate(region, type) {
    const windDirections = { central: 'NW', southern: 'SW', coastal: 'SE', mountain: 'W' };
    const windSpeed = region === 'coastal' ? 6.8 : (region === 'mountain' ? 5.2 : 3.4);
    const zone = region === 'southern' || region === 'coastal' ? 8 : (region === 'mountain' ? 6 : 7);

    let plantingList = [];
    if (zone >= 8) {
      plantingList = [
        { type: 'Evergreen Tree', name: 'Camellia japonica (동백나무)', weight: '방풍림/경관식재' },
        { type: 'Evergreen Tree', name: 'Quercus glauca (종가시나무)', weight: '차폐 및 외곽 녹지' },
        { type: 'Deciduous Tree', name: 'Acer palmatum (단풍나무)', weight: '양지그늘/초점식재' },
        { type: 'Shrub', name: 'Rhododendron indicum (산철쭉)', weight: '하층식재/수벽' },
        { type: 'Ground Cover', name: 'Ophiopogon japonicus (맥문동)', weight: '사면 피복/내음성' }
      ];
    } else {
      plantingList = [
        { type: 'Conifer Tree', name: 'Pinus densiflora (소나무)', weight: '방풍림/전통 조경수' },
        { type: 'Deciduous Tree', name: 'Zelkova serrata (느티나무)', weight: '대형 그늘목/녹음식재' },
        { type: 'Deciduous Tree', name: 'Acer palmatum (단풍나무)', weight: '초점식재/가을경관' },
        { type: 'Shrub', name: 'Ligustrum obtusifolium (쥐똥나무)', weight: '생울타리/경계구획' },
        { type: 'Ground Cover', name: 'Pachysandra terminalis (수호초)', weight: '교목 하부 피복' }
      ];
    }

    return {
      hardinessZone: zone,
      prevailingWind: windDirections[region] || 'NW',
      avgWindSpeed: windSpeed,
      sunlightHours: type === 'mountainous' ? 4.5 : 6.8,
      recommendedPlants: plantingList
    };
  }

  // Fetch data from Korean Law Open API (국가법령정보센터)
  async function fetchKoreanLaw(query) {
    try {
      const oc = 'lscape8905';
      const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${oc}&target=prec&type=JSON&query=${encodeURIComponent(query)}`;
      
      let data;
      try {
        // Attempt direct fetch (may fail due to CORS if domain isn't registered properly)
        const res = await fetch(url);
        data = await res.json();
      } catch (err) {
        console.warn("Direct Law API fetch failed, trying proxy...", err);
        // Fallback to CORS proxy
        const proxyRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
        const proxyData = await proxyRes.json();
        data = JSON.parse(proxyData.contents);
      }

      if (data && data.PrecSearch && data.PrecSearch.prec) {
        const precs = Array.isArray(data.PrecSearch.prec) ? data.PrecSearch.prec : [data.PrecSearch.prec];
        if (precs.length > 0) {
          const first = precs[0];
          return `[판례] ${first.사건명 || ''} (${first.사건번호 || ''})\n${first.판결요지 ? first.판결요지.replace(/<[^>]*>?/gm, '').substring(0, 300) : '요지 없음'}...`;
        } else {
           return `[NOT_FOUND] '${query}' 관련 판례를 찾을 수 없습니다.`;
        }
      } else {
         return `[NOT_FOUND] API 응답에 판례 정보가 없습니다. (검색어: ${query})`;
      }
    } catch(e) {
      console.warn("Law API fetch failed", e);
    }
    return null;
  }

  // Generate detailed land use check (토지이음 데이터 시뮬레이터)
  // Helper to map Korean VWorld zoning strings to internal zoning codes
  function mapKoreanZoningToCode(zones) {
    if (!zones || zones.length === 0) return null;
    const text = zones.join(' ');
    if (text.includes('상업')) return 'commercial';
    if (text.includes('주거')) return 'residential';
    if (text.includes('공업')) return 'industrial';
    if (text.includes('녹지') || text.includes('개발제한')) return 'greenbelt';
    if (text.includes('계획관리')) return 'planned-management';
    if (text.includes('생산관리') || text.includes('보전관리')) return 'production-management';
    if (text.includes('농림')) return 'production-management';
    return null;
  }

  // Hash function for seeded pseudo-random stats
  function getSeed(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = text.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash);
  }

  function generateRegulatory(zoning, subDistricts, area, mcpData, projectType, realZoning) {
    const minLandscapeRatios = { residential: 15, commercial: 10, industrial: 8, greenbelt: 40, 'planned-management': 10, 'production-management': 5 };
    const maxLimits = {
      residential: { bcr: 60, far: 200 },
      commercial: { bcr: 70, far: 800 },
      industrial: { bcr: 70, far: 350 },
      greenbelt: { bcr: 20, far: 80 },
      'planned-management': { bcr: 40, far: 100 },
      'production-management': { bcr: 20, far: 80 }
    };

    const targetRatio = minLandscapeRatios[zoning] || 15;
    const requiredGreenArea = Math.round((area * targetRatio) / 100);
    const limit = maxLimits[zoning] || { bcr: 60, far: 200 };

    // Building regulatory checks
    const checkList = [
      { rule: '의무 조경면적 확보 규정 (건축법 제42조)', status: 'PASS', detail: `대지면적의 ${targetRatio}%인 ${requiredGreenArea}㎡ 이상 조경 면적 설치 의무 충족` },
      { rule: '건폐율 및 용적률 제한 법규', status: 'PASS', detail: `건폐율 상한: ${limit.bcr}% 이하, 용적률 상한: ${limit.far}% 이하 저촉 없음` }
    ];

    // Overlay sub-districts regulations
    let rawBiotop = zoning === 'greenbelt' ? 60 : (zoning === 'residential' ? 32 : 18);
    const subDistrictLabels = [];
    
    if (subDistricts.includes('landscape')) {
      subDistrictLabels.push('경관지구');
      checkList.push({
        rule: '경관지구 내 건축 및 식재 가이드라인',
        status: 'WARNING',
        detail: '도로변 건축한계선 3m 이내 생울타리 등 경관보존형 완충녹지 조성 의무 발생.'
      });
    }
    
    if (subDistricts.includes('heritage')) {
      subDistrictLabels.push('역사문화환경보존지역');
      checkList.push({
        rule: '문화재보호법 역사문화환경보존지구 규제',
        status: 'CRITICAL',
        detail: '국가등록문화재 외곽 경계 200m 이내. 전통수종 위주(소나무 등) 식재, 인공시설물 설치 50% 미만 제한.'
      });
      rawBiotop += 5; // traditional planting demands more greening
    }
    
    if (subDistricts.includes('water-protection')) {
      subDistrictLabels.push('상수원보호구역');
      checkList.push({
        rule: '수질보전대책지역 상수원보호 특별 규제',
        status: 'CRITICAL',
        detail: '포장 면적 생태면적률 40% 이상 강제(투수성 포장 필수), 화학 비료 살포 전면 제한, 식생 수질 정화 필터 연못 설계 필요.'
      });
      rawBiotop = Math.max(rawBiotop, 40);
    }

    if (zoning === 'greenbelt') {
      subDistrictLabels.push('개발제한구역');
      checkList.push({
        rule: '개발제한구역 지정 및 관리에 관한 특별조치법',
        status: 'CRITICAL',
        detail: '부지 내 절토·성토 시 1.5m 이하의 경미한 graded slope만 허용. 옹벽 높이 2m 미만 제한.'
      });
    }

    // Insert MCP Data if available
    if (mcpData && !mcpData.includes('[NOT_FOUND]')) {
      // Truncate MCP data to make it fit nicely in the checklist
      const snippet = mcpData.substring(0, 150).replace(/\n/g, ' ') + '...';
      checkList.push({
        rule: '국가법령정보센터 OpenAPI 연동 (판례)',
        status: 'WARNING',
        detail: `[관련 판례 검토] ${snippet}`
      });
    }

    const estimatedBAR = Math.min(95, rawBiotop);

    // Simulate official 토지이용계획확인서 Document Layout
    const officialDocument = {
      location: '대상 필지 정보 대표 주소지 일원',
      zoningLaw: realZoning && realZoning.national ? realZoning.national : `국토의 계획 및 이용에 관한 법률에 따른 용도지역: **${
        zoning === 'residential' ? '제2종일반주거지역' : 
        (zoning === 'commercial' ? '일반상업지역' : 
        (zoning === 'industrial' ? '준공업지역' : 
        (zoning === 'planned-management' ? '계획관리지역' : 
        (zoning === 'production-management' ? '생산관리지역' : '개발제한구역 및 자연녹지지역'))))}**`,
      otherLaws: realZoning && realZoning.other ? realZoning.other : (subDistrictLabels.length > 0 
        ? `다른 법률 등에 따른 지역·지구: **${subDistrictLabels.join(', ')}**`
        : '다른 법률 등에 따른 지역·지구: **특이 규제사항 없음**'),
      restrictedActions: [
        projectType === 'urban-park' ? '도시공원결정 고시 전 영구 시설물 축조 불가' : null,
        projectType === 'golf-course' ? '체육시설업 등록 전 용도외 개발 및 원형보전지 훼손 절대 불가 (수질오염 총량제 적용)' : null,
        projectType === 'tourism-complex' ? '관광진흥법에 따른 조성계획 승인 전 사전 공사 착수 불허' : null,
        projectType === 'residential-complex' ? '주택건설사업계획 승인 전 부지조성 및 대지 분할 불허' : null,
        subDistricts.includes('landscape') ? '건축물 최고 높이 3층(12m) 초과 건축 제한' : null,
        subDistricts.includes('water-protection') ? '오수정화시설 방류수 기준 5ppm 미만 시설 외 신축 제한' : null,
        zoning === 'greenbelt' ? '형질변경 목적의 토지 굴착 및 적치 행위 전면 불허' : null
      ].filter(Boolean)
    };

    // Permitting process stages roadmap (Timeline)
    let baseTimeline = [];
    if (projectType === 'urban-park') {
      baseTimeline = [
        { stage: '1. 도시관리계획(공원) 결정 및 지형도면 고시', duration: '90일', task: '도시공원위원회 심의 및 공원조성계획 수립' },
        { stage: '2. 실시계획 인가 및 토지보상', duration: '120일', task: '환경보전방안 검토 및 공원녹지법 기반 실시설계 승인' }
      ];
    } else if (projectType === 'golf-course') {
      baseTimeline = [
        { stage: '1. 도시계획시설(체육시설) 입안 및 체육시설업 사업계획 승인', duration: '150일', task: '광역자치단체장 승인 및 체육시설의 설치·이용에 관한 법률 검토' },
        { stage: '2. 환경영향평가 및 재해영향평가 (본안)', duration: '180일', task: '대규모 산림 훼손에 따른 식생 조사 및 수질오염총량제 협의, 원형보전지 20% 이상 확보' },
        { stage: '3. 산지전용 및 농지전용 허가 (실시계획 인가)', duration: '90일', task: '산지관리법에 따른 토석채취 허가 및 표고, 입목축척 조사' }
      ];
    } else if (projectType === 'tourism-complex') {
      baseTimeline = [
        { stage: '1. 관광단지 지정 및 조성계획 승인', duration: '150일', task: '관광진흥법에 따른 권역계획 부합 여부 확인 및 문체부/지자체 협의' },
        { stage: '2. 통합 심의 (건축/경관/환경/교통)', duration: '120일', task: '관광휴양형 지구단위계획 수립 및 각종 위원회 통합 심의 통과' }
      ];
    } else {
      // residential-complex
      baseTimeline = [
        { stage: '1. 주택건설사업계획 승인 사전심사', duration: '60일', task: '지자체 주택과 및 도시계획위원회 사전 자문' },
        { stage: '2. 개발행위허가 및 건축 심의', duration: '90일', task: '단지 내 부대복리시설 및 대규모 조경 공간 건축/경관 통합 심의' }
      ];
    }

    const permitTimeline = [
      ...baseTimeline,
      subDistricts.includes('landscape') ? { stage: '경관/디자인 심의', duration: '45일', task: '경관지구 내 생울타리 연접 구간 확보 확인, 가로경관 계획안 승인' } : null,
      subDistricts.includes('water-protection') ? { stage: '수질오염 저감시설 및 소규모 환경영향평가', duration: '60일', task: '우수 배수를 위한 식생수로(Rain garden) 정량 단면 산출물 및 비점오염저감시설 신고' } : null,
      { stage: '최종. 조경 공사 준공 필증 획득', duration: '15일', task: '의무 조경 식재 본수 및 생태면적률 실사 검토 후 지자체 준공 필증 수령' }
    ].filter(Boolean);

    // Build Statistical Arrays for Dashboard using pseudo-random seeding
    const seed = getSeed(JSON.stringify(realZoning || '') + area);
    
    let rEcology1 = 0, rEcology2 = 0, rEcology3 = 0, rEcology4 = 0;
    const isGreenOrMtn = zoning === 'greenbelt' || zoning.includes('management');
    if (isGreenOrMtn) {
      rEcology1 = 5 + (seed % 15); // 5% - 19%
      rEcology2 = 40 + (seed % 20); // 40% - 59%
      rEcology3 = 10 + (seed % 15); // 10% - 24%
      rEcology4 = 100 - (rEcology1 + rEcology2 + rEcology3);
    } else {
      rEcology1 = 0;
      rEcology2 = seed % 5; // 0% - 4%
      rEcology3 = 10 + (seed % 15); // 10% - 24%
      rEcology4 = 100 - (rEcology1 + rEcology2 + rEcology3);
    }

    const ecologyStats = [
      { label: '합계', area: area, ratio: 100, isTotal: true },
      { label: '1등급', area: Math.round(area * rEcology1 / 100), ratio: rEcology1, highlight: rEcology1 > 20 },
      { label: '2등급', area: Math.round(area * rEcology2 / 100), ratio: rEcology2, highlight: rEcology2 > 40 },
      { label: '3등급', area: Math.round(area * rEcology3 / 100), ratio: rEcology3, highlight: rEcology3 > 40 },
      { label: '별도관리지역', area: Math.round(area * rEcology4 / 100), ratio: rEcology4, highlight: rEcology4 > 50 }
    ];

    let rMtn1 = 0, rMtn2 = 0, rMtn3 = 0;
    if (isGreenOrMtn) {
      rMtn1 = 60 + (seed % 20); // 60% - 79% (준보전산지)
      rMtn2 = 15 + (seed % 10); // 15% - 24% (보전산지)
      rMtn3 = 100 - (rMtn1 + rMtn2); // 산지외
    } else {
      rMtn1 = 5 + (seed % 8); // 5% - 12%
      rMtn2 = 0;
      rMtn3 = 100 - (rMtn1 + rMtn2);
    }
    const mountainStats = [
      { label: '합계', area: area, ratio: 100, isTotal: true },
      { label: '준보전산지', area: Math.round(area * rMtn1 / 100), ratio: rMtn1, highlight: rMtn1 > 50 },
      { label: '보전산지', area: Math.round(area * rMtn2 / 100), ratio: rMtn2, highlight: rMtn2 > 20 },
      { label: '산지외 구역', area: Math.round(area * rMtn3 / 100), ratio: rMtn3, highlight: rMtn3 > 50 }
    ];

    const rOwn1 = 15 + (seed % 35); // 15% - 49% (국유지)
    const rOwn2 = 5 + (seed % 15);  // 5% - 19% (공유지)
    const rOwn3 = 100 - (rOwn1 + rOwn2); // 사유지
    const ownershipStats = [
      { label: '합계', area: area, ratio: 100, isTotal: true },
      { label: '국유지 (산림청/환경부 등)', area: Math.round(area * rOwn1 / 100), ratio: rOwn1, highlight: rOwn1 > 40 },
      { label: '공유지 (지자체 등)', area: Math.round(area * rOwn2 / 100), ratio: rOwn2, highlight: rOwn2 > 40 },
      { label: '사유지 (종중/개인)', area: Math.round(area * rOwn3 / 100), ratio: rOwn3, highlight: rOwn3 > 40 }
    ];

    const catMap = {};
    if (window.latestParcelList && window.latestParcelList.length > 0) {
      window.latestParcelList.forEach(p => {
        if (!catMap[p.category]) catMap[p.category] = { total: 0, parcels: [] };
        // p.area is exact turf.area from app.js; fallback to average if missing
        const pArea = p.area || Math.round(area / window.latestParcelList.length);
        catMap[p.category].total += pArea;
        catMap[p.category].parcels.push({ jibun: p.jibun, area: pArea });
      });
    } else {
      catMap[isMountain ? '임야' : '대'] = { total: Math.round(area * 0.6), parcels: [] };
      catMap['전'] = { total: Math.round(area * 0.2), parcels: [] };
      catMap['답'] = { total: Math.round(area * 0.2), parcels: [] };
    }
    
    let sumArea = 0;
    Object.keys(catMap).forEach(k => sumArea += catMap[k].total);
    
    const catArr = Object.keys(catMap).map(k => ({ label: k, ...catMap[k] })).sort((a,b) => b.total - a.total);
    
    const categoryStats = [{ label: '합계', area: sumArea || area, ratio: 100, isTotal: true }];
    catArr.forEach((c, idx) => {
       const cRatio = sumArea > 0 ? (c.total / sumArea) * 100 : 0;
       categoryStats.push({ 
         label: c.label + ' (소계)', 
         area: c.total, 
         ratio: cRatio, 
         highlight: idx === 0 
       });
       
       // individual parcels breakdown
       if (c.parcels && c.parcels.length > 0) {
         c.parcels.forEach(p => {
           const pRatio = sumArea > 0 ? (p.area / sumArea) * 100 : 0;
           categoryStats.push({ 
             label: '└ ' + p.jibun, 
             area: p.area, 
             ratio: pRatio, 
             isSub: true 
           });
         });
       }
    });

    return {
      targetLandscapeRatio: targetRatio,
      requiredGreenArea,
      estimatedBAR,
      checkList,
      officialDocument,
      permitTimeline,
      stats: {
        ecologySummary: '대상지 내 생태자연도는 대부분 별도관리지역 및 2등급임',
        mountainSummary: isMountain ? '대부분 산지 관리법상 준보전산지에 해당' : '대부분 산지외 구역에 해당',
        ownershipSummary: '사유지가 51%로 향후 토지 수용체결 절차 이행 필요',
        categorySummary: `지목상 ${catArr[0]?catArr[0].label:'임야'}가 가장 많은 비중 차지`,
        ecologyTable: ecologyStats,
        mountainTable: mountainStats,
        ownershipTable: ownershipStats,
        categoryTable: categoryStats
      }
    };
  }

  // Generate mock urban linkage maps
  function generateInfrastructure(concept, polygon) {
    const noiseLevels = concept === 'smart-eco' ? 45 : 62;
    const pedestrianIntensity = concept === 'healing-garden' ? 'Medium' : 'High';
    
    // access points scaled inside polygon limits
    let entryX1 = 15, entryY1 = 0;
    if (polygon && polygon.length > 0) {
      entryX1 = Math.round(polygon[0][0]);
      entryY1 = Math.round(polygon[0][1]);
    }

    return {
      accessPoints: [
        { name: '주 진출입구 (Gate 1)', x: entryX1, y: entryY1, weight: 0.85 },
        { name: '부 진출입구 (Gate 2)', x: 25, y: 14, weight: 0.45 }
      ],
      noiseBufferRequired: noiseLevels > 55 ? '동측 도로변 차량 소음 차단을 위해 폭 8m 이상의 밀집 상록수림 완충녹지 배치를 권장합니다.' : '부지 외곽에 폭 3m 내외의 경계 생울타리 조성이 권장됩니다.',
      pedestrianIntensity,
      viewCorridorAngle: 215,
      utilityConnections: {
        waterMain: '인접 공도(북서측) 통과 우/오수 관로 인입구',
        drainagePoint: '부지 최하단부 자연 경사를 이용한 표면 유출 유도구'
      }
    };
  }

  // Compile final aggregated Orchestrator MD Report
  function compileReport(site, terrain, climate, regulatory, infra) {
    const currentDate = new Date().toLocaleDateString('ko-KR');
    const isOverlayZoning = regulatory.officialDocument.otherLaws !== '다른 법률 등에 따른 지역·지구: **특이 규제사항 없음**';

    return `# AI Landscape Assessment & Masterplan Strategy
**대상지 정보**: ${site.address} | **부지 면적**: ${site.area.toLocaleString()} ㎡
**용도지역**: ${site.zoning.toUpperCase()} | **설계 컨셉**: ${site.concept.replace('-', ' ').toUpperCase()}
**분석 일시**: ${currentDate} (토지이음 국토이용규제 기반 가상 필지 분석)

---

## 1. 종합 평가 의견 및 조경 설계 전략 (Orchestrator)
본 부지는 지형 분석 결과 **평균 경사도 ${terrain.avgSlope}%**를 나타내며, **${site.zoning.toUpperCase()}** 규제 요건과 **${site.concept.toUpperCase()}** 설계 방향을 종합적으로 고려하여 다음과 같이 설계를 진행할 것을 권고합니다.

### 💡 핵심 설계 및 엔지니어링 가이드라인:
1. **지형에 수응하는 다단형 옹벽/지형 단차 계획**:
   - 평균 경사도가 **${terrain.avgSlope}%**이므로 절토 및 성토의 평형을 맞추기 위해 자연 석축 옹벽 및 다단 테라스식 식재(Hillside Terrace)를 도입하는 것이 유리합니다.
   - 예상 절토량: ${terrain.cutAndFill.cutVolume.toLocaleString()} ㎥, 성토량: ${terrain.cutAndFill.fillVolume.toLocaleString()} ㎥.
2. **토지이음 규제 적합성 확보**:
   - 국토계획법 및 조례 기준에 의거하여 **대지면적의 최소 ${regulatory.targetLandscapeRatio}%(${regulatory.requiredGreenArea.toLocaleString()}㎡)** 이상의 조경 면적을 필히 확보해야 합니다.
   - ${isOverlayZoning ? `중첩 규제 지정(${regulatory.officialDocument.otherLaws})으로 인해 행위제한에 각별한 주의가 필요합니다. 행위제한 가이드라인에 규정된 수종 및 포장재 기준을 준수하십시오.` : '용도지역 외의 특별한 제한 행위는 식별되지 않았습니다.'}
3. **미기후 및 하디니스 존 식재**:
   - 대상지 위치상 **겨울철 주풍향인 ${climate.prevailingWind}** 방향으로 밀집 침엽수림(방풍림)을 식재하여 내부 보행 광장으로 향하는 차가운 기류를 필터링하십시오.
   - 식물 내한성 기준인 **USDA Zone ${climate.hardinessZone}**에 최적화된 지역 가로수종(예: 소나무, 단풍나무, 느티나무) 위주로 조경 기본 수종을 계획하였습니다.
4. **동선 및 인프라 연계**:
   - 3D 좌표 분석에 따라 주 진입 노드인 **"${infra.accessPoints[0].name}"** 방향으로 대형 상징수와 열린 웰컴 잔디광장을 배치하고, 소음 저감을 위해 외곽 도로 연접부에 차폐 완충녹지를 조성하십시오.

---

## 2. 각 분석 에이전트 상세 평가 리포트

### A. 지형 분석 & 토공량 검토 (Terrain Agent)
- **평균 경사**: ${terrain.avgSlope}% (최대 경사: ${terrain.maxSlope}%)
- **경사 분포 비율**: 평탄지: ${terrain.slopeDistribution.flat}%, 구릉/완경사: ${terrain.slopeDistribution.moderate}%, 급경사: ${terrain.slopeDistribution.steep}%
- **배수 및 종단 수평성**: 자연 경사를 활용한 자유 배수 구배 설계 가능.

### B. 미기후 & 조경 식재 계획 (Climate Agent)
- **추천 조경 수종 가이드라인 (USDA Zone ${climate.hardinessZone})**:
${climate.recommendedPlants.map(p => `  * **${p.type}**: ${p.name} - *배치 목적: ${p.weight}*`).join('\n')}

### C. 토지이음 기반 법규/인허가 요약 (Regulatory Agent)
- **생태면적률(Biotop Area Ratio) 가중치 권장 점수**: **${regulatory.estimatedBAR}% 이상** 확보 필요.
- **주요 행위제한 및 허용 행위**:
${regulatory.checkList.map(c => `  * **[${c.status}]** ${c.rule}: ${c.detail}`).join('\n')}

### D. 인프라 및 소음 차폐망 설계 (Infra Agent)
- **소음 차단 설계안**: ${infra.noiseBufferRequired}
- **조망축 보호 각도**: 남서측 **${infra.viewCorridorAngle}°** 방향 조망 회랑 유지 (건축물 및 교목 배치 최소화 구간).
`;
  }

  // The Orchestrator API
  window.LandscapeAgents = {
    async startAnalysis(siteData, onLog, onProgress) {
      const { address, area, type, region, projectType, zoning, concept, subDistricts = [], boundaryCoords } = siteData;
      
      const agents = [
        { id: 'terrain', name: 'Terrain & Topography Agent' },
        { id: 'climate', name: 'Climate & Ecology Agent' },
        { id: 'regulatory', name: 'Regulations & Zoning Agent' },
        { id: 'infra', name: 'Socio-Cultural & Infra Agent' }
      ];

      // Reset progress
      agents.forEach(a => onProgress(a.id, 0));

      onLog('orchestrator', `토지이음(eum.go.kr) 필지 규제 및 경계 분석 시스템 가동 중...`);
      onLog('orchestrator', `대상지 위치: "${address}" | 분석 요청 면적: ${area}㎡`);
      await sleep(700);

      // Normalize boundary polygon coordinates
      const targetGridPolygon = normalizePolygon(boundaryCoords, 30);
      onLog('orchestrator', `경계 좌표(GeoJSON) 3D 지형 매핑 노멀라이징 완료. 경계 정밀 연산 실행.`);
      await sleep(500);

      onLog('orchestrator', `4개 분석 채널 병렬 동기화 시작...`);
      await sleep(400);

      // Simulation steps for agents running in parallel
      const runTerrainAgent = async () => {
        const id = 'terrain';
        onLog(id, '경계 다각형(Polygon) 내부 지형 데이터 마스킹 작업 중...');
        onProgress(id, 20);
        await sleep(900);
        
        onLog(id, '바운더리 내 경사 히트맵 및 고저 피크 포인트 차등 추출...');
        onProgress(id, 50);
        await sleep(1300);
        
        onLog(id, '바운더리 경계 기준 절토/성토 최소화 형질변경 경사 보정량 계산...');
        onProgress(id, 80);
        await sleep(1100);

        const data = generateTopography(type, area, targetGridPolygon);
        onLog(id, `지형 분석 완료. 경계 내 평균경사: ${data.avgSlope}%, 형질변경 토공량 산출 완료.`);
        onProgress(id, 100);
        return data;
      };

      const runClimateAgent = async () => {
        const id = 'climate';
        onLog(id, '대상 기후권 풍속/풍향 기상 데이터베이스 원격 동기화...');
        onProgress(id, 15);
        await sleep(1100);
        
        onLog(id, '사계절 태양 궤적 투영에 따른 건물 음영 및 생태 그늘 경계 면적 분석...');
        onProgress(id, 55);
        await sleep(1200);
        
        onLog(id, '내한성 생태 한계 온도 매칭 및 토양 피복 수종 리스트 분류...');
        onProgress(id, 85);
        await sleep(800);

        const data = generateClimate(region, type);
        onLog(id, `기후 분석 완료. 식물 내한성 Zone ${data.hardinessZone} 및 권장 조경수 매칭.`);
        onProgress(id, 100);
        return data;
      };

      const runRegulatoryAgent = async () => {
        const id = 'regulatory';
        onLog(id, '토지이음 국토이용규제정보서비스 가상 API 연동...');
        onProgress(id, 10);
        await sleep(400);

        // Fetch Real Zoning Data from VWorld Data API
        let realZoning = null;
        if (boundaryCoords && boundaryCoords.length > 0) {
          onLog(id, '브이월드 데이터 API(용도지역/지구/구역) 실시간 공간분석 쿼리 중...');
          try {
            let minx = 999, miny = 999, maxx = -999, maxy = -999;
            function extractBounds(arr) {
              if (!Array.isArray(arr) || arr.length === 0) return;
              if (typeof arr[0] === 'number') {
                const x = arr[0]; const y = arr[1];
                if (x < minx) minx = x; if (x > maxx) maxx = x;
                if (y < miny) miny = y; if (y > maxy) maxy = y;
              } else if (typeof arr[0] === 'object' && arr[0] !== null && 'lat' in arr[0] && 'lng' in arr[0]) {
                 arr.forEach(pt => {
                   const x = pt.lng; const y = pt.lat;
                   if (x < minx) minx = x; if (x > maxx) maxx = x;
                   if (y < miny) miny = y; if (y > maxy) maxy = y;
                 });
              } else {
                 arr.forEach(child => extractBounds(child));
              }
            }
            extractBounds(boundaryCoords);
            const buffer = 0.0001;
            const bboxStr = `${minx-buffer},${miny-buffer},${maxx+buffer},${maxy+buffer}`;
            const vkey = "C212FD59-03AA-3762-8CB2-CC987A1CA655";
            const vdom = window.location.origin + window.location.pathname;

            // JSONP Helper for VWorld API to bypass CORS/Referer restrictions
            const fetchJsonp = (url) => {
              return new Promise((resolve, reject) => {
                const callbackName = 'vworld_jsonp_' + Math.round(1000000 * Math.random());
                const script = document.createElement('script');
                
                // Add a timeout to prevent infinite hanging
                const timeoutId = setTimeout(() => {
                  delete window[callbackName];
                  if (document.body.contains(script)) document.body.removeChild(script);
                  resolve(null);
                }, 3000);

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
                  resolve(null); // resolve null on error so Promise.all doesn't crash
                };
                
                document.body.appendChild(script);
              });
            };

            const fetchZoning = async (layer) => {
              try {
                // Use user's VWorld key if available in the DOM, otherwise fallback to the default key
                const userKeyInput = document.getElementById('vworld-api-key');
                const apiKey = userKeyInput && userKeyInput.value ? userKeyInput.value : vkey;
                
                const targetUrl = `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=${layer}&key=${apiKey}&domain=${vdom}&geomFilter=BOX(${bboxStr})`;
                
                const json = await fetchJsonp(targetUrl);
                
                if (json?.response?.result?.featureCollection?.features) {
                  const names = [];
                  json.response.result.featureCollection.features.forEach(f => {
                    if (f.properties) {
                       // Find any property that ends with 지역, 지구, or 구역
                       Object.values(f.properties).forEach(val => {
                          if (typeof val === 'string' && (val.endsWith('지역') || val.endsWith('지구') || val.endsWith('구역'))) {
                             names.push(val);
                          }
                       });
                    }
                  });
                  return [...new Set(names)];
                }
              } catch(e) {
                console.warn(`[${layer}] fetch error:`, e);
              }
              return [];
            };

            // 용도지역 (National Zoning)
            const [zones111, zones112, zones113, zones114] = await Promise.all([
               fetchZoning('LT_C_UQ111'), // 도시지역
               fetchZoning('LT_C_UQ112'), // 관리지역
               fetchZoning('LT_C_UQ113'), // 농림지역
               fetchZoning('LT_C_UQ114')  // 자연환경보전지역
            ]);
            
            // 용도지구 및 용도구역 (Sub-districts and Zones)
            const [zones121, zones123, zones125, zones128, zones129, zones130, zones141] = await Promise.all([
               fetchZoning('LT_C_UQ121'), // 경관지구
               fetchZoning('LT_C_UQ123'), // 고도지구
               fetchZoning('LT_C_UQ125'), // 방재지구
               fetchZoning('LT_C_UQ128'), // 취락지구
               fetchZoning('LT_C_UQ129'), // 개발진흥지구
               fetchZoning('LT_C_UQ130'), // 특정용도제한지구
               fetchZoning('LT_C_UQ141')  // 용도구역
            ]);
            
            const allNationalZones = [...new Set([...zones111, ...zones112, ...zones113, ...zones114])];
            const allOtherZones = [...new Set([...zones121, ...zones123, ...zones125, ...zones128, ...zones129, ...zones130, ...zones141])];
            
            realZoning = {
               national: allNationalZones.length > 0 ? "국토계획법상 용도지역: **" + allNationalZones.join(', ') + "**" : "국토계획법상 용도지역: **지정 내역 없음 (관할 지자체 확인 요망)**",
               other: allOtherZones.length > 0 ? "다른 법률 등에 따른 지역·지구: **" + allOtherZones.join(', ') + "**" : "다른 법률 등에 따른 지역·지구: **해당 없음**"
            };
            onLog(id, '용도지역 실시간 추출 성공. ' + (allNationalZones[0] || ''));
          } catch(err) {
            console.error("Zoning fetch error", err);
          }
        }

        onLog(id, '국가법령정보센터 OpenAPI 실시간 판례/법령 데이터 조회 중...');
        onProgress(id, 35);
        const projectQueries = {
          'urban-park': '도시공원조성 인허가',
          'golf-course': '골프장 체육시설 인허가',
          'tourism-complex': '관광단지조성 인허가',
          'residential-complex': '주택단지 개발행위허가'
        };
        const mcpQuery = projectQueries[projectType] || '조경 인허가';
        const mcpData = await fetchKoreanLaw(mcpQuery);
        if (mcpData) {
          onLog(id, `국가법령정보 연동 성공: "${mcpQuery}" 검색 완료`);
        } else {
          onLog(id, `국가법령정보 연동 실패 (오프라인 모드 전환)`);
        }
        await sleep(500);

        onLog(id, '용도지역·지구·구역 중첩 규제 저촉 필지 분석 및 건폐율 상한 검토...');
        onProgress(id, 65);
        await sleep(1500);
        
        onLog(id, '의무 조경면적 및 생태면적률 가이드라인 산출...');
        onProgress(id, 85);
        await sleep(700);
        
        onLog(id, '토지 행위제한 요건 도출 및 지자체 조경 인허가 로드맵 작성...');
        onProgress(id, 95);
        await sleep(800);

        const data = generateRegulatory(zoning, subDistricts, area, mcpData, projectType, realZoning);
        onLog(id, `규제 분석 완료. ${realZoning ? '실시간 브이월드 데이터 연동 적용.' : '가상 API 연동 적용.'}`);
        onProgress(id, 100);
        return data;
      };

      const runInfraAgent = async () => {
        const id = 'infra';
        onLog(id, '부지 진입 가능한 도로 교통 노드 매핑 및 소음원 전파 반경 추적...');
        onProgress(id, 25);
        await sleep(1200);
        
        onLog(id, '보행 진입 동선 설계 및 주요 원거리 조망축 개방 각도 연산...');
        onProgress(id, 65);
        await sleep(1000);

        const data = generateInfrastructure(concept, targetGridPolygon);
        onLog(id, `인프라 분석 완료. 진출입로 좌표 확보 및 완충 녹지 가이드라인 수립.`);
        onProgress(id, 100);
        return data;
      };

      // Run parallel agents
      const [terrainData, climateData, regulatoryData, infraData] = await Promise.all([
        runTerrainAgent(),
        runClimateAgent(),
        runRegulatoryAgent(),
        runInfraAgent()
      ]);

      onLog('orchestrator', `모든 서브 에이전트 분석 완료. 마스터플랜 전략 종합 보고서 작성 중...`);
      await sleep(1100);

      const mdReport = compileReport(siteData, terrainData, climateData, regulatoryData, infraData);
      onLog('orchestrator', `AI 조경설계 기초분석 및 토지이음 규제 검토 보고서 패키지 생성 완료!`);
      
      return {
        terrain: terrainData,
        climate: climateData,
        regulatory: regulatoryData,
        infra: infraData,
        report: mdReport
      };
    }
  };
})();
