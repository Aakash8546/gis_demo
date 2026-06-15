import GeoJSON from 'ol/format/GeoJSON';
import { getArea, getLength, getDistance } from 'ol/sphere';

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

export function analyzeSelectedArea({ polygonFeature, layers }) {
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
