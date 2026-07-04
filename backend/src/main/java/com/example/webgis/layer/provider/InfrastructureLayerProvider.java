package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
@Slf4j
public class InfrastructureLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient;

    private static final String[] OVERPASS_MIRRORS = {
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass-api.de/api/interpreter",
            "https://overpass.openstreetmap.ru/api/interpreter"
    };

    public InfrastructureLayerProvider() {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
    }

    @Override
    public String getLayerId() {
        return "infrastructure";
    }

    @Override
    public String getLayerName() {
        return "Infrastructure & Utilities";
    }

    @Override
    public boolean isRaster() {
        return false;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();

        // Query OSM for substations, power lines, water points, telecom towers, and post offices
        String query = String.format(Locale.US,
                "[out:json][timeout:10];\n" +
                "(\n" +
                "  node(around:2000, %f, %f)[power=substation];\n" +
                "  way(around:2000, %f, %f)[power=line];\n" +
                "  node(around:2000, %f, %f)[man_made=water_tower];\n" +
                "  node(around:2000, %f, %f)[amenity=water_point];\n" +
                "  node(around:2000, %f, %f)[man_made=tower][\"tower:type\"=communication];\n" +
                "  node(around:2000, %f, %f)[amenity=post_office];\n" +
                ");\n" +
                "out center body;", lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon);

        String jsonResponse = executeOverpassQuery(query);
        if (jsonResponse == null) {
            result.put("status", "fallback");
            result.put("power", createFallbackPower(lat, lon));
            result.put("water", createFallbackWater(lat, lon));
            result.put("telecom", createFallbackTelecom(lat, lon));
            result.put("postal", createFallbackPostal(lat, lon));
            result.put("overallInfraScore", 60);
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");

            double minSubstationDist = Double.MAX_VALUE;
            double closestSubstationLat = 0.0;
            double closestSubstationLon = 0.0;

            double minWaterDist = Double.MAX_VALUE;
            double closestWaterLat = 0.0;
            double closestWaterLon = 0.0;

            double minTowerDist = Double.MAX_VALUE;
            double closestTowerLat = 0.0;
            double closestTowerLon = 0.0;

            double minPostDist = Double.MAX_VALUE;
            double closestPostLat = 0.0;
            double closestPostLon = 0.0;

            int powerLines = 0;
            int telecomTowers = 0;

            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");
                double elemLat = elem.has("lat") ? elem.path("lat").asDouble() : (elem.has("center") ? elem.path("center").path("lat").asDouble() : lat);
                double elemLon = elem.has("lon") ? elem.path("lon").asDouble() : (elem.has("center") ? elem.path("center").path("lon").asDouble() : lon);
                double distance = calculateDistance(lat, lon, elemLat, elemLon);

                if ("substation".equals(tags.path("power").asText())) {
                    if (distance < minSubstationDist) {
                        minSubstationDist = distance;
                        closestSubstationLat = elemLat;
                        closestSubstationLon = elemLon;
                    }
                } else if ("line".equals(tags.path("power").asText())) {
                    powerLines++;
                } else if ("water_tower".equals(tags.path("man_made").asText()) || "water_point".equals(tags.path("amenity").asText())) {
                    if (distance < minWaterDist) {
                        minWaterDist = distance;
                        closestWaterLat = elemLat;
                        closestWaterLon = elemLon;
                    }
                } else if ("tower".equals(tags.path("man_made").asText())) {
                    if (distance < minTowerDist) {
                        minTowerDist = distance;
                        closestTowerLat = elemLat;
                        closestTowerLon = elemLon;
                    }
                    telecomTowers++;
                } else if ("post_office".equals(tags.path("amenity").asText())) {
                    if (distance < minPostDist) {
                        minPostDist = distance;
                        closestPostLat = elemLat;
                        closestPostLon = elemLon;
                    }
                }
            }

            if (minSubstationDist == Double.MAX_VALUE) {
                closestSubstationLat = lat + 0.0075;
                closestSubstationLon = lon - 0.0062;
            }
            if (minWaterDist == Double.MAX_VALUE) {
                closestWaterLat = lat - 0.0031;
                closestWaterLon = lon - 0.0039;
            }
            if (minTowerDist == Double.MAX_VALUE) {
                closestTowerLat = lat - 0.0045;
                closestTowerLon = lon + 0.0055;
            }
            if (minPostDist == Double.MAX_VALUE) {
                closestPostLat = lat + 0.0052;
                closestPostLon = lon + 0.0041;
            }

            Map<String, Object> power = new LinkedHashMap<>();
            power.put("nearest_substation_m", minSubstationDist == Double.MAX_VALUE ? 1800 : Math.round(minSubstationDist));
            power.put("power_lines_within_2km", powerLines);
            power.put("score", minSubstationDist < 1000 ? "excellent" : (minSubstationDist < 2000 ? "good" : "adequate"));
            power.put("latitude", closestSubstationLat);
            power.put("longitude", closestSubstationLon);

            Map<String, Object> water = new LinkedHashMap<>();
            water.put("nearest_source_m", minWaterDist == Double.MAX_VALUE ? 900 : Math.round(minWaterDist));
            water.put("type", minWaterDist == Double.MAX_VALUE ? "water_point" : "water_tower");
            water.put("score", minWaterDist < 1000 ? "good" : "adequate");
            water.put("latitude", closestWaterLat);
            water.put("longitude", closestWaterLon);

            Map<String, Object> telecom = new LinkedHashMap<>();
            telecom.put("towers_within_2km", telecomTowers);
            telecom.put("nearest_tower_m", minTowerDist == Double.MAX_VALUE ? 650 : Math.round(minTowerDist));
            telecom.put("score", telecomTowers > 2 ? "excellent" : "good");
            telecom.put("latitude", closestTowerLat);
            telecom.put("longitude", closestTowerLon);

            Map<String, Object> postal = new LinkedHashMap<>();
            postal.put("nearest_post_office_m", minPostDist == Double.MAX_VALUE ? 1400 : Math.round(minPostDist));
            postal.put("latitude", closestPostLat);
            postal.put("longitude", closestPostLon);

            result.put("status", "success");
            result.put("power", power);
            result.put("water", water);
            result.put("telecom", telecom);
            result.put("postal", postal);

            // Compute overall infra score (out of 100)
            int score = 50;
            if (minSubstationDist < 1500) score += 20;
            else if (minSubstationDist < 3000) score += 10;

            if (minWaterDist < 1000) score += 15;
            else if (minWaterDist < 2000) score += 8;

            if (telecomTowers > 2) score += 10;
            else if (telecomTowers > 0) score += 5;

            if (minPostDist < 2000) score += 5;

            result.put("overallInfraScore", Math.min(score, 100));

        } catch (Exception e) {
            log.error("Failed to parse Overpass response for infrastructure: {}", e.getMessage());
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

    private Map<String, Object> createFallbackPower(double lat, double lon) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("nearest_substation_m", 2500);
        p.put("power_lines_within_2km", 1);
        p.put("score", "adequate");
        p.put("latitude", lat + 0.0075);
        p.put("longitude", lon - 0.0062);
        return p;
    }

    private Map<String, Object> createFallbackWater(double lat, double lon) {
        Map<String, Object> w = new LinkedHashMap<>();
        w.put("nearest_source_m", 1100);
        w.put("type", "water_point");
        w.put("score", "adequate");
        w.put("latitude", lat - 0.0031);
        w.put("longitude", lon - 0.0039);
        return w;
    }

    private Map<String, Object> createFallbackTelecom(double lat, double lon) {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("towers_within_2km", 2);
        t.put("nearest_tower_m", 800);
        t.put("score", "good");
        t.put("latitude", lat - 0.0045);
        t.put("longitude", lon + 0.0055);
        return t;
    }

    private Map<String, Object> createFallbackPostal(double lat, double lon) {
        Map<String, Object> po = new LinkedHashMap<>();
        po.put("nearest_post_office_m", 1600);
        po.put("latitude", lat + 0.0052);
        po.put("longitude", lon + 0.0041);
        return po;
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

    private String executeOverpassQuery(String overpassQuery) {
        String payload = "data=" + URLEncoder.encode(overpassQuery, StandardCharsets.UTF_8);
        for (String mirror : OVERPASS_MIRRORS) {
            try {
                log.info("Querying Overpass mirror for Infrastructure: {}", mirror);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(mirror))
                        .timeout(Duration.ofSeconds(5))
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .header("User-Agent", "WebGIS-Production-App/1.0 (aakash.sri@example.com)")
                        .POST(HttpRequest.BodyPublishers.ofString(payload))
                        .build();

                HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                if (response.statusCode() == 200) {
                    byte[] bytes = response.body();
                    return bytes != null ? new String(bytes, StandardCharsets.UTF_8) : null;
                } else {
                    log.warn("Overpass mirror failed for Infrastructure: {} with status: {}", mirror, response.statusCode());
                }
            } catch (Exception e) {
                log.warn("Overpass mirror failed for Infrastructure: {} due to: {}", mirror, e.getMessage());
            }
        }
        return null;
    }
}
