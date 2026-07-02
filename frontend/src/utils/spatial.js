import GeoJSON from 'ol/format/GeoJSON';
import { getArea, getLength, getDistance } from 'ol/sphere';
import { toLonLat, fromLonLat } from 'ol/proj';

const geojsonFormat = new GeoJSON();

export function formatCoordinates(coordinates) {
  if (!coordinates) {
    return 'Click the map to select a site';
  }

  return `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`;
}

export function readGeoJsonFeatures(geojson) {
  return geojsonFormat.readFeatures(geojson, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });
}

export function writeGeoJsonFeatures(features) {
  return geojsonFormat.writeFeatures(features, {
    dataProjection: 'EPSG:4326',
    featureProjection: 'EPSG:3857'
  });
}

export function createLayerMetadata({ geojson, fileName, sourceType }) {
  const features = geojson?.features || [];
  const geometryTypes = Array.from(new Set(features.map((feature) => feature.geometry?.type).filter(Boolean)));

  return {
    fileName,
    sourceType,
    featureCount: features.length,
    geometryTypes: geometryTypes.length ? geometryTypes : ['Unknown'],
    createdAt: new Date().toISOString()
  };
}

export function countGeometries(geojson) {
  return (geojson?.features || []).reduce((accumulator, feature) => {
    const type = feature.geometry?.type || 'Unknown';
    accumulator[type] = (accumulator[type] || 0) + 1;
    return accumulator;
  }, {});
}

export function analyzeSelectedArea({ polygonFeature, layers, intelEntities }) {
  if (!polygonFeature) {
    return null;
  }

  const polyGeom = polygonFeature.getGeometry();
  if (!polyGeom) {
    return null;
  }

  const areaSquareMeters = getArea(polyGeom);
  const featuresInside = [];
  const layerCounts = {};

  (layers || []).forEach((layer) => {
    const sourceFeatures = readGeoJsonFeatures(layer.geojson || { type: 'FeatureCollection', features: [] });
    let count = 0;

    sourceFeatures.forEach((feature) => {
      const geom = feature.getGeometry();
      if (!geom) return;

      let intersects = false;
      const geomType = geom.getType();

      if (geomType === 'Point') {
        intersects = polyGeom.intersectsCoordinate(geom.getCoordinates());
      } else if (geomType === 'MultiPoint' || geomType === 'LineString') {
        intersects = geom.getCoordinates().some((coord) => polyGeom.intersectsCoordinate(coord));
      } else if (geomType === 'MultiLineString') {
        intersects = geom.getCoordinates().some((line) => line.some((coord) => polyGeom.intersectsCoordinate(coord)));
      } else if (geomType === 'Polygon') {
        const hasVertexInside = geom.getCoordinates().some((ring) => ring.some((coord) => polyGeom.intersectsCoordinate(coord)));
        const hasPolyVertexInside = polyGeom.getCoordinates().some((ring) => ring.some((coord) => geom.intersectsCoordinate(coord)));
        intersects = hasVertexInside || hasPolyVertexInside;
      } else if (geomType === 'MultiPolygon') {
        const hasVertexInside = geom.getCoordinates().some((poly) => poly.some((ring) => ring.some((coord) => polyGeom.intersectsCoordinate(coord))));
        const hasPolyVertexInside = polyGeom.getCoordinates().some((ring) => ring.some((coord) => geom.intersectsCoordinate(coord)));
        intersects = hasVertexInside || hasPolyVertexInside;
      } else {
        intersects = polyGeom.intersectsExtent(geom.getExtent());
      }

      if (intersects) {
        count += 1;
        const properties = feature.getProperties();
        delete properties.geometry;
        featuresInside.push({
          layerId: layer.id,
          layerName: layer.name,
          name: properties.name || properties.title || properties.label || 'Unnamed feature',
          geometryType: geom.getType() || 'Unknown'
        });
      }
    });

    layerCounts[layer.id] = count;
  });

  // INTEGRATE ACTIVE AI INTEL ENTITIES
  if (intelEntities && intelEntities.length > 0) {
    let count = 0;
    intelEntities.forEach((entity) => {
      const coords = fromLonLat([entity.longitude, entity.latitude]);
      if (polyGeom.intersectsCoordinate(coords)) {
        count += 1;
        featuresInside.push({
          layerId: 'ai-intel',
          layerName: 'AI Intel Layer',
          name: `[${entity.extractedData.entityType}] ${entity.extractedData.title}`,
          geometryType: 'Point'
        });
      }
    });
    if (count > 0) {
      layerCounts['ai-intel'] = count;
    }
  }

  return {
    areaSquareMeters,
    areaSquareKilometers: areaSquareMeters / 1_000_000,
    totalFeatures: featuresInside.length,
    layerCounts,
    featuresInside
  };
}

export function calculateLineDistance(lineFeature) {
  if (!lineFeature) return 0;
  const geom = lineFeature.getGeometry();
  if (!geom) return 0;
  return getLength(geom);
}

export function calculateDistanceBetweenCoordinates(coord1, coord2) {
  if (!coord1 || !coord2) return 0;
  return getDistance(coord1, coord2);
}

export function isPointInPolygon(point, polygonCoords) {
  if (!polygonCoords || polygonCoords.length === 0) return false;
  const x = point[0];
  const y = point[1];
  const ring = polygonCoords[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    
    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getPolygonMetrics(polygonFeature) {
  if (!polygonFeature) return null;
  const geom = polygonFeature.getGeometry();
  if (!geom) return null;

  const areaSquareMeters = getArea(geom);
  
  const geom4326 = geom.clone().transform('EPSG:3857', 'EPSG:4326');
  const polygonCoords = geom4326.getCoordinates();

  const extent4326 = geom4326.getExtent();
  const bbox = [extent4326[1], extent4326[0], extent4326[3], extent4326[2]];

  const ring = polygonCoords[0];
  let sumLon = 0;
  let sumLat = 0;
  const count = ring.length - 1;
  for (let i = 0; i < count; i++) {
    sumLon += ring[i][0];
    sumLat += ring[i][1];
  }
  const centroid = [sumLon / count, sumLat / count];

  return {
    areaSquareMeters,
    areaHectares: areaSquareMeters / 10000,
    areaSquareKilometers: areaSquareMeters / 1000000,
    centroid,
    bbox,
    polygonCoords
  };
}
