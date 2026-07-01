package com.example.webgis.layer.provider;

import com.example.webgis.layer.GisLayerProvider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.*;

@Service
@Slf4j
public class UsgsSeismicLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getLayerId() {
        return "usgs-seismic";
    }

    @Override
    public String getLayerName() {
        return "USGS Seismic & Geological Hazard Layer";
    }

    @Override
    public boolean isRaster() {
        return false;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();
        
        try {
            // Query USGS API for events within 200km radius in the last 30 days
            String url = String.format(Locale.US,
                    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=%f&longitude=%f&maxradiuskm=200&limit=5",
                    lat, lon);
            
            log.info("Querying USGS Seismic API for coordinate: {}, {}", lon, lat);
            String response = restTemplate.getForObject(url, String.class);
            
            if (response != null) {
                JsonNode root = objectMapper.readTree(response);
                JsonNode metadata = root.path("metadata");
                int count = metadata.path("count").asInt(0);
                
                result.put("recentEarthquakesCount", count);
                
                double maxMag = 0.0;
                JsonNode features = root.path("features");
                for (JsonNode feature : features) {
                    double mag = feature.path("properties").path("mag").asDouble(0.0);
                    if (mag > maxMag) {
                        maxMag = mag;
                    }
                }
                result.put("maxMagnitudeWithin200km", maxMag);
                result.put("geologicalHazardIndex", maxMag > 4.5 ? "Medium" : "Low");
                result.put("status", "success");
            } else {
                result.put("status", "error");
            }
        } catch (Exception e) {
            log.warn("USGS Seismic API query failed: {}. Using fallback defaults.", e.getMessage());
            // Safe geological averages for Varanasi (stable zone 3)
            result.put("recentEarthquakesCount", 0);
            result.put("maxMagnitudeWithin200km", 0.0);
            result.put("geologicalHazardIndex", "Low");
            result.put("status", "fallback");
        }

        return result;
    }

    @Override
    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        if (coordinates == null || coordinates.isEmpty() || coordinates.get(0).isEmpty()) {
            return Map.of("status", "error", "message", "Invalid coordinates");
        }
        List<List<Double>> outerRing = coordinates.get(0);
        double sumLon = 0.0;
        double sumLat = 0.0;
        for (List<Double> pt : outerRing) {
            sumLon += pt.get(0);
            sumLat += pt.get(1);
        }
        return queryPoint(sumLon / outerRing.size(), sumLat / outerRing.size());
    }
}
