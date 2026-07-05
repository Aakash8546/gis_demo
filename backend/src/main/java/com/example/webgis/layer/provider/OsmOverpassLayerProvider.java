package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class OsmOverpassLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final OverpassQueryService overpassQueryService;

    public OsmOverpassLayerProvider(OverpassQueryService overpassQueryService) {
        this.overpassQueryService = overpassQueryService;
    }

    @Override
    public String getLayerId() {
        return "osm-vector";
    }

    @Override
    public String getLayerName() {
        return "OpenStreetMap Vector Layer";
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
            result.put("status", "error");
            result.put("message", "All Overpass API mirrors failed to respond");
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");
            
            List<Map<String, String>> amenities = new ArrayList<>();
            List<String> roads = new ArrayList<>();
            List<String> waterways = new ArrayList<>();

            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");

                boolean isOsm = tags.has("amenity") || tags.has("highway") || tags.has("waterway");
                if (!isOsm) {
                    continue;
                }

                String name = tags.path("name").asText("Unnamed");
                
                if (tags.has("amenity")) {
                    Map<String, String> am = new HashMap<>();
                    am.put("name", name);
                    am.put("type", tags.path("amenity").asText());
                    amenities.add(am);
                } else if (tags.has("highway")) {
                    if (!roads.contains(name) && !name.equals("Unnamed")) {
                        roads.add(name);
                    }
                } else if (tags.has("waterway")) {
                    if (!waterways.contains(name) && !name.equals("Unnamed")) {
                        waterways.add(name);
                    }
                }
            }

            result.put("amenitiesCount", amenities.size());
            result.put("amenities", amenities);
            result.put("roads", roads);
            result.put("waterways", waterways);
            result.put("status", "success");

        } catch (Exception e) {
            log.error("Failed to parse Overpass response: {}", e.getMessage());
            result.put("status", "error");
            result.put("message", "JSON parse error: " + e.getMessage());
        }

        return result;
    }

    @Override
    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (coordinates == null || coordinates.isEmpty()) {
            result.put("status", "error");
            result.put("message", "Invalid polygon coordinates");
            return result;
        }

        // Generate polygon string for Overpass: "lat1 lon1 lat2 lon2 ..."
        List<List<Double>> outerRing = coordinates.get(0);
        StringBuilder polyBuilder = new StringBuilder();
        for (List<Double> pt : outerRing) {
            polyBuilder.append(String.format(Locale.US, "%f %f ", pt.get(1), pt.get(0)));
        }
        String polyStr = polyBuilder.toString().trim();

        String jsonResponse = overpassQueryService.getUnifiedPolygonData(polyStr);
        if (jsonResponse == null) {
            result.put("status", "error");
            result.put("message", "All Overpass API mirrors failed to respond");
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");

            int schools = 0;
            int hospitals = 0;
            int restaurants = 0;
            List<String> roadNames = new ArrayList<>();
            List<Map<String, String>> otherAmenities = new ArrayList<>();

            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");

                boolean isOsm = tags.has("amenity") || tags.has("highway") || tags.has("waterway");
                if (!isOsm) {
                    continue;
                }

                String name = tags.path("name").asText("Unnamed");

                if (tags.has("amenity")) {
                    String type = tags.path("amenity").asText();
                    if ("school".equalsIgnoreCase(type) || "college".equalsIgnoreCase(type) || "university".equalsIgnoreCase(type)) {
                        schools++;
                    } else if ("hospital".equalsIgnoreCase(type) || "clinic".equalsIgnoreCase(type)) {
                        hospitals++;
                    } else if ("restaurant".equalsIgnoreCase(type) || "cafe".equalsIgnoreCase(type) || "fast_food".equalsIgnoreCase(type)) {
                        restaurants++;
                    } else {
                        Map<String, String> item = new HashMap<>();
                        item.put("name", name);
                        item.put("type", type);
                        otherAmenities.add(item);
                    }
                } else if (tags.has("highway")) {
                    if (!roadNames.contains(name) && !name.equals("Unnamed")) {
                        roadNames.add(name);
                    }
                }
            }

            result.put("schoolsCount", schools);
            result.put("hospitalsCount", hospitals);
            result.put("foodCount", restaurants);
            result.put("roadList", roadNames);
            result.put("otherAmenities", otherAmenities);
            result.put("totalDiscoveredFeatures", elements.size());
            result.put("status", "success");

        } catch (Exception e) {
            log.error("Failed to parse Overpass response: {}", e.getMessage());
            result.put("status", "error");
            result.put("message", "JSON parse error: " + e.getMessage());
        }

        return result;
    }
}
