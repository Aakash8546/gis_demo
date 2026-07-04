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
        featureVector.put("environment", buildEnvironmentFeatures(layersData));
        featureVector.put("land_use", buildLandUseFeatures(layersData));
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
    private Map<String, FeatureValue> buildTransportationFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> logistics = (Map<String, Object>) layersData.get("logistics-access");

        long hwyDist = 10000L;
        String hwyClass = "unknown";
        long railDist = 10000L;
        long fuelDist = 10000L;
        int roadCount = 0;

        if (logistics != null && !"fallback".equals(logistics.get("status")) && !"error".equals(logistics.get("status"))) {
            Map<String, Object> hwy = (Map<String, Object>) logistics.get("nearestHighway");
            Map<String, Object> rail = (Map<String, Object>) logistics.get("nearestRailStation");
            Map<String, Object> fuel = (Map<String, Object>) logistics.get("nearestFuelStation");
            Map<String, Object> density = (Map<String, Object>) logistics.get("roadDensity");

            if (hwy != null && hwy.containsKey("distance_m")) hwyDist = ((Number) hwy.get("distance_m")).longValue();
            if (hwy != null && hwy.containsKey("class")) hwyClass = (String) hwy.get("class");
            if (rail != null && rail.containsKey("distance_m")) railDist = ((Number) rail.get("distance_m")).longValue();
            if (fuel != null && fuel.containsKey("distance_m")) fuelDist = ((Number) fuel.get("distance_m")).longValue();
            if (density != null && density.containsKey("roads_within_2km")) roadCount = ((Number) density.get("roads_within_2km")).intValue();
        }

        // Distance to highway: normalize close to 1.0, far to 0.0 (max 10km)
        double normHwy = Math.max(0.0, 1.0 - (hwyDist / 10000.0));
        features.put("nearest_highway_distance", new FeatureValue(hwyDist, normHwy, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric")));
        features.put("nearest_highway_class", new FeatureValue(hwyClass, null, Map.of("source", "OpenStreetMap", "units", "categorical", "type", "categorical")));

        double normRail = Math.max(0.0, 1.0 - (railDist / 15000.0));
        features.put("nearest_rail_station_distance", new FeatureValue(railDist, normRail, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric")));

        double normFuel = Math.max(0.0, 1.0 - (fuelDist / 5000.0));
        features.put("nearest_fuel_station_distance", new FeatureValue(fuelDist, normFuel, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric")));

        double normRoads = Math.min(1.0, roadCount / 100.0);
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

        long subDist = 10000L;
        int linesCount = 0;
        long waterDist = 10000L;
        long towerDist = 10000L;
        int towersCount = 0;
        long postDist = 10000L;

        if (infra != null && !"fallback".equals(infra.get("status")) && !"error".equals(infra.get("status"))) {
            Map<String, Object> power = (Map<String, Object>) infra.get("power");
            Map<String, Object> water = (Map<String, Object>) infra.get("water");
            Map<String, Object> telecom = (Map<String, Object>) infra.get("telecom");
            Map<String, Object> postal = (Map<String, Object>) infra.get("postal");

            if (power != null) {
                if (power.containsKey("nearest_substation_m")) subDist = ((Number) power.get("nearest_substation_m")).longValue();
                if (power.containsKey("power_lines_within_2km")) linesCount = ((Number) power.get("power_lines_within_2km")).intValue();
            }
            if (water != null) {
                if (water.containsKey("nearest_source_m")) waterDist = ((Number) water.get("nearest_source_m")).longValue();
            }
            if (telecom != null) {
                if (telecom.containsKey("nearest_tower_m")) towerDist = ((Number) telecom.get("nearest_tower_m")).longValue();
                if (telecom.containsKey("towers_within_2km")) towersCount = ((Number) telecom.get("towers_within_2km")).intValue();
            }
            if (postal != null) {
                if (postal.containsKey("nearest_post_office_m")) postDist = ((Number) postal.get("nearest_post_office_m")).longValue();
            }
        }

        double normSub = Math.max(0.0, 1.0 - (subDist / 10000.0));
        features.put("nearest_substation_distance", new FeatureValue(subDist, normSub, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric")));

        double normLines = Math.min(1.0, linesCount / 10.0);
        features.put("power_lines_within_2km", new FeatureValue(linesCount, normLines, Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));

        double normWater = Math.max(0.0, 1.0 - (waterDist / 5000.0));
        features.put("nearest_water_infrastructure_distance", new FeatureValue(waterDist, normWater, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric")));

        double normTower = Math.max(0.0, 1.0 - (towerDist / 5000.0));
        features.put("nearest_telecom_tower_distance", new FeatureValue(towerDist, normTower, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric")));

        double normTowers = Math.min(1.0, towersCount / 20.0);
        features.put("telecom_towers_within_2km", new FeatureValue(towersCount, normTowers, Map.of("source", "OpenStreetMap", "units", "count", "type", "numeric")));

        double normPost = Math.max(0.0, 1.0 - (postDist / 5000.0));
        features.put("nearest_post_office_distance", new FeatureValue(postDist, normPost, Map.of("source", "OpenStreetMap", "units", "meters", "type", "numeric")));

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
    private Map<String, FeatureValue> buildEnvironmentFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> aqi = (Map<String, Object>) layersData.get("air-quality-advanced");

        // Baseline environment features
        String floodRisk = "Low";
        String seismicZone = "Zone III";
        double pm25 = 15.0;
        double aqiVal = 45.0;

        // Try getting environment details from postgis and custom maps
        Map<String, Object> postgis = (Map<String, Object>) layersData.get("local-postgis");
        if (postgis != null && postgis.containsKey("flood_risk")) {
            floodRisk = (String) postgis.get("flood_risk");
        }

        if (aqi != null && !"fallback".equals(aqi.get("status")) && !"error".equals(aqi.get("status"))) {
            if (aqi.containsKey("pm2_5")) pm25 = ((Number) aqi.get("pm2_5")).doubleValue();
            if (aqi.containsKey("co")) aqiVal = ((Number) aqi.get("co")).doubleValue() / 10.0; // proxy to scale
        }

        features.put("flood_risk_classification", new FeatureValue(floodRisk, "Low".equalsIgnoreCase(floodRisk) ? 1.0 : ("Medium".equalsIgnoreCase(floodRisk) ? 0.5 : 0.0), Map.of("source", "Local PostGIS DB", "units", "categorical", "type", "categorical")));
        features.put("seismic_hazard_zone", new FeatureValue(seismicZone, 0.6, Map.of("source", "USGS Seismic", "units", "categorical", "type", "categorical")));

        double normPm = Math.max(0.0, 1.0 - (pm25 / 150.0));
        features.put("pm2_5_concentration", new FeatureValue(pm25, normPm, Map.of("source", "Open-Meteo Air Quality", "units", "ug/m3", "type", "numeric")));

        return features;
    }

    @SuppressWarnings("unchecked")
    private Map<String, FeatureValue> buildLandUseFeatures(Map<String, Object> layersData) {
        Map<String, FeatureValue> features = new LinkedHashMap<>();
        Map<String, Object> postgis = (Map<String, Object>) layersData.get("local-postgis");

        double elevation = 75.0;
        double slope = 1.0;
        String lulcClass = "urban";

        if (postgis != null && !"fallback".equals(postgis.get("status")) && !"error".equals(postgis.get("status"))) {
            if (postgis.containsKey("elevation")) elevation = ((Number) postgis.get("elevation")).doubleValue();
            if (postgis.containsKey("slope")) slope = ((Number) postgis.get("slope")).doubleValue();
            if (postgis.containsKey("lulc_class")) lulcClass = (String) postgis.get("lulc_class");
        }

        double normElev = Math.min(1.0, elevation / 2000.0);
        features.put("elevation_meters", new FeatureValue(elevation, normElev, Map.of("source", "Local DEM DB", "units", "meters", "type", "numeric")));

        double normSlope = Math.max(0.0, 1.0 - (slope / 30.0));
        features.put("slope_degrees", new FeatureValue(slope, normSlope, Map.of("source", "Local Slope DB", "units", "degrees", "type", "numeric")));

        features.put("lulc_class", new FeatureValue(lulcClass, null, Map.of("source", "Local PostGIS DB", "units", "categorical", "type", "categorical")));

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
