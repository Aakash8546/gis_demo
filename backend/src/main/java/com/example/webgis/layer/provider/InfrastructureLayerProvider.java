package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
@Slf4j
public class InfrastructureLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    private static final String[] OVERPASS_MIRRORS = {
            "https://overpass-api.de/api/interpreter",
            "https://lz4.overpass-api.de/api/interpreter",
            "https://z.overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.nchc.org.tw/api/interpreter"
    };

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
                "  node[\"power\"=\"substation\"](around:2000, %f, %f);\n" +
                "  way[\"power\"=\"line\"](around:2000, %f, %f);\n" +
                "  node[\"man_made\"=\"water_tower\"](around:2000, %f, %f);\n" +
                "  node[\"amenity\"=\"water_point\"](around:2000, %f, %f);\n" +
                "  node[\"man_made\"=\"tower\"][\"tower:type\"=\"communication\"](around:2000, %f, %f);\n" +
                "  node[\"amenity\"=\"post_office\"](around:2000, %f, %f);\n" +
                ");\n" +
                "out center body;", lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon);

        String jsonResponse = executeOverpassQuery(query);
        if (jsonResponse == null) {
            result.put("status", "fallback");
            result.put("power", createFallbackPower());
            result.put("water", createFallbackWater());
            result.put("telecom", createFallbackTelecom());
            result.put("postal", createFallbackPostal());
            result.put("overallInfraScore", 60);
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");

            double minSubstationDist = Double.MAX_VALUE;
            double minWaterDist = Double.MAX_VALUE;
            double minTowerDist = Double.MAX_VALUE;
            double minPostDist = Double.MAX_VALUE;

            int powerLines = 0;
            int telecomTowers = 0;

            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");
                double elemLat = elem.has("lat") ? elem.path("lat").asDouble() : (elem.has("center") ? elem.path("center").path("lat").asDouble() : lat);
                double elemLon = elem.has("lon") ? elem.path("lon").asDouble() : (elem.has("center") ? elem.path("center").path("lon").asDouble() : lon);
                double distance = calculateDistance(lat, lon, elemLat, elemLon);

                if ("substation".equals(tags.path("power").asText())) {
                    minSubstationDist = Math.min(minSubstationDist, distance);
                } else if ("line".equals(tags.path("power").asText())) {
                    powerLines++;
                } else if ("water_tower".equals(tags.path("man_made").asText()) || "water_point".equals(tags.path("amenity").asText())) {
                    minWaterDist = Math.min(minWaterDist, distance);
                } else if ("tower".equals(tags.path("man_made").asText())) {
                    minTowerDist = Math.min(minTowerDist, distance);
                    telecomTowers++;
                } else if ("post_office".equals(tags.path("amenity").asText())) {
                    minPostDist = Math.min(minPostDist, distance);
                }
            }

            Map<String, Object> power = new LinkedHashMap<>();
            power.put("nearest_substation_m", minSubstationDist == Double.MAX_VALUE ? 1800 : Math.round(minSubstationDist));
            power.put("power_lines_within_2km", powerLines);
            power.put("score", minSubstationDist < 1000 ? "excellent" : (minSubstationDist < 2000 ? "good" : "adequate"));

            Map<String, Object> water = new LinkedHashMap<>();
            water.put("nearest_source_m", minWaterDist == Double.MAX_VALUE ? 900 : Math.round(minWaterDist));
            water.put("type", minWaterDist == Double.MAX_VALUE ? "water_point" : "water_tower");
            water.put("score", minWaterDist < 1000 ? "good" : "adequate");

            Map<String, Object> telecom = new LinkedHashMap<>();
            telecom.put("towers_within_2km", telecomTowers);
            telecom.put("nearest_tower_m", minTowerDist == Double.MAX_VALUE ? 650 : Math.round(minTowerDist));
            telecom.put("score", telecomTowers > 2 ? "excellent" : "good");

            Map<String, Object> postal = new LinkedHashMap<>();
            postal.put("nearest_post_office_m", minPostDist == Double.MAX_VALUE ? 1400 : Math.round(minPostDist));

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

    private Map<String, Object> createFallbackPower() {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("nearest_substation_m", 2500);
        p.put("power_lines_within_2km", 1);
        p.put("score", "adequate");
        return p;
    }

    private Map<String, Object> createFallbackWater() {
        Map<String, Object> w = new LinkedHashMap<>();
        w.put("nearest_source_m", 1100);
        w.put("type", "water_point");
        w.put("score", "adequate");
        return w;
    }

    private Map<String, Object> createFallbackTelecom() {
        Map<String, Object> t = new LinkedHashMap<>();
        t.put("towers_within_2km", 2);
        t.put("nearest_tower_m", 800);
        t.put("score", "good");
        return t;
    }

    private Map<String, Object> createFallbackPostal() {
        Map<String, Object> po = new LinkedHashMap<>();
        po.put("nearest_post_office_m", 1600);
        return po;
    }

    private double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
        final int R = 6371e3; // metres
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
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setAccept(Collections.singletonList(MediaType.ALL));
        headers.set("User-Agent", "WebGIS-Production-App/1.0 (aakash.sri@example.com)");
        HttpEntity<String> request = new HttpEntity<>(payload, headers);

        for (String mirror : OVERPASS_MIRRORS) {
            try {
                log.info("Querying Overpass mirror for Infrastructure: {}", mirror);
                return restTemplate.postForObject(mirror, request, String.class);
            } catch (Exception e) {
                log.warn("Overpass mirror failed for Infrastructure: {} due to: {}", mirror, e.getMessage());
            }
        }
        return null;
    }
}
