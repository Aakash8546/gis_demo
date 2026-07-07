package com.example.webgis.h3.derived;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;





@Service
@Slf4j
public class DerivedMetricsEngine {

    private final Map<String, DerivedMetricCalculator> calculators = new HashMap<>();

    public DerivedMetricsEngine(List<DerivedMetricCalculator> calculatorList) {
        for (DerivedMetricCalculator calculator : calculatorList) {
            calculators.put(calculator.getMetricName().toLowerCase(), calculator);
        }
        log.info("Initialized DerivedMetricsEngine with {} calculators.", calculators.size());
    }

    





    public Map<String, Object> calculateMetrics(Map<String, Object> aggregatedData) {
        Map<String, Object> metrics = new LinkedHashMap<>();
        if (aggregatedData == null || aggregatedData.isEmpty()) {
            return metrics;
        }

        for (Map.Entry<String, DerivedMetricCalculator> entry : calculators.entrySet()) {
            try {
                double score = entry.getValue().calculate(aggregatedData);
                
                double rounded = Math.round(score * 1000.0) / 1000.0;
                metrics.put(entry.getKey(), rounded);
            } catch (Exception e) {
                log.error("Failed to compute derived metric '{}': {}", entry.getKey(), e.getMessage());
                metrics.put(entry.getKey(), 0.0);
            }
        }

        return metrics;
    }

    


    public Map<String, String> getMetricsMetadata() {
        Map<String, String> metadata = new LinkedHashMap<>();
        calculators.forEach((name, calc) -> metadata.put(name, calc.getDescription()));
        return metadata;
    }
}
