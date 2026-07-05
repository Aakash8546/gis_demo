package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class MarketCompetitionLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final OverpassQueryService overpassQueryService;

    public MarketCompetitionLayerProvider(OverpassQueryService overpassQueryService) {
        this.overpassQueryService = overpassQueryService;
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

        String jsonResponse = overpassQueryService.getUnifiedPointData(lat, lon);
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

                boolean isMarket = "wholesale".equals(tags.path("shop").asText()) ||
                                   "beverages".equals(tags.path("shop").asText()) ||
                                   "supermarket".equals(tags.path("shop").asText()) ||
                                   "convenience".equals(tags.path("shop").asText()) ||
                                   "warehouse".equals(tags.path("building").asText()) ||
                                   "warehouse".equals(tags.path("industrial").asText()) ||
                                   "cold_storage".equals(tags.path("amenity").asText());
                if (!isMarket) {
                    continue;
                }

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
}
