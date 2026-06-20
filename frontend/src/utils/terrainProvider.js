/**
 * Creates a custom heightmap terrain provider for CesiumJS
 * that loads real elevations from the Spring Boot binary tile API.
 */
export function createVaranasiTerrainProvider() {
  if (typeof window === 'undefined' || !window.Cesium) {
    return null;
  }
  
  const Cesium = window.Cesium;

  return new Cesium.CustomHeightmapTerrainProvider({
    width: 33,
    height: 33,
    tilingScheme: new Cesium.GeographicTilingScheme({
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1
    }),
    callback: async function(x, y, level) {
      try {
        const response = await fetch(`/api/terrain/tile/${level}/${x}/${y}`);
        if (!response.ok) {
          // Fallback to flat terrain outside coverage
          return new Float32Array(33 * 33).fill(0.0);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength !== 33 * 33 * 4) {
          return new Float32Array(33 * 33).fill(0.0);
        }
        return new Float32Array(arrayBuffer);
      } catch (err) {
        console.error('Error fetching terrain tile:', err);
        return new Float32Array(33 * 33).fill(0.0);
      }
    }
  });
}
