const norm = value => String(value || '').normalize('NFKC').replace(/[\s·ㆍ()\[\]{}.,_-]/g, '').toLocaleLowerCase('ko-KR');

export function verifiedCombinedKBTypes(masterRow, kbComplexes) {
  if (!masterRow || !Array.isArray(kbComplexes) || !kbComplexes.length) return false;
  const masterAreas = (masterRow['면적별'] || []).filter(area => area['상태'] === 'confirmed');
  const kbAreas = kbComplexes.flatMap(complex => complex.areas || []);
  if (!kbAreas.length || kbAreas.reduce((sum, area) => sum + Number(area.households || 0), 0) !== Number(masterRow['세대수'])) return false;
  return kbComplexes.every(complex =>
    norm(complex.city) === norm(masterRow['시']) &&
    norm(complex.district).replace(/시/g, '') === norm(masterRow['구']).replace(/시/g, '') &&
    norm(complex.dong) === norm(masterRow['법정동']) &&
    (complex.areas || []).length > 0 &&
    (complex.areas || []).every(area => masterAreas.some(masterArea =>
      Math.abs(Number(masterArea['전용면적']) - Number(area.exclusiveM2)) <= 0.02 &&
      Math.abs(Number(masterArea['공급면적']) - Number(area.supplyM2)) <= 0.02))
  );
}
