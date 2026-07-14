package com.example.webgis.gisengine.service;

import com.example.webgis.gisengine.model.Dataset;
import com.example.webgis.gisengine.model.GisLayer;
import com.example.webgis.gisengine.service.derived.DerivedLayerCalculator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@Slf4j
public class DerivedLayerEngine {

    private final Map<String, DerivedLayerCalculator> calculators = new ConcurrentHashMap<>();
    private final DatasetRegistryService registryService;

    public DerivedLayerEngine(List<DerivedLayerCalculator> calculatorList, DatasetRegistryService registryService) {
        this.registryService = registryService;
        for (DerivedLayerCalculator calc : calculatorList) {
            calculators.put(calc.getMetricName().toLowerCase(), calc);
            log.info("Registered spatial calculator for metric: {}", calc.getMetricName());
        }
    }

    public Dataset generateDerivedLayer(String metric, List<String> inputDatasetIds, String outputName) {
        String key = metric.toLowerCase();
        DerivedLayerCalculator calculator = calculators.get(key);
        if (calculator == null) {
            throw new IllegalArgumentException("Unsupported derived metric: " + metric);
        }

        log.info("Executing derived calculation for metric: {} on inputs: {}", metric, inputDatasetIds);

        List<GisLayer> inputLayers = new ArrayList<>();
        for (String id : inputDatasetIds) {
            GisLayer layer = registryService.getLayer(id)
                    .orElseThrow(() -> new IllegalArgumentException("Input dataset layer not found for ID: " + id));
            inputLayers.add(layer);
        }

        // Run calculation
        GisLayer derivedLayer = calculator.calculate(inputLayers);

        // Register the newly generated layer as a dataset
        return registryService.registerLayer(outputName, "derived_" + key + ".kml", derivedLayer);
    }
}
