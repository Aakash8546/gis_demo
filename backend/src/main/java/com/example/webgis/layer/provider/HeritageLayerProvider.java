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
public class HeritageLayerProvider implements GisLayerProvider {

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
        return "heritage-sites";
    }

    @Override
    public String getLayerName() {
        return "Historic Heritage & Tourism Sites";
    }

    @Override
    public boolean isRaster() {
        return false;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();

        // Find heritage/historic/ghats nodes/ways within 1km around the coordinate
        String query = String.format(Locale.US,
                "[out:json][timeout:6];\n" +
                "(\n" +
                "  node(around:1000, %f, %f)[\"historic\"];\n" +
                "  way(around:1000, %f, %f)[\"historic\"];\n" +
                "  node(around:1000, %f, %f)[\"man_made\"=\"ghat\"];\n" +
                "  way(around:1000, %f, %f)[\"man_made\"=\"ghat\"];\n" +
                "  node(around:1000, %f, %f)[\"tourism\"=\"attraction\"];\n" +
                "  way(around:1000, %f, %f)[\"tourism\"=\"attraction\"];\n" +
                "  node(around:1000, %f, %f)[\"place\"=\"ghat\"];\n" +
                "  node(around:1000, %f, %f)[\"tourism\"=\"ghat\"];\n" +
                ");\n" +
                "out tags;", 
                lat, lon, 
                lat, lon, 
                lat, lon, 
                lat, lon, 
                lat, lon, 
                lat, lon, 
                lat, lon, 
                lat, lon);

        log.info("Executing Heritage & Ghats Overpass query around point: {}, {}", lat, lon);
        String jsonResponse = executeOverpassQuery(query);
        if (jsonResponse == null) {
            result.put("status", "fallback");
            result.put("heritageCount", 0);
            result.put("sites", new ArrayList<>());
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");
            
            List<Map<String, String>> sites = new ArrayList<>();
            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");
                String name = tags.path("name").asText("");
                if (!name.isEmpty() && !name.equals("Unnamed")) {
                    Map<String, String> site = new HashMap<>();
                    site.put("name", name);
                    
                    String type = "Heritage Site";
                    if (tags.has("historic")) {
                        type = tags.path("historic").asText();
                    } else if (tags.has("man_made") && "ghat".equals(tags.path("man_made").asText())) {
                        type = "Ghat";
                    } else if (tags.has("place") && "ghat".equals(tags.path("place").asText())) {
                        type = "Ghat";
                    } else if (tags.has("tourism")) {
                        type = tags.path("tourism").asText();
                    }
                    site.put("type", type);
                    
                    // Prevent duplicate names in list
                    boolean duplicate = false;
                    for (Map<String, String> existing : sites) {
                        if (existing.get("name").equalsIgnoreCase(name)) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) {
                        sites.add(site);
                    }
                }
            }

            result.put("heritageCount", sites.size());
            result.put("sites", sites);
            result.put("status", "success");

        } catch (Exception e) {
            log.error("Failed to parse heritage Overpass response: {}", e.getMessage());
            result.put("status", "error");
            result.put("message", e.getMessage());
        }

        return result;
    }

    @Override
    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        if (coordinates == null || coordinates.isEmpty()) {
            return Collections.singletonMap("status", "error");
        }
        List<List<Double>> outerRing = coordinates.get(0);
        StringBuilder polyBuilder = new StringBuilder();
        for (List<Double> pt : outerRing) {
            polyBuilder.append(String.format(Locale.US, "%f %f ", pt.get(1), pt.get(0)));
        }
        String polyStr = polyBuilder.toString().trim();

        String query = String.format(Locale.US,
                "[out:json][timeout:8];\n" +
                "(\n" +
                "  node(poly: \"%s\")[\"historic\"];\n" +
                "  way(poly: \"%s\")[\"historic\"];\n" +
                "  node(poly: \"%s\")[\"man_made\"=\"ghat\"];\n" +
                "  way(poly: \"%s\")[\"man_made\"=\"ghat\"];\n" +
                "  node(poly: \"%s\")[\"tourism\"=\"attraction\"];\n" +
                "  way(poly: \"%s\")[\"tourism\"=\"attraction\"];\n" +
                "  node(poly: \"%s\")[\"place\"=\"ghat\"];\n" +
                "  node(poly: \"%s\")[\"tourism\"=\"ghat\"];\n" +
                ");\n" +
                "out tags;", polyStr, polyStr, polyStr, polyStr, polyStr, polyStr, polyStr, polyStr);

        String jsonResponse = executeOverpassQuery(query);
        Map<String, Object> result = new LinkedHashMap<>();
        if (jsonResponse == null) {
            result.put("status", "error");
            return result;
        }

        try {
            JsonNode root = objectMapper.readTree(jsonResponse);
            JsonNode elements = root.path("elements");
            
            List<Map<String, String>> sites = new ArrayList<>();
            for (JsonNode elem : elements) {
                JsonNode tags = elem.path("tags");
                String name = tags.path("name").asText("");
                if (!name.isEmpty() && !name.equals("Unnamed")) {
                    Map<String, String> site = new HashMap<>();
                    site.put("name", name);
                    
                    String type = "Heritage Site";
                    if (tags.has("historic")) {
                        type = tags.path("historic").asText();
                    } else if (tags.has("man_made") && "ghat".equals(tags.path("man_made").asText())) {
                        type = "Ghat";
                    } else if (tags.has("place") && "ghat".equals(tags.path("place").asText())) {
                        type = "Ghat";
                    } else if (tags.has("tourism")) {
                        type = tags.path("tourism").asText();
                    }
                    site.put("type", type);
                    
                    boolean duplicate = false;
                    for (Map<String, String> existing : sites) {
                        if (existing.get("name").equalsIgnoreCase(name)) {
                            duplicate = true;
                            break;
                        }
                    }
                    if (!duplicate) {
                        sites.add(site);
                    }
                }
            }
            result.put("heritageCount", sites.size());
            result.put("sites", sites);
            result.put("status", "success");
        } catch (Exception e) {
            result.put("status", "error");
        }
        return result;
    }

    private String executeOverpassQuery(String overpassQuery) {
        String payload = "data=" + URLEncoder.encode(overpassQuery, StandardCharsets.UTF_8);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setAccept(Collections.singletonList(MediaType.ALL));
        headers.set("User-Agent", "WebGIS-Production-App/1.0");
        HttpEntity<String> request = new HttpEntity<>(payload, headers);

        for (String mirror : OVERPASS_MIRRORS) {
            try {
                return restTemplate.postForObject(mirror, request, String.class);
            } catch (Exception e) {
                log.warn("Overpass mirror failed: {}", mirror);
            }
        }
        return null;
    }
}
