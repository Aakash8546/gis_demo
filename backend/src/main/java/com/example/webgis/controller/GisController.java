package com.example.webgis.controller;

import com.example.webgis.model.LayerCatalogResponse;
import com.example.webgis.service.GeoJsonService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175"
})
public class GisController {

    private final GeoJsonService geoJsonService;

    public GisController(GeoJsonService geoJsonService) {
        this.geoJsonService = geoJsonService;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "mode", "poc");
    }

    @GetMapping("/layers")
    public LayerCatalogResponse getLayers() {
        return geoJsonService.getLayerCatalog();
    }

    @GetMapping("/layers/{layerId}")
    public ResponseEntity<JsonNode> getLayer(@PathVariable String layerId) throws IOException {
        return ResponseEntity.ok(geoJsonService.getLayerById(layerId));
    }
}
