package com.example.webgis.service;

import com.example.webgis.model.LayerCatalogResponse;
import com.example.webgis.model.LayerInfo;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

@Service
public class GeoJsonService {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<LayerInfo> layerInfos = List.of();

    public LayerCatalogResponse getLayerCatalog() {
        return new LayerCatalogResponse(layerInfos);
    }

    public JsonNode getLayerById(String layerId) throws IOException {
        LayerInfo layer = layerInfos.stream()
                .filter(item -> item.id().equalsIgnoreCase(layerId))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported layer id: " + layerId));

        try (InputStream inputStream = new ClassPathResource("data/" + layer.fileName()).getInputStream()) {
            return objectMapper.readTree(inputStream);
        }
    }
}

