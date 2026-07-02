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
public class AirQualityLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getLayerId() {
        return "air-quality-advanced";
    }

    @Override
    public String getLayerName() {
        return "Live Air Pollutants & PM2.5 Layer";
    }

    @Override
    public boolean isRaster() {
        return false;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();

        try {
            String url = String.format(Locale.US,
                    "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=%f&longitude=%f&current=pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone",
                    lat, lon);
            log.info("Querying Open-Meteo Air Quality API: {}", url);
            String response = restTemplate.getForObject(url, String.class);
            if (response != null) {
                JsonNode root = objectMapper.readTree(response);
                JsonNode current = root.path("current");
                
                result.put("pm2_5", current.path("pm2_5").asDouble(0.0));
                result.put("pm10", current.path("pm10").asDouble(0.0));
                result.put("co", current.path("carbon_monoxide").asDouble(0.0));
                result.put("no2", current.path("nitrogen_dioxide").asDouble(0.0));
                result.put("so2", current.path("sulphur_dioxide").asDouble(0.0));
                result.put("ozone", current.path("ozone").asDouble(0.0));
                result.put("status", "success");
            }
        } catch (Exception e) {
            log.warn("Open-Meteo Air Quality API failed: {}", e.getMessage());
            result.put("status", "fallback");
            // Generic fallback values
            result.put("pm2_5", 35.4);
            result.put("pm10", 68.2);
            result.put("co", 210.0);
            result.put("no2", 15.6);
            result.put("so2", 4.2);
            result.put("ozone", 45.1);
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
}
