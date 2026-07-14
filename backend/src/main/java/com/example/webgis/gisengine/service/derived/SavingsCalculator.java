package com.example.webgis.gisengine.service.derived;

import com.example.webgis.gisengine.model.GisFeature;
import com.example.webgis.gisengine.model.GisLayer;
import com.example.webgis.gisengine.service.H3GridMatcher;
import com.example.webgis.gisengine.service.H3GridProjector;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
@Slf4j
public class SavingsCalculator implements DerivedLayerCalculator {

    private final H3GridProjector h3GridProjector;
    private final H3GridMatcher h3GridMatcher;

    public SavingsCalculator(H3GridProjector h3GridProjector, H3GridMatcher h3GridMatcher) {
        this.h3GridProjector = h3GridProjector;
        this.h3GridMatcher = h3GridMatcher;
    }

    @Override
    public String getMetricName() {
        return "savings";
    }

    @Override
    public GisLayer calculate(List<GisLayer> inputs) {
        if (inputs.size() < 2) {
            throw new IllegalArgumentException("Savings calculation requires at least 2 input layers: Income and Consumption");
        }

        GisLayer incomeLayer = inputs.get(0);
        GisLayer consumptionLayer = inputs.get(1);

        boolean hasZoneIds = incomeLayer.getFeatures().stream().anyMatch(f -> f.getZoneId() != null)
                && consumptionLayer.getFeatures().stream().anyMatch(f -> f.getZoneId() != null);

        if (hasZoneIds) {
            log.info("Matching layers by stable zoneId...");
            List<GisFeature> matchedFeatures = new ArrayList<>();
            Map<String, GisFeature> consumptionMap = new HashMap<>();
            for (GisFeature f : consumptionLayer.getFeatures()) {
                if (f.getZoneId() != null) {
                    consumptionMap.put(f.getZoneId(), f);
                }
            }

            for (GisFeature incFeature : incomeLayer.getFeatures()) {
                String zoneId = incFeature.getZoneId();
                if (zoneId == null) continue;

                GisFeature consFeature = consumptionMap.get(zoneId);
                double income = getDoubleProperty(incFeature, "income");
                double consumption = consFeature != null ? getDoubleProperty(consFeature, "consumption") : 0.0;
                double saving = income - consumption;

                Map<String, Object> props = new HashMap<>(incFeature.getProperties());
                if (consFeature != null) {
                    props.putAll(consFeature.getProperties());
                }
                props.put("saving", saving);
                props.put("income", income);
                props.put("consumption", consumption);
                props.put("zoneId", zoneId);

                GisFeature matched = GisFeature.builder()
                        .id(UUID.randomUUID().toString())
                        .geometry(incFeature.getGeometry())
                        .properties(props)
                        .zoneId(zoneId)
                        .metadata(new HashMap<>(incFeature.getMetadata()))
                        .build();
                matched.initialize();
                matchedFeatures.add(matched);
            }

            GisLayer result = GisLayer.builder()
                    .id(UUID.randomUUID().toString())
                    .name("Savings Layer (Zone Joined)")
                    .crs("EPSG:4326")
                    .geometryType(incomeLayer.getGeometryType())
                    .features(matchedFeatures)
                    .build();
            result.initialize();
            return result;
        }

        log.info("Stable zoneId not found in both layers. Falling back to H3 grid alignment...");

        // Fallback: project to H3 grid (resolution 8 for stable regional overlay)
        GisLayer incomeH3 = h3GridProjector.projectToH3(incomeLayer, 8);
        GisLayer consumptionH3 = h3GridProjector.projectToH3(consumptionLayer, 8);

        // Align grids
        GisLayer alignedLayer = h3GridMatcher.matchLayers(Arrays.asList(incomeH3, consumptionH3), "Savings Layer");

        // Compute cell-wise: Saving = Income - Consumption
        for (GisFeature feature : alignedLayer.getFeatures()) {
            double income = getDoubleProperty(feature, "income");
            double consumption = getDoubleProperty(feature, "consumption");
            double saving = income - consumption;

            feature.getProperties().put("saving", saving);
            feature.getProperties().put("income", income);
            feature.getProperties().put("consumption", consumption);
            feature.getProperties().put("name", "Grid Cell - Savings");
        }

        return alignedLayer;
    }

    private double getDoubleProperty(GisFeature feature, String key) {
        Object val = feature.getProperties().get(key);
        if (val == null) {
            // Check case-insensitive
            for (String propKey : feature.getProperties().keySet()) {
                if (propKey.equalsIgnoreCase(key)) {
                    val = feature.getProperties().get(propKey);
                    break;
                }
            }
        }
        if (val instanceof Number) {
            return ((Number) val).doubleValue();
        } else if (val instanceof String) {
            try {
                return Double.parseDouble((String) val);
            } catch (NumberFormatException ignored) {}
        }
        return 0.0;
    }
}
