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
public class MarketCompetitionLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient;

    private static final String[] OVERPASS_MIRRORS = {
            "https://overpass-api.de/api/interpreter",
            "https://lz4.overpass-api.de/api/interpreter",
            "https://z.overpass-api.de/api/interpreter"
    };

    public MarketCompetitionLayerProvider() {
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .build();
    }

    @Override
    public String getLayerId() {
        return "market-competition";
    }

    @Override
    public String getLayerName() {
        return "Market & Competition Analysis";
    }

    @Override
    public boolean isRaster() {
        return false;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();

        // Query OSM for wholesale shops, beverages, supermarkets, convenience stores, warehouses, and cold storage
        String query = String.format(Locale.US,
                "[out:json][timeout:10];\n" +
                "(\n" +
                "  node(around:5000, %f, %f)[shop=wholesale];\n" +
                "  node(around:5000, %f, %f)[shop=beverages];\n" +
                "  node(around:3000, %f, %f)[shop=supermarket];\n" +
                "  node(around:2000, %f, %f)[shop=convenience];\n" +
                "  node(around:5000, %f, %f)[building=warehouse];\n" +
                "  way(around:5000, %f, %f)[building=warehouse];\n" +
                "  node(around:5000, %f, %f)[industrial=warehouse];\n" +
                "  node(around:5000, %f, %f)[amenity=cold_storage];\n" +
                ");\n" +
                "out center body;", lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon, lat, lon);

        String jsonResponse = executeOverpassQuery(query);
        if (jsonResponse == null) {
            result.put("status", "fallback");
            result.put("retailDensity", createFallbackRetailDensity());
            result.put("supplyChainNodes", createFallbackSupplyChainNodes());
            result.put("competitorPresence", createFallbackCompetitors());
            result.put("marketSaturationIndex", 0.40);
            result.put("marketOpportunity", "moderate_opportunity");
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");

            int wholesale = 0;
            int beverages = 0;
            int supermarket = 0;
            int convenience = 0;
            int warehouse = 0;
            int coldStorage = 0;

            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");
                String shop = tags.path("shop").asText();
                String building = tags.path("building").asText();
                String industrial = tags.path("industrial").asText();
                String amenity = tags.path("amenity").asText();

                if ("wholesale".equals(shop)) wholesale++;
                else if ("beverages".equals(shop)) beverages++;
                else if ("supermarket".equals(shop)) supermarket++;
                else if ("convenience".equals(shop)) convenience++;
                
                if ("warehouse".equals(building) || "warehouse".equals(industrial)) warehouse++;
                
                if ("cold_storage".equals(amenity)) coldStorage++;
            }

            Map<String, Object> retailDensity = new LinkedHashMap<>();
            int totalShops = supermarket + convenience + wholesale;
            retailDensity.put("shops_per_sqkm", Math.max(totalShops / 4, 1));
            retailDensity.put("classification", totalShops > 15 ? "high" : (totalShops > 5 ? "moderate" : "low"));

            Map<String, Integer> supplyChainNodes = new LinkedHashMap<>();
            supplyChainNodes.put("warehouses", warehouse);
            supplyChainNodes.put("wholesaleMarkets", wholesale);
            supplyChainNodes.put("coldStorage", coldStorage);
            supplyChainNodes.put("supermarkets", supermarket);
            supplyChainNodes.put("convenienceStores", convenience);

            Map<String, Integer> competitorPresence = new LinkedHashMap<>();
            competitorPresence.put("beverageDistributors", beverages);
            competitorPresence.put("fmcgWarehouses", Math.max(warehouse / 2, 0));

            result.put("status", "success");
            result.put("retailDensity", retailDensity);
            result.put("supplyChainNodes", supplyChainNodes);
            result.put("competitorPresence", competitorPresence);

            // Compute index
            double saturation = 0.1;
            if (beverages > 2 || warehouse > 4) saturation += 0.4;
            else if (beverages > 0 || warehouse > 1) saturation += 0.2;
            if (convenience > 10) saturation += 0.2;
            result.put("marketSaturationIndex", saturation);

            String opp = "high_opportunity";
            if (saturation > 0.6) opp = "saturated_market";
            else if (saturation > 0.3) opp = "moderate_opportunity";
            result.put("marketOpportunity", opp);

        } catch (Exception e) {
            log.error("Failed to parse Overpass response for market-competition: {}", e.getMessage());
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

    private Map<String, Object> createFallbackRetailDensity() {
        Map<String, Object> rd = new LinkedHashMap<>();
        rd.put("shops_per_sqkm", 20);
        rd.put("classification", "moderate");
        return rd;
    }

    private Map<String, Integer> createFallbackSupplyChainNodes() {
        Map<String, Integer> sc = new LinkedHashMap<>();
        sc.put("warehouses", 1);
        sc.put("wholesaleMarkets", 1);
        sc.put("coldStorage", 0);
        sc.put("supermarkets", 2);
        sc.put("convenienceStores", 8);
        return sc;
    }

    private Map<String, Integer> createFallbackCompetitors() {
        Map<String, Integer> c = new LinkedHashMap<>();
        c.put("beverageDistributors", 1);
        c.put("fmcgWarehouses", 1);
        return c;
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
                log.info("Querying Overpass mirror for MarketCompetition: {}", mirror);
                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(mirror))
                        .timeout(Duration.ofSeconds(5))
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .header("User-Agent", "VaranasiUrbanPlannerApp/1.0 (Contact: aakashsrivastava8546@gmail.com)")
                        .POST(HttpRequest.BodyPublishers.ofString(payload))
                        .build();

                HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
                if (response.statusCode() == 200) {
                    byte[] bytes = response.body();
                    return bytes != null ? new String(bytes, StandardCharsets.UTF_8) : null;
                } else {
                    log.warn("Overpass mirror failed for MarketCompetition: {} with status: {}", mirror, response.statusCode());
                }
            } catch (Exception e) {
                log.warn("Overpass mirror failed for MarketCompetition: {} due to: {}", mirror, e.getMessage());
            }
        }
        return null;
    }
}
