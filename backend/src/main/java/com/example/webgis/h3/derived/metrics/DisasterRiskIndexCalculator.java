package com.example.webgis.h3.derived.metrics;

import com.example.webgis.h3.derived.DerivedMetricCalculator;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Concrete metric calculator for Landslide/Disaster Risk Index.
 * High slope and low elevation typically mean high risk.
 */
@Component
public class DisasterRiskIndexCalculator implements DerivedMetricCalculator {

    @Override
    public String getMetricName() {
        return "disaster_risk_index";
    }

    @Override
    public String getDescription() {
        return "Calculates natural hazard vulnerability based on slope and LULC class.";
    }

    @Override
    public double calculate(Map<String, Object> aggregatedData) {
        if (aggregatedData == null) {
            return 0.0;
        }

        double slope = 0.0;
        Object slopeVal = aggregatedData.get("slope");
        if (slopeVal instanceof Number) {
            slope = ((Number) slopeVal).doubleValue();
        }

        String lulcClass = "urban";
        Object lulcVal = aggregatedData.get("lulc_class");
        if (lulcVal != null) {
            lulcClass = lulcVal.toString().toLowerCase();
        }

        // Steeper slope increases risk (max 45 degrees slope for landslide vulnerability)
        double slopeRisk = Math.min(1.0, slope / 45.0);

        // LULC risk factors (urban built-up area has higher run-off / flood impact)
        double lulcRisk = 0.2;
        if ("urban".equals(lulcClass) || "built-up".equals(lulcClass)) {
            lulcRisk = 0.8;
        } else if ("water".equals(lulcClass)) {
            lulcRisk = 1.0; // max flood hazard zone
        }

        // Composite risk index (60% slope hazard, 40% LULC vulnerability)
        return (slopeRisk * 0.6) + (lulcRisk * 0.4);
    }
}
