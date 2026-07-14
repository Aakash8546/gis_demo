package com.example.webgis.gisengine.controller;

import com.example.webgis.gisengine.model.Dataset;
import com.example.webgis.gisengine.model.GisLayer;
import com.example.webgis.gisengine.service.DatasetRegistryService;
import com.example.webgis.gisengine.service.DerivedLayerEngine;
import com.example.webgis.gisengine.service.GeoJsonExporter;
import com.example.webgis.gisengine.service.KmlParser;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Collection;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/datasets")
@CrossOrigin(origins = "*")
@Slf4j
public class DatasetController {

    private final KmlParser kmlParser;
    private final DatasetRegistryService registryService;
    private final GeoJsonExporter geoJsonExporter;
    private final DerivedLayerEngine derivedLayerEngine;

    public DatasetController(KmlParser kmlParser, DatasetRegistryService registryService,
                             GeoJsonExporter geoJsonExporter, DerivedLayerEngine derivedLayerEngine) {
        this.kmlParser = kmlParser;
        this.registryService = registryService;
        this.geoJsonExporter = geoJsonExporter;
        this.derivedLayerEngine = derivedLayerEngine;
    }

    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> uploadDataset(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "name", required = false) String name) {

        String originalFilename = file.getOriginalFilename();
        String datasetName = (name != null && !name.trim().isEmpty()) ? name.trim() : 
                (originalFilename != null ? originalFilename.replace(".kml", "") : "Unnamed Dataset");

        log.info("Request to upload and parse dataset: {} (original filename: {})", datasetName, originalFilename);

        try {
            if (file.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("error", "File is empty"));
            }

            // 1. Parse KML
            GisLayer layer = kmlParser.parse(file.getInputStream(), datasetName);

            // 2. Register Dataset
            Dataset dataset = registryService.registerLayer(datasetName, originalFilename, layer);

            return ResponseEntity.ok(dataset);

        } catch (Exception e) {
            log.error("Failed to parse and register dataset: ", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Failed to parse KML: " + e.getMessage()));
        }
    }

    @GetMapping
    public ResponseEntity<Collection<Dataset>> getAllDatasets() {
        return ResponseEntity.ok(registryService.getAllDatasets());
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> getDataset(@PathVariable String id) {
        return registryService.getDataset(id)
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/{id}/geojson")
    public ResponseEntity<?> getDatasetGeoJson(@PathVariable String id) {
        return registryService.getLayer(id)
                .map(layer -> ResponseEntity.ok(geoJsonExporter.export(layer)))
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteDataset(@PathVariable String id) {
        boolean removed = registryService.removeDataset(id);
        if (removed) {
            return ResponseEntity.ok(Map.of("message", "Dataset removed successfully"));
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/derived/calculate")
    @SuppressWarnings("unchecked")
    public ResponseEntity<?> calculateDerivedLayer(@RequestBody Map<String, Object> request) {
        String metric = (String) request.get("metric");
        List<String> inputs = (List<String>) request.get("inputs");
        String outputName = (String) request.get("name");

        log.info("Request to calculate derived layer: metric={}, inputs={}, name={}", metric, inputs, outputName);

        try {
            if (metric == null || inputs == null || inputs.isEmpty() || outputName == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "Missing required parameters: metric, inputs, name"));
            }

            Dataset derivedDataset = derivedLayerEngine.generateDerivedLayer(metric, inputs, outputName);
            return ResponseEntity.ok(derivedDataset);

        } catch (Exception e) {
            log.error("Failed to compute derived layer: ", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", "Calculation failed: " + e.getMessage()));
        }
    }
}
