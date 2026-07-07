package com.example.webgis.h3.aggregation.strategies;

import com.example.webgis.h3.aggregation.AggregationStrategy;
import com.example.webgis.h3.model.GISDatasetObject.GISFeature;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Concrete aggregation strategy that extracts the dominant categorical class (mode value).
 */
@Component("DOMINANT_CLASS")
public class DominantClassAggregationStrategy implements AggregationStrategy {

    @Override
    public Object aggregate(List<GISFeature> features) {
        if (features == null || features.isEmpty()) {
            return "unknown";
        }

        Map<String, Integer> frequencyMap = new HashMap<>();
        for (GISFeature feature : features) {
            if (feature != null && feature.getValue() != null) {
                String val = feature.getValue().toString().toLowerCase().trim();
                frequencyMap.put(val, frequencyMap.getOrDefault(val, 0) + 1);
            }
        }

        String dominantClass = "unknown";
        int maxCount = -1;

        for (Map.Entry<String, Integer> entry : frequencyMap.entrySet()) {
            if (entry.getValue() > maxCount) {
                maxCount = entry.getValue();
                dominantClass = entry.getKey();
            }
        }

        return dominantClass;
    }

    @Override
    public String getStrategyName() {
        return "DOMINANT_CLASS";
    }
}
