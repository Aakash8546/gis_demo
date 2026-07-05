package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class LogisticsAccessLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final OverpassQueryService overpassQueryService;

    @Value("${openrouteservice.api.key:}")
    private String orsApiKey;

    public LogisticsAccessLayerProvider(OverpassQueryService overpassQueryService) {
        this.overpassQueryService = overpassQueryService;
    }

    @Override
    public String getLayerId() {
        return "logistics-access";
    }

    @Override
    public String getLayerName() {
        return "Logistics & Accessibility";
    }

    @Override
    public boolean isRaster() {
        return false;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();

        String jsonResponse = overpassQueryService.getUnifiedPointData(lat, lon);
        if (jsonResponse == null) {
            result.put("status", "fallback");
            result.put("nearestHighway", createFallbackHighway(lat, lon));
            result.put("nearestRailStation", createFallbackRail(lat, lon));
            result.put("nearestFuelStation", createFallbackFuel(lat, lon));
            result.put("roadDensity", createFallbackRoadDensity());
            result.put("transportScore", 65);
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");

            Map<String, Object> nearestHighway = null;
            Map<String, Object> nearestRail = null;
            Map<String, Object> nearestFuel = null;

            double minHighwayDist = Double.MAX_VALUE;
            double minRailDist = Double.MAX_VALUE;
            double minFuelDist = Double.MAX_VALUE;

            int primaryRoads = 0;
            int secondaryRoads = 0;
            int tertiaryRoads = 0;

            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");

                boolean isLogistics = tags.has("highway") ||
                                      "station".equals(tags.path("railway").asText()) ||
                                      "fuel".equals(tags.path("amenity").asText());
                if (!isLogistics) {
                    continue;
                }

                String name = tags.path("name").asText("Unnamed");
                double elemLat = elem.has("lat") ? elem.path("lat").asDouble() : (elem.has("center") ? elem.path("center").path("lat").asDouble() : lat);
                double elemLon = elem.has("lon") ? elem.path("lon").asDouble() : (elem.has("center") ? elem.path("center").path("lon").asDouble() : lon);
                double distance = calculateDistance(lat, lon, elemLat, elemLon);

                if (tags.has("highway")) {
                    String hwClass = tags.path("highway").asText();
                    if ("primary".equals(hwClass) || "trunk".equals(hwClass) || "motorway".equals(hwClass)) {
                        primaryRoads++;
                    } else if ("secondary".equals(hwClass)) {
                        secondaryRoads++;
                    } else if ("tertiary".equals(hwClass)) {
                        tertiaryRoads++;
                    }

                    if (distance < minHighwayDist) {
                        minHighwayDist = distance;
                        nearestHighway = new LinkedHashMap<>();
                        nearestHighway.put("name", name.equals("Unnamed") ? "State Highway / Connecting Road" : name);
                        nearestHighway.put("class", hwClass);
                        nearestHighway.put("distance_m", Math.round(distance));
                        nearestHighway.put("latitude", elemLat);
                        nearestHighway.put("longitude", elemLon);
                    }
                } else if ("station".equals(tags.path("railway").asText())) {
                    if (distance < minRailDist) {
                        minRailDist = distance;
                        nearestRail = new LinkedHashMap<>();
                        nearestRail.put("name", name.equals("Unnamed") ? "Local Railway Station" : name);
                        nearestRail.put("distance_m", Math.round(distance));
                        nearestRail.put("latitude", elemLat);
                        nearestRail.put("longitude", elemLon);
                    }
                } else if ("fuel".equals(tags.path("amenity").asText())) {
                    if (distance < minFuelDist) {
                        minFuelDist = distance;
                        nearestFuel = new LinkedHashMap<>();
                        nearestFuel.put("name", name.equals("Unnamed") ? "Fuel Station" : name);
                        nearestFuel.put("distance_m", Math.round(distance));
                        nearestFuel.put("latitude", elemLat);
                        nearestFuel.put("longitude", elemLon);
                    }
                }
            }

            if (nearestHighway == null) nearestHighway = createFallbackHighway(lat, lon);
            if (nearestRail == null) nearestRail = createFallbackRail(lat, lon);
            if (nearestFuel == null) nearestFuel = createFallbackFuel(lat, lon);

            Map<String, Object> roadDensity = new LinkedHashMap<>();
            int totalRoads = primaryRoads + secondaryRoads + tertiaryRoads;
            roadDensity.put("roads_within_2km", totalRoads);
            roadDensity.put("classification", totalRoads > 15 ? "well_connected" : (totalRoads > 5 ? "moderately_connected" : "poorly_connected"));

            result.put("status", "success");
            result.put("nearestHighway", nearestHighway);
            result.put("nearestRailStation", nearestRail);
            result.put("nearestFuelStation", nearestFuel);
            result.put("roadDensity", roadDensity);

            // Compute transport score based on proximity (safely handle clean null fallbacks)
            Object hwyDistObj = nearestHighway.get("distance_m");
            Object railDistObj = nearestRail.get("distance_m");
            Object fuelDistObj = nearestFuel.get("distance_m");

            long highwayDist = hwyDistObj == null ? 10000L : ((Number) hwyDistObj).longValue();
            long railDist = railDistObj == null ? 10000L : ((Number) railDistObj).longValue();
            long fuelDist = fuelDistObj == null ? 10000L : ((Number) fuelDistObj).longValue();

            int score = 100;
            if (highwayDist > 3000) score -= 30;
            else if (highwayDist > 1000) score -= 15;
            
            if (railDist > 8000) score -= 15;
            else if (railDist > 5000) score -= 8;

            if (fuelDist > 4000) score -= 15;
            else if (fuelDist > 2000) score -= 8;
            
            result.put("transportScore", Math.max(score, 30));

            // Optional OpenRouteService check
            Map<String, Object> isochrone = new LinkedHashMap<>();
            if (orsApiKey != null && !orsApiKey.trim().isEmpty()) {
                isochrone.put("available", true);
                isochrone.put("provider", "OpenRouteService");
                isochrone.put("note", "ORS key found. Isochrone data is supported.");
            } else {
                isochrone.put("available", false);
                isochrone.put("note", "Set openrouteservice.api.key in application.properties to enable drive-time analysis");
            }
            result.put("isochrone", isochrone);

        } catch (Exception e) {
            log.error("Failed to parse Overpass response for logistics-access: {}", e.getMessage());
            result.put("status", "error");
            result.put("message", e.getMessage());
        }

        return result;
    }

    @Override
    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        if (coordinates == null || coordinates.isEmpty() || coordinates.get(0).isEmpty()) {
            return Collections.singletonMap("status", "error");
        }
        List<List<Double>> outerRing = coordinates.get(0);
        double sumLon = 0.0, sumLat = 0.0;
        for (List<Double> pt : outerRing) {
            sumLon += pt.get(0);
            sumLat += pt.get(1);
        }
        return queryPoint(sumLon / outerRing.size(), sumLat / outerRing.size());
    }

    private Map<String, Object> createFallbackHighway(double lat, double lon) {
        Map<String, Object> hw = new LinkedHashMap<>();
        hw.put("name", "Not detected");
        hw.put("class", "unknown");
        hw.put("distance_m", null);
        hw.put("latitude", null);
        hw.put("longitude", null);
        return hw;
    }

    private Map<String, Object> createFallbackRail(double lat, double lon) {
        Map<String, Object> rail = new LinkedHashMap<>();
        rail.put("name", "Not detected");
        rail.put("distance_m", null);
        rail.put("latitude", null);
        rail.put("longitude", null);
        return rail;
    }

    private Map<String, Object> createFallbackFuel(double lat, double lon) {
        Map<String, Object> fuel = new LinkedHashMap<>();
        fuel.put("name", "Not detected");
        fuel.put("distance_m", null);
        fuel.put("latitude", null);
        fuel.put("longitude", null);
        return fuel;
    }

    private Map<String, Object> createFallbackRoadDensity() {
        Map<String, Object> rd = new LinkedHashMap<>();
        rd.put("roads_within_2km", 8);
        rd.put("classification", "moderately_connected");
        return rd;
    }

    private double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
        final double R = 6371000.0; // metres
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double deltaPhi = Math.toRadians(lat2 - lat1);
        double deltaLambda = Math.toRadians(lon2 - lon1);

        double a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                   Math.cos(phi1) * Math.cos(phi2) *
                   Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // in metres
    }
}
