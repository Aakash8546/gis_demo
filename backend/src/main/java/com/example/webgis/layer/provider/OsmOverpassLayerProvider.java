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
public class OsmOverpassLayerProvider implements GisLayerProvider {

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
        
        // Overpass QL query to find amenities, highways, and waterways within 500m around coordinate
        String query = String.format(Locale.US,
                "[out:json][timeout:5];\n" +
                "(\n" +
                "  node(around:500, %f, %f)[\"amenity\"];\n" +
                "  way(around:500, %f, %f)[\"amenity\"];\n" +
                "  way(around:500, %f, %f)[\"highway\"];\n" +
                "  way(around:500, %f, %f)[\"waterway\"];\n" +
                ");\n" +
                "out tags;", lat, lon, lat, lon, lat, lon, lat, lon);

        String jsonResponse = executeOverpassQuery(query);
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

        // Query Overpass to retrieve elements within the polygon boundary
        String query = String.format(Locale.US,
                "[out:json][timeout:8];\n" +
                "(\n" +
                "  node(poly: \"%s\")[\"amenity\"];\n" +
                "  way(poly: \"%s\")[\"amenity\"];\n" +
                "  way(poly: \"%s\")[\"highway\"];\n" +
                "  way(poly: \"%s\")[\"waterway\"];\n" +
                ");\n" +
                "out tags;", polyStr, polyStr, polyStr, polyStr);

        String jsonResponse = executeOverpassQuery(query);
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

    private String executeOverpassQuery(String overpassQuery) {
        String payload = "data=" + URLEncoder.encode(overpassQuery, StandardCharsets.UTF_8);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setAccept(Collections.singletonList(MediaType.ALL));
        headers.set("User-Agent", "WebGIS-Production-App/1.0 (aakash.sri@example.com)");
        HttpEntity<String> request = new HttpEntity<>(payload, headers);

        for (String mirror : OVERPASS_MIRRORS) {
            try {
                log.info("Querying Overpass mirror: {}", mirror);
                return restTemplate.postForObject(mirror, request, String.class);
            } catch (Exception e) {
                log.warn("Overpass mirror failed: {} due to: {}", mirror, e.getMessage());
            }
        }
        return null;
    }
}
