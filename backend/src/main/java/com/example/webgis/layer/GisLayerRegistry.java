package com.example.webgis.layer;

import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Optional;

@Service
public class GisLayerRegistry {

    private final List<GisLayerProvider> providers;

    public GisLayerRegistry(List<GisLayerProvider> providers) {
        this.providers = providers;
    }

    public List<GisLayerProvider> getProviders() {
        return providers;
    }

    public Optional<GisLayerProvider> getProvider(String layerId) {
        return providers.stream()
                .filter(p -> p.getLayerId().equalsIgnoreCase(layerId))
                .findFirst();
    }
}
