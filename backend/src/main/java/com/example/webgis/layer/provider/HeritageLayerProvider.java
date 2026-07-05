package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class HeritageLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final OverpassQueryService overpassQueryService;

    public HeritageLayerProvider(OverpassQueryService overpassQueryService) {
        this.overpassQueryService = overpassQueryService;
    }

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

        log.info("Requesting Heritage & Ghats from Unified Query around point: {}, {}", lat, lon);
        String jsonResponse = overpassQueryService.getUnifiedPointData(lat, lon);
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

                boolean isHeritage = tags.has("historic") ||
                                     "ghat".equals(tags.path("man_made").asText()) ||
                                     "attraction".equals(tags.path("tourism").asText()) ||
                                     "ghat".equals(tags.path("place").asText()) ||
                                     "ghat".equals(tags.path("tourism").asText());
                if (!isHeritage) {
                    continue;
                }

                String name = tags.path("name").asText("");
                if (!name.isEmpty() && !name.equals("Unnamed")) {
                    Map<String, String> site = new HashMap<>();
                    site.put("name", name);
                    
                    double siteLat = lat;
                    double siteLon = lon;
                    if (elem.has("lat") && elem.has("lon")) {
                        siteLat = elem.path("lat").asDouble();
                        siteLon = elem.path("lon").asDouble();
                    } else if (elem.has("center")) {
                        siteLat = elem.path("center").path("lat").asDouble();
                        siteLon = elem.path("center").path("lon").asDouble();
                    }
                    site.put("lat", String.valueOf(siteLat));
                    site.put("lon", String.valueOf(siteLon));
                    
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

        String jsonResponse = overpassQueryService.getUnifiedPolygonData(polyStr);
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

                boolean isHeritage = tags.has("historic") ||
                                     "ghat".equals(tags.path("man_made").asText()) ||
                                     "attraction".equals(tags.path("tourism").asText()) ||
                                     "ghat".equals(tags.path("place").asText()) ||
                                     "ghat".equals(tags.path("tourism").asText());
                if (!isHeritage) {
                    continue;
                }

                String name = tags.path("name").asText("");
                if (!name.isEmpty() && !name.equals("Unnamed")) {
                    Map<String, String> site = new HashMap<>();
                    site.put("name", name);
                    
                    double siteLat = 0.0;
                    double siteLon = 0.0;
                    if (elem.has("lat") && elem.has("lon")) {
                        siteLat = elem.path("lat").asDouble();
                        siteLon = elem.path("lon").asDouble();
                    } else if (elem.has("center")) {
                        siteLat = elem.path("center").path("lat").asDouble();
                        siteLon = elem.path("center").path("lon").asDouble();
                    }
                    site.put("lat", String.valueOf(siteLat));
                    site.put("lon", String.valueOf(siteLon));
                    
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
}
