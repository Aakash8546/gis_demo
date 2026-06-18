package com.example.webgis.controller;

import com.example.webgis.model.LayerCatalogResponse;
import com.example.webgis.service.GeoJsonService;
import com.example.webgis.service.MbTilesService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
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

public class GisController {

    private final GeoJsonService geoJsonService;
    private final MbTilesService mbTilesService;

    public GisController(GeoJsonService geoJsonService, MbTilesService mbTilesService) {
        this.geoJsonService = geoJsonService;
        this.mbTilesService = mbTilesService;
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

    @GetMapping("/mbtiles/{z}/{x}/{y}")
    public ResponseEntity<byte[]> getMbTile(@PathVariable int z, @PathVariable int x, @PathVariable int y) {
        return getMbTileDynamic("varanasi", z, x, y);
    }

    @GetMapping("/mbtiles/{dbName}/{z}/{x}/{y}")
    public ResponseEntity<byte[]> getMbTileDynamic(@PathVariable String dbName, @PathVariable int z, @PathVariable int x, @PathVariable int y) {
        byte[] tileData = mbTilesService.getTile(dbName, z, x, y);
        if (tileData == null) {
            return ResponseEntity.notFound().build();
        }

        String format = mbTilesService.getFormat(dbName);
        if ("pbf".equalsIgnoreCase(format)) {
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType("application/x-protobuf"))
                    .header("Content-Encoding", "gzip")
                    .body(tileData);
        }

        MediaType contentType = "jpg".equalsIgnoreCase(format) || "jpeg".equalsIgnoreCase(format)
                ? MediaType.IMAGE_JPEG
                : MediaType.IMAGE_PNG;

        return ResponseEntity.ok()
                .contentType(contentType)
                .body(tileData);
    }
}
