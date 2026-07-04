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
public class CommercialPoiLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient;

    private static final String[] OVERPASS_MIRRORS = {
            "https://overpass-api.de/api/interpreter",
            "https://lz4.overpass-api.de/api/interpreter",
            "https://z.overpass-api.de/api/interpreter"
    };

    public CommercialPoiLayerProvider() {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
    }

    @Override
    public String getLayerId() {
        return "commercial-poi";
    }

    @Override
    public String getLayerName() {
        return "Commercial & Industrial POIs";
    }

    @Override
    public boolean isRaster() {
        return false;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();

        String query = String.format(Locale.US,
                "[out:json][timeout:10];\n" +
                "(\n" +
                "  node(around:2000, %f, %f)[shop];\n" +
                "  node(around:2000, %f, %f)[office];\n" +
                "  node(around:2000, %f, %f)[industrial];\n" +
                "  node(around:2000, %f, %f)[building=warehouse];\n" +
                "  node(around:2000, %f, %f)[amenity=fuel];\n" +
                "  node(around:2000, %f, %f)[amenity=bank];\n" +
                "  node(around:2000, %f, %f)[amenity=marketplace];\n" +
                "  way(around:2000, %f, %f)[building=warehouse];\n" +
                "  way(around:2000, %f, %f)[landuse=industrial];\n" +
                ");\n" +
                "out center body;", lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon);

        String jsonResponse = executeOverpassQuery(query);
        if (jsonResponse == null) {
            result.put("status", "fallback");
            result.put("totalPoisFound", 0);
            result.put("commercialDensity", "low");
            result.put("categories", createEmptyCategories());
            result.put("nearestPois", Collections.emptyList());
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");

            int shopCount = 0;
            int officeCount = 0;
            int industrialCount = 0;
            int warehouseCount = 0;
            int fuelCount = 0;
            int bankCount = 0;
            int marketplaceCount = 0;
            int otherCount = 0;

            List<Map<String, Object>> nearestPois = new ArrayList<>();

            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");
                String name = tags.path("name").asText("Unnamed Business");
                
                String primaryType = "other_commercial";
                if (tags.has("shop")) {
                    shopCount++;
                    primaryType = "shop";
                } else if (tags.has("office")) {
                    officeCount++;
                    primaryType = "office";
                } else if (tags.has("industrial") || "industrial".equals(tags.path("landuse").asText())) {
                    industrialCount++;
                    primaryType = "industrial";
                } else if ("warehouse".equals(tags.path("building").asText())) {
                    warehouseCount++;
                    primaryType = "warehouse";
                } else if ("fuel".equals(tags.path("amenity").asText())) {
                    fuelCount++;
                    primaryType = "fuel_station";
                } else if ("bank".equals(tags.path("amenity").asText()) || "atm".equals(tags.path("amenity").asText())) {
                    bankCount++;
                    primaryType = "bank_atm";
                } else if ("marketplace".equals(tags.path("amenity").asText())) {
                    marketplaceCount++;
                    primaryType = "marketplace";
                } else {
                    otherCount++;
                }

                // Compute distance if coordinates are present
                double poiLat = elem.has("lat") ? elem.path("lat").asDouble() : (elem.has("center") ? elem.path("center").path("lat").asDouble() : lat);
                double poiLon = elem.has("lon") ? elem.path("lon").asDouble() : (elem.has("center") ? elem.path("center").path("lon").asDouble() : lon);
                double distance = calculateDistance(lat, lon, poiLat, poiLon);

                Map<String, Object> poi = new LinkedHashMap<>();
                poi.put("name", name);
                poi.put("type", primaryType);
                poi.put("distance_m", Math.round(distance));
                poi.put("lat", poiLat);
                poi.put("lon", poiLon);
                nearestPois.add(poi);
            }

            // Sort by distance and limit to top 20
            nearestPois.sort(Comparator.comparingDouble(o -> {
                Object dist = o.get("distance_m");
                if (dist instanceof Long) return ((Long) dist).doubleValue();
                return ((Double) dist);
            }));
            if (nearestPois.size() > 20) {
                nearestPois = nearestPois.subList(0, 20);
            }

            int total = elements.size();
            String density = "low";
            if (total > 30) density = "high";
            else if (total > 10) density = "moderate";

            result.put("status", "success");
            result.put("totalPoisFound", total);
            result.put("commercialDensity", density);
            
            Map<String, Integer> categories = new LinkedHashMap<>();
            categories.put("shop", shopCount);
            categories.put("office", officeCount);
            categories.put("industrial", industrialCount);
            categories.put("warehouse", warehouseCount);
            categories.put("fuel_station", fuelCount);
            categories.put("bank_atm", bankCount);
            categories.put("marketplace", marketplaceCount);
            categories.put("other_commercial", otherCount);
            result.put("categories", categories);
            
            result.put("nearestPois", nearestPois);

            Map<String, Integer> competitorAnalysis = new LinkedHashMap<>();
            competitorAnalysis.put("distributionCenters", 0);
            competitorAnalysis.put("warehouses", warehouseCount);
            competitorAnalysis.put("logisticsHubs", industrialCount > 2 ? 1 : 0);
            result.put("competitorAnalysis", competitorAnalysis);

        } catch (Exception e) {
            log.error("Failed to parse Overpass response for commercial-poi: {}", e.getMessage());
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

    private Map<String, Integer> createEmptyCategories() {
        Map<String, Integer> categories = new LinkedHashMap<>();
        categories.put("shop", 0);
        categories.put("office", 0);
        categories.put("industrial", 0);
        categories.put("warehouse", 0);
        categories.put("fuel_station", 0);
        categories.put("bank_atm", 0);
        categories.put("marketplace", 0);
        categories.put("other_commercial", 0);
        return categories;
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
                log.info("Querying Overpass mirror for CommercialPoi: {}", mirror);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(mirror))
                        .timeout(Duration.ofSeconds(5))
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .header("User-Agent", "VaranasiUrbanPlannerApp/1.0 (Contact: aakashsrivastava2151@gmail.com)")
                        .POST(HttpRequest.BodyPublishers.ofString(payload))
                        .build();

                HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                if (response.statusCode() == 200) {
                    byte[] bytes = response.body();
                    return bytes != null ? new String(bytes, StandardCharsets.UTF_8) : null;
                } else {
                    log.warn("Overpass mirror failed for CommercialPoi: {} with status: {}", mirror, response.statusCode());
                }
            } catch (Exception e) {
                log.warn("Overpass mirror failed for CommercialPoi: {} due to: {}", mirror, e.getMessage());
            }
        }
        return null;
    }
}
