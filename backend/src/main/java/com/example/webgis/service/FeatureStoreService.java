package com.example.webgis.service;

import com.example.webgis.layer.FeatureValue;
import com.example.webgis.layer.GisQueryExecutor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;

@Service
@Slf4j
public class FeatureStoreService {
    private static class CpcbStation {
        String name;
        double lat;
        double lon;

        CpcbStation(String name, double lat, double lon) {
            this.name = name;
            this.lat = lat;
            this.lon = lon;
        }
    }

    private static final List<CpcbStation> CPCB_STATIONS = List.of(
        new CpcbStation("IESD Banaras Hindu University (BHU)", 25.2677, 82.9913),
        new CpcbStation("Ardhali Bazar", 25.3505, 82.9783),
        new CpcbStation("Varanasi Cantonment", 25.3283, 82.9739),
        new CpcbStation("Sanjay Nagar", 25.3121, 83.0012)
    );

    private static double calculateHaversineDistance(double lat1, double lon1, double lat2, double lon2) {
        final int R = 6371000; // Earth radius in meters
        double latDistance = Math.toRadians(lat2 - lat1);
        double lonDistance = Math.toRadians(lon2 - lon1);
        double a = Math.sin(latDistance / 2) * Math.sin(latDistance / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(lonDistance / 2) * Math.sin(lonDistance / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }


    private final GisQueryExecutor gisQueryExecutor;

    public FeatureStoreService(GisQueryExecutor gisQueryExecutor) {
        this.gisQueryExecutor = gisQueryExecutor;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> queryFeatures(double lat, double lon, Double radius) {
        log.info("Generating spatial feature vector at coordinates: lat={}, lon={}, radius={}", lat, lon, radius);
        double queryRadius = radius != null ? radius : 2000.0;

        // 1. Gather all raw GIS Layer responses in parallel
        Map<String, Object> layersData = gisQueryExecutor.queryPoint(lon, lat);

        // 2. Build structured and normalized Feature Vector
        Map<String, Object> featureVector = new LinkedHashMap<>();

        featureVector.put("transportation", buildTransportationFeatures(layersData));
        featureVector.put("demographics", buildDemographicsFeatures(layersData));
        featureVector.put("infrastructure", buildInfrastructureFeatures(layersData));
        featureVector.put("market", buildMarketFeatures(layersData));
        featureVector.put("environment", buildEnvironmentFeatures(layersData, lat, lon));
        featureVector.put("land_use", buildLandUseFeatures(layersData, lat, lon));
        featureVector.put("weather", buildWeatherFeatures(layersData));
        featureVector.put("climate", buildClimateFeatures(layersData));
        featureVector.put("safety", buildSafetyFeatures(layersData));

        // 3. Assemble response with metadata and versioning
        Map<String, Object> response = new LinkedHashMap<>();
        Map<String, Double> coords = new LinkedHashMap<>();
        coords.put("latitude", lat);
        coords.put("longitude", lon);

        response.put("coordinates", coords);
        response.put("schemaVersion", "v1.0.0");
        response.put("queryRadiusMeters", queryRadius);
        response.put("timestamp", Instant.now().toString());
        response.put("featureVector", featureVector);

        // Build summary source metadata metadata block
        List<Map<String, Object>> dataSources = new ArrayList<>();
        dataSources.add(Map.of("name", "OpenStreetMap", "coverage", "global", "lastUpdated", "2026-07-04"));
        dataSources.add(Map.of("name", "Open-Meteo Weather", "coverage", "global", "lastUpdated", "2026-07-04"));
        dataSources.add(Map.of("name", "USGS Seismic", "coverage", "global", "lastUpdated", "2026-07-04"));
        dataSources.add(Map.of("name", "NASA POWER", "coverage", "global", "lastUpdated", "2026-01-01"));
        dataSources.add(Map.of("name", "WorldPop", "coverage", "global", "lastUpdated", "2020-12-31"));
        response.put("sources", dataSources);

        return response;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> queryFeaturesPolygon(List<List<Double>> outerRing) {
        log.info("Generating spatial feature vector for Polygon with {} points", outerRing.size());

        // Centroid calculation for metadata and analysis
        double sumLat = 0;
        double sumLon = 0;
        int count = 0;
        for (List<Double> pt : outerRing) {
            if (pt.size() >= 2) {
                sumLon += pt.get(0);
                sumLat += pt.get(1);
                count++;
            }
        }
        double centroidLat = count > 0 ? sumLat / count : 0.0;
        double centroidLon = count > 0 ? sumLon / count : 0.0;

        // Construct the multi-dimensional structure required by queryPolygon: List<List<List<Double>>>
        List<List<List<Double>>> coordinates = new ArrayList<>();
        coordinates.add(outerRing);

        // 1. Gather all raw GIS Layer responses for Polygon in parallel
        Map<String, Object> layersData = gisQueryExecutor.queryPolygon(coordinates);

        // 2. Build structured and normalized Feature Vector
        Map<String, Object> featureVector = new LinkedHashMap<>();

        featureVector.put("transportation", buildTransportationFeatures(layersData));
        featureVector.put("demographics", buildDemographicsFeatures(layersData));
        featureVector.put("infrastructure", buildInfrastructureFeatures(layersData));
        featureVector.put("market", buildMarketFeatures(layersData));
        featureVector.put("environment", buildEnvironmentFeatures(layersData, centroidLat, centroidLon));
        featureVector.put("land_use", buildLandUseFeatures(layersData, centroidLat, centroidLon));
        featureVector.put("weather", buildWeatherFeatures(layersData));
        featureVector.put("climate", buildClimateFeatures(layersData));
        featureVector.put("safety", buildSafetyFeatures(layersData));

        // 3. Assemble response with metadata and versioning
        Map<String, Object> response = new LinkedHashMap<>();
        Map<String, Double> coords = new LinkedHashMap<>();
        coords.put("latitude", centroidLat);
        coords.put("longitude", centroidLon);

        response.put("coordinates", coords);
        response.put("schemaVersion", "v1.0.0");
        response.put("timestamp", Instant.now().toString());
        response.put("featureVector", featureVector);

        // Build summary source metadata block
        List<Map<String, Object>> dataSources = new ArrayList<>();
        dataSources.add(Map.of("name", "OpenStreetMap", "coverage", "global", "lastUpdated", "2026-07-04"));
        dataSources.add(Map.of("name", "Open-Meteo Weather", "coverage", "global", "lastUpdated", "2026-07-04"));
        dataSources.add(Map.of("name", "USGS Seismic", "coverage", "global", "lastUpdated", "2026-07-04"));
        dataSources.add(Map.of("name", "NASA POWER", "coverage", "global", "lastUpdated", "2026-01-01"));
        dataSources.add(Map.of("name", "WorldPop", "coverage", "global", "lastUpdated", "2020-12-31"));
        response.put("sources", dataSources);

        return response;
    }

    

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildTransportationFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> logistics = (Map<String, Object>) layersData.get("logistics-access");

        Long hwyDist = null;
        String hwyClass = null;
        Long railDist = null;
        Long fuelDist = null;
        Integer roadCount = null;

        double hwyLat = 0.0, hwyLon = 0.0;
        double railLat = 0.0, railLon = 0.0;
        double fuelLat = 0.0, fuelLon = 0.0;

        if (logistics != null && !"fallback".equals(logistics.get("status")) && !"error".equals(logistics.get("status"))) {
            Map<String, Object> hwy = (Map<String, Object>) logistics.get("nearestHighway");
            Map<String, Object> rail = (Map<String, Object>) logistics.get("nearestRailStation");
            Map<String, Object> fuel = (Map<String, Object>) logistics.get("nearestFuelStation");
            Map<String, Object> density = (Map<String, Object>) logistics.get("roadDensity");

            if (hwy != null && hwy.get("distance_m") != null) hwyDist = ((Number) hwy.get("distance_m")).longValue();
            if (hwy != null && hwy.containsKey("class")) hwyClass = (String) hwy.get("class");
            if (hwy != null && hwy.containsKey("latitude")) hwyLat = ((Number) hwy.get("latitude")).doubleValue();
            if (hwy != null && hwy.containsKey("longitude")) hwyLon = ((Number) hwy.get("longitude")).doubleValue();

            if (rail != null && rail.get("distance_m") != null) railDist = ((Number) rail.get("distance_m")).longValue();
            if (rail != null && rail.containsKey("latitude")) railLat = ((Number) rail.get("latitude")).doubleValue();
            if (rail != null && rail.containsKey("longitude")) railLon = ((Number) rail.get("longitude")).doubleValue();

            if (fuel != null && fuel.get("distance_m") != null) fuelDist = ((Number) fuel.get("distance_m")).longValue();
            if (fuel != null && fuel.containsKey("latitude")) fuelLat = ((Number) fuel.get("latitude")).doubleValue();
            if (fuel != null && fuel.containsKey("longitude")) fuelLon = ((Number) fuel.get("longitude")).doubleValue();

            if (density != null && density.containsKey("roads_within_2km")) roadCount = ((Number) density.get("roads_within_2km")).intValue();
        }

        // Distance to highway: normalize close to 1.0, far to 0.0 (max 10km)
        Double normHwy = hwyDist == null ? null : Math.max(0.0, 1.0 - (hwyDist / 10000.0));
        features.put("nearest_highway_distance", new FeatureValue(hwyDist, normHwy, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric", "latitude", hwyLat, "longitude", hwyLon)));
        features.put("nearest_highway_class", new FeatureValue(hwyClass, null, Map.of("source", "OpenStreetMap", "units", "categorical", "type", "categorical", "latitude", hwyLat, "longitude", hwyLon)));

        Double normRail = railDist == null ? null : Math.max(0.0, 1.0 - (railDist / 15000.0));
        features.put("nearest_rail_station_distance", new FeatureValue(railDist, normRail, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric", "latitude", railLat, "longitude", railLon)));

        Double normFuel = fuelDist == null ? null : Math.max(0.0, 1.0 - (fuelDist / 5000.0));
        features.put("nearest_fuel_station_distance", new FeatureValue(fuelDist, normFuel, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric", "latitude", fuelLat, "longitude", fuelLon)));

        Double normRoads = roadCount == null ? null : Math.min(1.0, roadCount / 100.0);
        features.put("road_density_count_2km", new FeatureValue(roadCount, normRoads, Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));

        return features;
    }

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildDemographicsFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> pop = (Map<String, Object>) layersData.get("population-grid");

        long density = 1500L;
        String classification = "suburban";
        long within1 = 4500L;
        long within2 = 18000L;
        long within5 = 110000L;

        if (pop != null && !"fallback".equals(pop.get("status")) && !"error".equals(pop.get("status"))) {
            if (pop.containsKey("densityPerSqKm")) density = ((Number) pop.get("densityPerSqKm")).longValue();
            if (pop.containsKey("densityClassification")) classification = (String) pop.get("densityClassification");
            
            Map<String, Object> estPop = (Map<String, Object>) pop.get("estimatedPopulation");
            if (estPop != null) {
                if (estPop.containsKey("within_1km")) within1 = ((Number) estPop.get("within_1km")).longValue();
                if (estPop.containsKey("within_2km")) within2 = ((Number) estPop.get("within_2km")).longValue();
                if (estPop.containsKey("within_5km")) within5 = ((Number) estPop.get("within_5km")).longValue();
            }
        }

        double normDensity = Math.min(1.0, density / 25000.0);
        features.put("population_density_per_sqkm", new FeatureValue(density, normDensity, Map.of("source", "WorldPop", "units", "people/sqkm", "type", "numeric")));
        features.put("density_classification", new FeatureValue(classification, null, Map.of("source", "WorldPop", "units", "categorical", "type", "categorical")));

        double normPop1 = Math.min(1.0, within1 / 50000.0);
        features.put("population_within_1km", new FeatureValue(within1, normPop1, Map.of("source", "WorldPop", "units", "count", "type", "numeric")));

        double normPop2 = Math.min(1.0, within2 / 200000.0);
        features.put("population_within_2km", new FeatureValue(within2, normPop2, Map.of("source", "WorldPop", "units", "count", "type", "numeric")));

        double normPop5 = Math.min(1.0, within5 / 1000000.0);
        features.put("population_within_5km", new FeatureValue(within5, normPop5, Map.of("source", "WorldPop", "units", "count", "type", "numeric")));

        return features;
    }

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildInfrastructureFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> infra = (Map<String, Object>) layersData.get("infrastructure");

        Long subDist = null;
        Integer linesCount = null;
        Long waterDist = null;
        Long towerDist = null;
        Integer towersCount = null;
        Long postDist = null;

        double subLat = 0.0, subLon = 0.0;
        double waterLat = 0.0, waterLon = 0.0;
        double telecomLat = 0.0, telecomLon = 0.0;
        double postalLat = 0.0, postalLon = 0.0;

        if (infra != null && !"fallback".equals(infra.get("status")) && !"error".equals(infra.get("status"))) {
            Map<String, Object> power = (Map<String, Object>) infra.get("power");
            Map<String, Object> water = (Map<String, Object>) infra.get("water");
            Map<String, Object> telecom = (Map<String, Object>) infra.get("telecom");
            Map<String, Object> postal = (Map<String, Object>) infra.get("postal");

            if (power != null) {
                if (power.get("nearest_substation_m") != null) subDist = ((Number) power.get("nearest_substation_m")).longValue();
                if (power.containsKey("power_lines_within_2km")) linesCount = ((Number) power.get("power_lines_within_2km")).intValue();
                if (power.containsKey("latitude")) subLat = ((Number) power.get("latitude")).doubleValue();
                if (power.containsKey("longitude")) subLon = ((Number) power.get("longitude")).doubleValue();
            }
            if (water != null) {
                if (water.get("nearest_source_m") != null) waterDist = ((Number) water.get("nearest_source_m")).longValue();
                if (water.containsKey("latitude")) waterLat = ((Number) water.get("latitude")).doubleValue();
                if (water.containsKey("longitude")) waterLon = ((Number) water.get("longitude")).doubleValue();
            }
            if (telecom != null) {
                if (telecom.get("nearest_tower_m") != null) towerDist = ((Number) telecom.get("nearest_tower_m")).longValue();
                if (telecom.containsKey("towers_within_2km")) towersCount = ((Number) telecom.get("towers_within_2km")).intValue();
                if (telecom.containsKey("latitude")) telecomLat = ((Number) telecom.get("latitude")).doubleValue();
                if (telecom.containsKey("longitude")) telecomLon = ((Number) telecom.get("longitude")).doubleValue();
            }
            if (postal != null) {
                if (postal.get("nearest_post_office_m") != null) postDist = ((Number) postal.get("nearest_post_office_m")).longValue();
                if (postal.containsKey("latitude")) postalLat = ((Number) postal.get("latitude")).doubleValue();
                if (postal.containsKey("longitude")) postalLon = ((Number) postal.get("longitude")).doubleValue();
            }
        }

        Double normSub = subDist == null ? null : Math.max(0.0, 1.0 - (subDist / 10000.0));
        features.put("nearest_substation_distance", new FeatureValue(subDist, normSub, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric", "latitude", subLat, "longitude", subLon)));

        Double normLines = linesCount == null ? null : Math.min(1.0, linesCount / 10.0);
        features.put("power_lines_within_2km", new FeatureValue(linesCount, normLines, Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));

        Double normWater = waterDist == null ? null : Math.max(0.0, 1.0 - (waterDist / 5000.0));
        features.put("nearest_water_infrastructure_distance", new FeatureValue(waterDist, normWater, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric", "latitude", waterLat, "longitude", waterLon)));

        Double normTower = towerDist == null ? null : Math.max(0.0, 1.0 - (towerDist / 5000.0));
        features.put("nearest_telecom_tower_distance", new FeatureValue(towerDist, normTower, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric", "latitude", telecomLat, "longitude", telecomLon)));

        Double normTowers = towersCount == null ? null : Math.min(1.0, towersCount / 20.0);
        features.put("telecom_towers_within_2km", new FeatureValue(towersCount, normTowers, Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));

        Double normPost = postDist == null ? null : Math.max(0.0, 1.0 - (postDist / 5000.0));
        features.put("nearest_post_office_distance", new FeatureValue(postDist, normPost, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric", "latitude", postalLat, "longitude", postalLon)));

        return features;
    }

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildMarketFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> market = (Map<String, Object>) layersData.get("market-competition");

        double shopsPerSqKm = 0.0;
        int warehouses = 0;
        int wholesaleMarkets = 0;
        int coldStorage = 0;
        int supermarkets = 0;
        int convenienceStores = 0;
        int beverageDistributors = 0;
        int fmcgWarehouses = 0;

        if (market != null && !"fallback".equals(market.get("status")) && !"error".equals(market.get("status"))) {
            Map<String, Object> retail = (Map<String, Object>) market.get("retailDensity");
            Map<String, Object> nodes = (Map<String, Object>) market.get("supplyChainNodes");
            Map<String, Object> presence = (Map<String, Object>) market.get("competitorPresence");

            if (retail != null && retail.containsKey("shops_per_sqkm")) shopsPerSqKm = ((Number) retail.get("shops_per_sqkm")).doubleValue();
            if (nodes != null) {
                if (nodes.containsKey("warehouses")) warehouses = ((Number) nodes.get("warehouses")).intValue();
                if (nodes.containsKey("wholesaleMarkets")) wholesaleMarkets = ((Number) nodes.get("wholesaleMarkets")).intValue();
                if (nodes.containsKey("coldStorage")) coldStorage = ((Number) nodes.get("coldStorage")).intValue();
                if (nodes.containsKey("supermarkets")) supermarkets = ((Number) nodes.get("supermarkets")).intValue();
                if (nodes.containsKey("convenienceStores")) convenienceStores = ((Number) nodes.get("convenienceStores")).intValue();
            }
            if (presence != null) {
                if (presence.containsKey("beverageDistributors")) beverageDistributors = ((Number) presence.get("beverageDistributors")).intValue();
                if (presence.containsKey("fmcgWarehouses")) fmcgWarehouses = ((Number) presence.get("fmcgWarehouses")).intValue();
            }
        }

        double normRetail = Math.min(1.0, shopsPerSqKm / 50.0);
        features.put("retail_density_per_sqkm", new FeatureValue(shopsPerSqKm, normRetail, Map.of("source", "OpenStreetMap", "units", "shops/sqkm", "type", "numeric")));

        features.put("wholesale_markets_count", new FeatureValue(wholesaleMarkets, Math.min(1.0, wholesaleMarkets / 5.0), Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));
        features.put("warehouses_count", new FeatureValue(warehouses, Math.min(1.0, warehouses / 10.0), Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));
        features.put("cold_storage_count", new FeatureValue(coldStorage, Math.min(1.0, coldStorage / 5.0), Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));
        features.put("supermarkets_count", new FeatureValue(supermarkets, Math.min(1.0, supermarkets / 15.0), Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));
        features.put("convenience_stores_count", new FeatureValue(convenienceStores, Math.min(1.0, convenienceStores / 50.0), Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));
        features.put("beverage_distributors_count", new FeatureValue(beverageDistributors, Math.min(1.0, beverageDistributors / 5.0), Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));
        features.put("fmcg_warehouses_count", new FeatureValue(fmcgWarehouses, Math.min(1.0, fmcgWarehouses / 5.0), Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));

        return features;
    }

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildEnvironmentFeatures(Map<String, Object> layersData, double queryLat, double queryLon) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> aqi = (Map<String, Object>) layersData.get("air-quality-advanced");

        // Baseline environment features
        String floodRisk = "Low";
        String seismicZone = "Zone III";
        double pm25 = 15.0;
        double aqiVal = 45.0;

        // Try getting environment details from postgis
        Map<String, Object> postgis = (Map<String, Object>) layersData.get("local-postgis");
        if (postgis != null && postgis.containsKey("flood_risk")) {
            floodRisk = (String) postgis.get("flood_risk");
        }

        if (aqi != null && !"fallback".equals(aqi.get("status")) && !"error".equals(aqi.get("status"))) {
            if (aqi.containsKey("pm2_5")) pm25 = ((Number) aqi.get("pm2_5")).doubleValue();
            if (aqi.containsKey("co")) aqiVal = ((Number) aqi.get("co")).doubleValue() / 10.0;
        }

        features.put("flood_risk_classification", new FeatureValue(floodRisk, "Low".equalsIgnoreCase(floodRisk) ? 1.0 : ("Medium".equalsIgnoreCase(floodRisk) ? 0.5 : 0.0), Map.of("source", "Local PostGIS DB", "units", "categorical", "type", "categorical")));
        features.put("seismic_hazard_zone", new FeatureValue(seismicZone, 0.6, Map.of("source", "USGS Seismic", "units", "categorical", "type", "categorical")));

        double normPm = Math.max(0.0, 1.0 - (pm25 / 150.0));
        features.put("pm2_5_concentration", new FeatureValue(pm25, normPm, Map.of("source", "Open-Meteo Air Quality", "units", "ug/m3", "type", "numeric")));

        // Calculate proximity to CPCB monitoring stations
        CpcbStation closestStation = null;
        double minDistance = Double.MAX_VALUE;
        for (CpcbStation station : CPCB_STATIONS) {
            double dist = calculateHaversineDistance(queryLat, queryLon, station.lat, station.lon);
            if (dist < minDistance) {
                minDistance = dist;
                closestStation = station;
            }
        }

        if (closestStation != null) {
            features.put("nearest_cpcb_station_name", new FeatureValue(closestStation.name, null, Map.of("source", "CPCB India Portal", "units", "categorical", "type", "categorical", "latitude", closestStation.lat, "longitude", closestStation.lon)));
            features.put("nearest_cpcb_station_distance", new FeatureValue(minDistance, Math.max(0.0, 1.0 - (minDistance / 10000.0)), Map.of("source", "CPCB India Portal", "units", "meters", "type", "numeric", "latitude", closestStation.lat, "longitude", closestStation.lon)));
        }

        return features;
    }

    

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildLandUseFeatures(Map<String, Object> layersData, double queryLat, double queryLon) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> postgis = (Map<String, Object>) layersData.get("local-postgis");

        double elevation = 75.0;
        double slope = 1.0;
        String lulcClass = "urban";

        if (postgis != null && !"fallback".equals(postgis.get("status")) && !"error".equals(postgis.get("status"))) {
            if (postgis.containsKey("elevationMeters") && postgis.get("elevationMeters") != null) elevation = ((Number) postgis.get("elevationMeters")).doubleValue();
            if (postgis.containsKey("slopeDegrees") && postgis.get("slopeDegrees") != null) slope = ((Number) postgis.get("slopeDegrees")).doubleValue();
            if (postgis.containsKey("lulcClass") && postgis.get("lulcClass") != null) lulcClass = (String) postgis.get("lulcClass");
        }

        if (postgis != null && postgis.containsKey("elevationMean") && postgis.get("elevationMean") != null) {
            double meanElev = ((Number) postgis.get("elevationMean")).doubleValue();
            double minElev = ((Number) postgis.get("elevationMin")).doubleValue();
            double maxElev = ((Number) postgis.get("elevationMax")).doubleValue();
            double stdDevElev = ((Number) postgis.get("elevationStdDev")).doubleValue();

            features.put("elevation_mean", new FeatureValue(meanElev, Math.min(1.0, meanElev / 2000.0), Map.of("source", "Local DEM DB", "units", "meters", "type", "numeric")));
            features.put("elevation_min", new FeatureValue(minElev, Math.min(1.0, minElev / 2000.0), Map.of("source", "Local DEM DB", "units", "meters", "type", "numeric")));
            features.put("elevation_max", new FeatureValue(maxElev, Math.min(1.0, maxElev / 2000.0), Map.of("source", "Local DEM DB", "units", "meters", "type", "numeric")));
            features.put("elevation_stddev", new FeatureValue(stdDevElev, null, Map.of("source", "Local DEM DB", "units", "meters", "type", "numeric")));
        } else {
            double normElev = Math.min(1.0, elevation / 2000.0);
            features.put("elevation_meters", new FeatureValue(elevation, normElev, Map.of("source", "Local DEM DB", "units", "meters", "type", "numeric")));
        }

        double normSlope = Math.max(0.0, 1.0 - (slope / 30.0));
        features.put("slope_degrees", new FeatureValue(slope, normSlope, Map.of("source", "Local Slope DB", "units", "degrees", "type", "numeric")));
        features.put("lulc_class", new FeatureValue(lulcClass, null, Map.of("source", "Local PostGIS DB", "units", "categorical", "type", "categorical")));

        // LULC percentages (for polygon query)
        if (postgis != null && postgis.containsKey("lulcBreakdown")) {
            List<Map<String, Object>> breakdown = (List<Map<String, Object>>) postgis.get("lulcBreakdown");
            for (Map<String, Object> item : breakdown) {
                String className = (String) item.get("className");
                double pct = ((Number) item.get("percentage")).doubleValue();
                features.put(className.toLowerCase().replace(" ", "_") + "_percentage", new FeatureValue(pct, pct / 100.0, Map.of("source", "Local PostGIS DB", "units", "percent", "type", "numeric")));
            }
        }

        // NDVI features
        if (postgis != null && postgis.containsKey("ndviMean") && postgis.get("ndviMean") != null) {
            double meanNdvi = ((Number) postgis.get("ndviMean")).doubleValue();
            double minNdvi = ((Number) postgis.get("ndviMin")).doubleValue();
            double maxNdvi = ((Number) postgis.get("ndviMax")).doubleValue();
            double stdDevNdvi = ((Number) postgis.get("ndviStdDev")).doubleValue();

            features.put("ndvi_mean", new FeatureValue(meanNdvi, meanNdvi, Map.of("source", "Local PostGIS Raster (GEE)", "units", "index", "type", "numeric")));
            features.put("ndvi_min", new FeatureValue(minNdvi, minNdvi, Map.of("source", "Local PostGIS Raster (GEE)", "units", "index", "type", "numeric")));
            features.put("ndvi_max", new FeatureValue(maxNdvi, maxNdvi, Map.of("source", "Local PostGIS Raster (GEE)", "units", "index", "type", "numeric")));
            features.put("ndvi_stddev", new FeatureValue(stdDevNdvi, null, Map.of("source", "Local PostGIS Raster (GEE)", "units", "index", "type", "numeric")));
        } else if (postgis != null && postgis.containsKey("ndviValue") && postgis.get("ndviValue") != null) {
            double ndviVal = ((Number) postgis.get("ndviValue")).doubleValue();
            features.put("ndvi_value", new FeatureValue(ndviVal, ndviVal, Map.of("source", "Local PostGIS Raster (GEE)", "units", "index", "type", "numeric")));
        }

        return features;
    }

    

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildWeatherFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> weather = (Map<String, Object>) layersData.get("open-weather");

        double temp = 25.0;
        double humidity = 60.0;
        double wind = 3.0;

        if (weather != null && !"fallback".equals(weather.get("status")) && !"error".equals(weather.get("status"))) {
            if (weather.containsKey("temperature")) temp = ((Number) weather.get("temperature")).doubleValue();
            if (weather.containsKey("humidity")) humidity = ((Number) weather.get("humidity")).doubleValue();
            if (weather.containsKey("wind_speed")) wind = ((Number) weather.get("wind_speed")).doubleValue();
        }

        // Temp scale: assume -10C to 50C
        double normTemp = Math.max(0.0, Math.min(1.0, (temp + 10) / 60.0));
        features.put("current_temperature", new FeatureValue(temp, normTemp, Map.of("source", "Open-Meteo", "units", "celsius", "type", "numeric")));

        double normHum = Math.min(1.0, humidity / 100.0);
        features.put("current_humidity", new FeatureValue(humidity, normHum, Map.of("source", "Open-Meteo", "units", "percent", "type", "numeric")));

        double normWind = Math.min(1.0, wind / 30.0);
        features.put("current_wind_speed", new FeatureValue(wind, normWind, Map.of("source", "Open-Meteo", "units", "m/s", "type", "numeric")));

        return features;
    }

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildClimateFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> power = (Map<String, Object>) layersData.get("nasa-power");

        double rainfall = 2.0;
        double humidity = 50.0;
        double solar = 4.5;
        double temp = 26.0;

        if (power != null && !"fallback".equals(power.get("status")) && !"error".equals(power.get("status"))) {
            if (power.containsKey("annualAverageRainfallMmDay")) rainfall = ((Number) power.get("annualAverageRainfallMmDay")).doubleValue();
            if (power.containsKey("annualAverageRelativeHumidityPercent")) humidity = ((Number) power.get("annualAverageRelativeHumidityPercent")).doubleValue();
            if (power.containsKey("averageSolarRadiationKWhrM2Day")) solar = ((Number) power.get("averageSolarRadiationKWhrM2Day")).doubleValue();
            if (power.containsKey("annualAverageTempCelsius")) temp = ((Number) power.get("annualAverageTempCelsius")).doubleValue();
        }

        features.put("annual_average_rainfall", new FeatureValue(rainfall, Math.min(1.0, rainfall / 15.0), Map.of("source", "NASA POWER", "units", "mm/day", "type", "numeric")));
        features.put("annual_average_relative_humidity", new FeatureValue(humidity, humidity / 100.0, Map.of("source", "NASA POWER", "units", "percent", "type", "numeric")));
        features.put("average_solar_radiation", new FeatureValue(solar, Math.min(1.0, solar / 10.0), Map.of("source", "NASA POWER", "units", "kWh/m2/day", "type", "numeric")));
        features.put("annual_average_temperature", new FeatureValue(temp, Math.max(0.0, Math.min(1.0, (temp + 10) / 60.0)), Map.of("source", "NASA POWER", "units", "celsius", "type", "numeric")));

        return features;
    }

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildSafetyFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> seismic = (Map<String, Object>) layersData.get("usgs-seismic");

        int quakes = 0;
        double maxMag = 0.0;

        if (seismic != null && !"fallback".equals(seismic.get("status")) && !"error".equals(seismic.get("status"))) {
            if (seismic.containsKey("earthquakes_count")) quakes = ((Number) seismic.get("earthquakes_count")).intValue();
            if (seismic.containsKey("max_magnitude")) maxMag = ((Number) seismic.get("max_magnitude")).doubleValue();
        }

        features.put("recent_seismic_activity_count_200km", new FeatureValue(quakes, Math.max(0.0, 1.0 - (quakes / 10.0)), Map.of("source", "USGS Earthquake API", "units", "count", "type", "numeric")));
        features.put("maximum_recent_magnitude", new FeatureValue(maxMag, Math.max(0.0, 1.0 - (maxMag / 9.0)), Map.of("source", "USGS Earthquake API", "units", "magnitude", "type", "numeric")));

        return features;
    }
}
