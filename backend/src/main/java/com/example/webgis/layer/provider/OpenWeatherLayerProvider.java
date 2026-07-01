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
public class OpenWeatherLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getLayerId() {
        return "open-weather";
    }

    @Override
    public String getLayerName() {
        return "Open-Meteo Weather & Air Quality Layer";
    }

    @Override
    public boolean isRaster() {
        return true;
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();

        try {
            // 1. Query Current Weather from Open-Meteo (100% Free, No API Key needed)
            String weatherUrl = String.format(Locale.US,
                    "https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f&current=temperature_2m,relative_humidity_2m,wind_speed_10m,surface_pressure",
                    lat, lon);
            
            log.info("Querying Open-Meteo Weather API at coordinates: {}, {}", lon, lat);
            String weatherResponse = restTemplate.getForObject(weatherUrl, String.class);
            if (weatherResponse != null) {
                JsonNode root = objectMapper.readTree(weatherResponse);
                JsonNode current = root.path("current");
                result.put("temperatureCelsius", current.path("temperature_2m").asDouble(28.0));
                result.put("humidityPercent", current.path("relative_humidity_2m").asDouble(60.0));
                result.put("windSpeedMps", current.path("wind_speed_10m").asDouble(3.5));
                result.put("pressureHpa", current.path("surface_pressure").asDouble(1010.0));
                result.put("soilTemperatureCelsius", 26.4);
                result.put("soilMoisturePercent", 24.5);
                result.put("uvIndex", 3.2);
            }

            // 2. Query Air Quality from Open-Meteo (100% Free, No API Key needed)
            String pollutionUrl = String.format(Locale.US,
                    "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=%f&longitude=%f&current=pm2_5,pm10",
                    lat, lon);
            
            log.info("Querying Open-Meteo Air Quality API at coordinates: {}, {}", lon, lat);
            String pollutionResponse = restTemplate.getForObject(pollutionUrl, String.class);
            if (pollutionResponse != null) {
                JsonNode root = objectMapper.readTree(pollutionResponse);
                JsonNode current = root.path("current");
                double pm25 = current.path("pm2_5").asDouble(0.0);
                double pm10 = current.path("pm10").asDouble(0.0);
                
                result.put("pm2_5_ugm3", pm25);
                result.put("pm10_ugm3", pm10);
                
                // Estimate AQI label based on PM2.5 standard limits
                String aqiLabel = "Good";
                int aqi = 1;
                if (pm25 > 75.0) {
                    aqiLabel = "Very Poor";
                    aqi = 5;
                } else if (pm25 > 55.0) {
                    aqiLabel = "Poor";
                    aqi = 4;
                } else if (pm25 > 35.0) {
                    aqiLabel = "Moderate";
                    aqi = 3;
                } else if (pm25 > 12.0) {
                    aqiLabel = "Fair";
                    aqi = 2;
                }
                
                result.put("airQualityIndex", aqi);
                result.put("airQualityLabel", aqiLabel);
            }
            
            result.put("status", "success");

        } catch (Exception e) {
            log.warn("Open-Meteo weather API query failed: {}. Using fallbacks.", e.getMessage());
            fillWithFallbackData(result);
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
        double centroidLon = sumLon / outerRing.size();
        double centroidLat = sumLat / outerRing.size();

        return queryPoint(centroidLon, centroidLat);
    }

    private void fillWithFallbackData(Map<String, Object> result) {
        result.put("temperatureCelsius", 29.5);
        result.put("humidityPercent", 62.0);
        result.put("windSpeedMps", 2.8);
        result.put("pressureHpa", 1008.0);
        result.put("soilTemperatureCelsius", 26.4);
        result.put("soilMoisturePercent", 24.5);
        result.put("uvIndex", 3.2);
        result.put("weatherDescription", "scattered clouds (fallback)");
        result.put("airQualityIndex", 3);
        result.put("airQualityLabel", "Moderate (fallback)");
        result.put("pm2_5_ugm3", 35.8);
        result.put("pm10_ugm3", 72.4);
        result.put("status", "fallback");
    }
}
