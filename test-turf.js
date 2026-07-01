const turf = require('@turf/turf');
const p1 = turf.polygon([[[0,0], [0,1], [1,1], [1,0], [0,0]]]);
const p2 = turf.polygon([[[1,0], [1,1], [2,1], [2,0], [1,0]]]);
try {
  const u1 = turf.union(p1, p2);
  console.log("turf.union(p1, p2) works:", u1.geometry.type);
} catch(e) {
  console.error("turf.union(p1, p2) failed:", e.message);
}

try {
  const fc = turf.featureCollection([p1, p2]);
  const u2 = turf.union(fc);
  console.log("turf.union(fc) works:", u2.geometry.type);
} catch(e) {
  console.error("turf.union(fc) failed:", e.message);
}
