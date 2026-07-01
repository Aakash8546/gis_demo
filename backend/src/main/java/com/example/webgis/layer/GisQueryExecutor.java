package com.example.webgis.layer;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;

@Service
@Slf4j
public class GisQueryExecutor {

    private final GisLayerRegistry registry;
    private final ExecutorService executorService;

    public GisQueryExecutor(GisLayerRegistry registry) {
        this.registry = registry;
        // Daemon threads so they don't block JVM shutdown
        this.executorService = Executors.newFixedThreadPool(12, r -> {
            Thread t = new Thread(r);
            t.setDaemon(true);
            t.setName("gis-query-worker");
            return t;
        });
    }

    public Map<String, Object> queryPoint(double lon, double lat) {
        List<GisLayerProvider> providers = registry.getProviders();
        Map<String, CompletableFuture<Map<String, Object>>> futures = new LinkedHashMap<>();

        for (GisLayerProvider provider : providers) {
            CompletableFuture<Map<String, Object>> future = CompletableFuture.supplyAsync(() -> {
                try {
                    return provider.queryPoint(lon, lat);
                } catch (Exception e) {
                    log.error("Error querying layer point for '{}': {}", provider.getLayerId(), e.getMessage());
                    return Map.of("status", "error", "error", e.getMessage());
                }
            }, executorService);
            futures.put(provider.getLayerId(), future);
        }

        Map<String, Object> results = new LinkedHashMap<>();
        futures.forEach((layerId, future) -> {
            try {
                // Timeout of 5 seconds per layer query
                results.put(layerId, future.get(5, TimeUnit.SECONDS));
            } catch (TimeoutException e) {
                log.warn("Query timeout for layer '{}'", layerId);
                future.cancel(true);
                results.put(layerId, Map.of("status", "timeout", "error", "Request timed out"));
            } catch (Exception e) {
                log.error("Failed to retrieve query result for layer '{}'", layerId, e);
                results.put(layerId, Map.of("status", "error", "error", e.getMessage()));
            }
        });

        return results;
    }

    public Map<String, Object> queryPolygon(List<List<List<Double>>> coordinates) {
        List<GisLayerProvider> providers = registry.getProviders();
        Map<String, CompletableFuture<Map<String, Object>>> futures = new LinkedHashMap<>();

        for (GisLayerProvider provider : providers) {
            CompletableFuture<Map<String, Object>> future = CompletableFuture.supplyAsync(() -> {
                try {
                    return provider.queryPolygon(coordinates);
                } catch (Exception e) {
                    log.error("Error querying layer polygon for '{}': {}", provider.getLayerId(), e.getMessage());
                    return Map.of("status", "error", "error", e.getMessage());
                }
            }, executorService);
            futures.put(provider.getLayerId(), future);
        }

        Map<String, Object> results = new LinkedHashMap<>();
        futures.forEach((layerId, future) -> {
            try {
                // Timeout of 8 seconds for polygon analysis
                results.put(layerId, future.get(8, TimeUnit.SECONDS));
            } catch (TimeoutException e) {
                log.warn("Polygon query timeout for layer '{}'", layerId);
                future.cancel(true);
                results.put(layerId, Map.of("status", "timeout", "error", "Request timed out"));
            } catch (Exception e) {
                log.error("Failed to retrieve polygon query result for layer '{}'", layerId, e);
                results.put(layerId, Map.of("status", "error", "error", e.getMessage()));
            }
        });

        return results;
    }
}
