import * as turf from '@turf/turf';
import GeoJSON from 'ol/format/GeoJSON';
import { fromLonLat } from 'ol/proj';
import { getArea } from 'ol/sphere';

export const BUFFER_PRESETS = [500, 1000, 2000];

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

export function featureSummary(feature) {
  if (!feature) {
    return null;
  }

  const properties = feature.getProperties();
  delete properties.geometry;

  return {
    name: properties.name || properties.title || properties.label || 'Unnamed feature',
    geometryType: feature.getGeometry()?.getType() || 'Unknown',
    coordinates: feature.getGeometry()?.getCoordinates?.() || null,
    properties
  };
}

function toTurfFeature(feature) {
  return turf.feature(feature.geometry, feature.properties || {});
}

function distanceToFeatureMeters(point, feature) {
  const geometryType = feature.geometry?.type;
  const turfFeature = toTurfFeature(feature);

  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    return turf.distance(point, turfFeature, { units: 'kilometers' }) * 1000;
  }

  if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
    return turf.pointToLineDistance(point, turfFeature, { units: 'kilometers' }) * 1000;
  }

  if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') {
    if (turf.booleanPointInPolygon(point, turfFeature)) {
      return 0;
    }
    return turf.distance(point, turf.centroid(turfFeature), { units: 'kilometers' }) * 1000;
  }

  return Number.POSITIVE_INFINITY;
}

function countNearbyFeatures(selectedCoordinates, radiusMeters, geojson) {
  const point = turf.point(selectedCoordinates);
  return (geojson?.features || []).filter((feature) => distanceToFeatureMeters(point, feature) <= radiusMeters).length;
}

export function analyzeSpatialContext({ selectedCoordinates, radiusMeters, datasets, selectedPolygon, selectedFeature, allLayers }) {
  if (!selectedCoordinates || !radiusMeters) {
    return null;
  }

  const point = turf.point(selectedCoordinates);
  const buffer = turf.buffer(point, radiusMeters / 1000, { units: 'kilometers' });
  const allEntries = Object.entries(datasets || {});

  const counts = {
    shops: 0,
    schools: 0,
    hospitals: 0,
    roads: 0,
    uploaded: 0
  };

  const nearbyFeatures = [];
  const nearestDistances = {};

  allEntries.forEach(([layerId, geojson]) => {
    const nearbyCount = countNearbyFeatures(selectedCoordinates, radiusMeters, geojson);
    counts[layerId] = nearbyCount;
    if (allLayers?.some((layer) => layer.id === layerId && layer.sourceType === 'upload')) {
      counts.uploaded += nearbyCount;
    }

    let nearest = null;
    (geojson?.features || []).forEach((feature) => {
      const distance = distanceToFeatureMeters(point, feature);
      if (Number.isFinite(distance)) {
        if (nearest === null || distance < nearest) {
          nearest = distance;
        }
      }

      if (distance <= radiusMeters) {
        nearbyFeatures.push({
          layerId,
          name: feature.properties?.name || feature.properties?.title || 'Unnamed feature',
          geometryType: feature.geometry?.type || 'Unknown'
        });
      }
    });

    nearestDistances[`${layerId}Distance`] = nearest === null ? null : Number(nearest.toFixed(1));
  });

  const competitorCount = counts.shops || 0;
  const competitorDensity = radiusMeters > 0 ? competitorCount / (Math.PI * (radiusMeters / 1000) ** 2) : 0;
  const competitionLevel = competitorCount < 3 ? 'Low' : competitorCount < 8 ? 'Medium' : 'High';

  const polygonGeometry = selectedPolygon ? selectedPolygon.geometry || selectedPolygon : null;
  const selectedPolygonArea = polygonGeometry ? turf.area(polygonGeometry) : 0;
  const pointInPolygon = polygonGeometry ? turf.booleanPointInPolygon(point, polygonGeometry) : false;
  const intersectsCount = polygonGeometry
    ? allEntries.reduce((accumulator, [, geojson]) => {
        return accumulator + (geojson?.features || []).filter((feature) => turf.booleanIntersects(polygonGeometry, toTurfFeature(feature))).length;
      }, 0)
    : 0;

  const populationFactor = Math.min(100, 40 + counts.schools * 12 + counts.hospitals * 11 + (pointInPolygon ? 6 : 0));
  const trafficFactor = Math.min(100, 30 + counts.roads * 16 + radiusMeters / 80);
  const competitionFactor = Math.max(0, 100 - competitorCount * 9);
  const accessibilityFactor = Math.min(100, 35 + counts.roads * 18);
  const infrastructureFactor = Math.min(100, 24 + counts.roads * 18 + counts.hospitals * 10);

  const businessPotentialScore = Math.round(
    populationFactor * 0.25 +
      trafficFactor * 0.2 +
      competitionFactor * 0.2 +
      accessibilityFactor * 0.2 +
      infrastructureFactor * 0.15
  );

  const suitabilityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(businessPotentialScore + (selectedPolygonArea > 0 ? 5 : 0) + (pointInPolygon ? 5 : 0) - Math.min(20, competitorCount * 1.5))
    )
  );

  const explanation = [
    `Population factor ${populationFactor}/100 from nearby schools and hospitals.`,
    `Traffic factor ${trafficFactor}/100 from road density and catchment size.`,
    `Competition factor ${competitionFactor}/100 based on ${competitorCount} nearby shops.`,
    `Suitability score ${suitabilityScore}% reflects accessibility, infrastructure, and local demand.`
  ].join(' ');

  return {
    selectedCoordinates,
    radiusMeters,
    counts,
    competitorCount,
    competitorDensity: Number(competitorDensity.toFixed(2)),
    competitionLevel,
    nearestDistances,
    nearbyFeatures,
    buffer,
    selectedPolygonArea,
    pointInPolygon,
    intersectsCount,
    populationFactor,
    trafficFactor,
    competitionFactor,
    accessibilityFactor,
    infrastructureFactor,
    businessPotentialScore,
    suitabilityScore,
    explanation
  };
}

export function createCandidateLocations({ datasets, center, extent }) {
  const [minX, minY, maxX, maxY] = extent || [center[0] - 0.03, center[1] - 0.03, center[0] + 0.03, center[1] + 0.03];
  const sampled = [];
  const steps = 5;

  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      const lon = minX + ((maxX - minX) / (steps - 1)) * column;
      const lat = minY + ((maxY - minY) / (steps - 1)) * row;
      sampled.push([lon, lat]);
    }
  }

  const scorePoint = (coordinate) => {
    const point = turf.point(coordinate);
    const within1km = (geojson) =>
      (geojson?.features || []).filter((feature) => distanceToFeatureMeters(point, feature) <= 1000).length;

    const shops = within1km(datasets.shops);
    const schools = within1km(datasets.schools);
    const hospitals = within1km(datasets.hospitals);
    const roads = within1km(datasets.roads);

    const score = Math.max(0, Math.min(100, Math.round(34 + schools * 12 + hospitals * 10 + roads * 9 - shops * 10)));

    return {
      coordinates: coordinate,
      score,
      nearbyShops: shops,
      nearbySchools: schools,
      nearbyHospitals: hospitals
    };
  };

  return sampled.map(scorePoint).sort((a, b) => b.score - a.score).slice(0, 5);
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
      if (geom.getType() === 'Point' || geom.getType() === 'MultiPoint') {
        const coords = geom.getCoordinates();
        intersects = polyGeom.intersectsCoordinate(coords);
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

export function exportAsJson(payload) {
  return JSON.stringify(payload, null, 2);
}

export function projectLonLat(coordinates) {
  return fromLonLat(coordinates);
}
