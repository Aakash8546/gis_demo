package com.example.webgis.h3.aggregation;

import com.example.webgis.h3.model.GISDatasetObject;
import com.example.webgis.h3.registry.DatasetDescriptor;
import com.example.webgis.h3.registry.DatasetRegistry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.*;





@Service
@Slf4j
public class AggregationEngine {

    private final DatasetRegistry datasetRegistry;
    private final Map<String, AggregationStrategy> strategies = new HashMap<>();

    public AggregationEngine(DatasetRegistry datasetRegistry, List<AggregationStrategy> strategyList) {
        this.datasetRegistry = datasetRegistry;
        for (AggregationStrategy strategy : strategyList) {
            this.strategies.put(strategy.getStrategyName().toUpperCase(), strategy);
        }
        log.info("Initialized AggregationEngine with {} strategies.", strategies.size());
    }

    





    public Map<String, Object> aggregate(List<GISDatasetObject> datasets) {
        Map<String, Object> aggregatedMap = new LinkedHashMap<>();
        if (datasets == null || datasets.isEmpty()) {
            return aggregatedMap;
        }

        for (GISDatasetObject dataset : datasets) {
            Optional<DatasetDescriptor> descriptorOpt = datasetRegistry.getDataset(dataset.getDatasetId());
            if (descriptorOpt.isEmpty()) {
                log.warn("Dataset '{}' found in collector but not in registry. Skipping.", dataset.getDatasetId());
                continue;
            }

            DatasetDescriptor descriptor = descriptorOpt.get();
            String strategyName = descriptor.getAggregationStrategyName();
            AggregationStrategy strategy = strategies.get(strategyName.toUpperCase());

            if (strategy == null) {
                log.error("Aggregation strategy '{}' not found for dataset '{}'. Defaulting to MEAN.", 
                        strategyName, dataset.getDatasetId());
                strategy = strategies.get("MEAN");
            }

            try {
                Object result = strategy.aggregate(dataset.getFeatures());
                aggregatedMap.put(dataset.getDatasetId(), result);
            } catch (Exception e) {
                log.error("Failed to aggregate dataset '{}' using strategy '{}': {}", 
                        dataset.getDatasetId(), strategyName, e.getMessage());
                aggregatedMap.put(dataset.getDatasetId(), null);
            }
        }

        return aggregatedMap;
    }
}
