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
public class NasaPowerLayerProvider implements GisLayerProvider {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RestTemplate restTemplate = new RestTemplate();

    @Override
    public String getLayerId() {
        return "nasa-power";
    }

    @Override
    public String getLayerName() {
        return "NASA POWER Climatology Layer";
    }

    @Override
    public boolean isRaster() {
        return true; // Environmental grid layer
    }

    @Override
    public Map<String, Object> queryPoint(double lon, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();
        
        try {
            String url = String.format(Locale.US,
                    "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR,RH2M,ALLSKY_SFC_SW_DWN,WS10M&community=AG&longitude=%f&latitude=%f&format=JSON",
                    lon, lat);
            
            log.info("Querying NASA POWER API for coordinate: {}, {}", lon, lat);
            String response = restTemplate.getForObject(url, String.class);
            
            if (response != null) {
                JsonNode root = objectMapper.readTree(response);
                JsonNode paramNode = root.path("properties").path("parameter");
                
                // Annual Averages
                double avgTemp = paramNode.path("T2M").path("ANN").asDouble(-999.0);
                double annualRainfall = paramNode.path("PRECTOTCORR").path("ANN").asDouble(-999.0);
                double avgHumidity = paramNode.path("RH2M").path("ANN").asDouble(-999.0);
                double solarIns = paramNode.path("ALLSKY_SFC_SW_DWN").path("ANN").asDouble(-999.0);
                double windSpeed = paramNode.path("WS10M").path("ANN").asDouble(-999.0);
                
                if (avgTemp != -999.0) result.put("annualAverageTempCelsius", avgTemp);
                if (annualRainfall != -999.0) result.put("annualAverageRainfallMmDay", annualRainfall);
                if (avgHumidity != -999.0) result.put("annualAverageRelativeHumidityPercent", avgHumidity);
                if (solarIns != -999.0) {
                    // NASA returns ALLSKY_SFC_SW_DWN in MJ/m2/day. Convert to kWh/m2/day (1 kWh = 3.6 MJ)
                    result.put("averageSolarRadiationKWhrM2Day", Math.round((solarIns / 3.6) * 100.0) / 100.0);
                }
                if (windSpeed != -999.0) result.put("averageWindSpeedMps", windSpeed);
                
                result.put("status", "success");
            } else {
                result.put("status", "error");
                result.put("message", "Empty response from NASA API");
            }
        } catch (Exception e) {
            log.warn("NASA POWER API query failed: {}. Using regional climatology fallback values.", e.getMessage());
            // Safe regional fallback for Varanasi / UP region
            result.put("annualAverageTempCelsius", 26.2);
            result.put("annualAverageRainfallMmDay", 3.1);
            result.put("annualAverageRelativeHumidityPercent", 58.5);
            result.put("averageSolarRadiationKWhrM2Day", 5.25);
            result.put("averageWindSpeedMps", 3.4);
            result.put("status", "fallback");
            result.put("warning", "NASA API unavailable, using Varanasi region climatology averages");
        }

        return result;
    }

    @Override
    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        if (coordinates == null || coordinates.isEmpty() || coordinates.get(0).isEmpty()) {
            return Map.of("status", "error", "message", "Invalid coordinates");
        }

        // Calculate polygon centroid to query coarse resolution NASA grid
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
}
