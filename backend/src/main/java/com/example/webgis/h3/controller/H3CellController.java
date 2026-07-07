package com.example.webgis.h3.controller;

import com.example.webgis.h3.core.H3GridService;
import com.example.webgis.h3.core.H3Service;
import com.example.webgis.h3.model.H3CellProfile;
import com.example.webgis.h3.repository.H3CellProfileRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * REST API controller exposing analytical H3 cell operations and profiles.
 */
@RestController
@RequestMapping("/api/h3")
@CrossOrigin(origins = "*")
@Slf4j
public class H3CellController {

    private final H3GridService h3GridService;
    private final H3Service h3Service;
    private final H3CellProfileRepository profileRepository;

    public H3CellController(H3GridService h3GridService, H3Service h3Service, H3CellProfileRepository profileRepository) {
        this.h3GridService = h3GridService;
        this.h3Service = h3Service;
        this.profileRepository = profileRepository;
    }

    /**
     * Query and generate spatial grid overlay based on point or polygon area inputs.
     */
    @PostMapping("/query")
    public ResponseEntity<?> queryGrid(@RequestBody H3GridRequest request) {
        log.info("Request to query spatial H3 grid overlay...");
        int resolution = request.resolution() != null ? request.resolution() : 9;

        try {
            // Case A: Polygon AOI area polyfill
            if (request.polygon() != null && !request.polygon().isEmpty()) {
                List<H3CellProfile> profiles = h3GridService.getProfilesForPolygon(request.polygon(), resolution);
                List<H3GridResponse.CellInfo> cells = profiles.stream()
                        .map(p -> new H3GridResponse.CellInfo(
                                p.getH3Index(),
                                p.getCenterLat(),
                                p.getCenterLon(),
                                h3Service.cellBoundary(p.getH3Index()),
                                p.getAggregatedData(),
                                p.getDerivedMetrics()
                        ))
                        .collect(Collectors.toList());

                H3GridResponse response = new H3GridResponse(
                        "POLYGON",
                        resolution,
                        cells.size(),
                        cells,
                        Instant.now().toString()
                );
                return ResponseEntity.ok(response);
            }

            // Case B: Point query with neighbors k-ring expansion
            if (request.latitude() == null || request.longitude() == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "latitude/longitude or polygon coords are required"));
            }

            int k = request.kRing() != null ? request.kRing() : 2;
            String centerCellId = h3Service.latLonToH3(request.latitude(), request.longitude(), resolution);
            List<String> cellIds = h3Service.kRing(centerCellId, k);

            List<H3GridResponse.CellInfo> cells = cellIds.stream()
                    .map(cellId -> {
                        try {
                            H3CellProfile p = h3GridService.getOrCreateProfile(cellId, null, null, resolution);
                            return new H3GridResponse.CellInfo(
                                    p.getH3Index(),
                                    p.getCenterLat(),
                                    p.getCenterLon(),
                                    h3Service.cellBoundary(p.getH3Index()),
                                    p.getAggregatedData(),
                                    p.getDerivedMetrics()
                            );
                        } catch (Exception e) {
                            log.error("Failed to generate cell profile for neighbor: {}", cellId, e);
                            return null;
                        }
                    })
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());

            H3GridResponse response = new H3GridResponse(
                    "POINT",
                    resolution,
                    cells.size(),
                    cells,
                    Instant.now().toString()
            );
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("Failed to execute H3 grid query: ", e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/cells/{cellId}")
    public ResponseEntity<H3CellProfile> getCellProfile(@PathVariable String cellId) {
        return profileRepository.findById(cellId)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/cells/{cellId}/summary")
    public ResponseEntity<?> getCellSummary(@PathVariable String cellId) {
        return profileRepository.findById(cellId)
                .map(p -> ResponseEntity.ok(Map.of(
                        "h3Index", p.getH3Index(),
                        "centerLat", p.getCenterLat(),
                        "centerLon", p.getCenterLon(),
                        "resolution", p.getResolution(),
                        "derivedMetrics", p.getDerivedMetrics()
                )))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/cells/{cellId}/terrain")
    public ResponseEntity<?> getCellTerrain(@PathVariable String cellId) {
        return profileRepository.findById(cellId)
                .map(p -> {
                    Map<String, Object> terrain = new HashMap<>();
                    terrain.put("elevation", p.getAggregatedData().get("elevation"));
                    terrain.put("slope", p.getAggregatedData().get("slope"));
                    return ResponseEntity.ok(terrain);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/cells/{cellId}/environment")
    public ResponseEntity<?> getCellEnvironment(@PathVariable String cellId) {
        return profileRepository.findById(cellId)
                .map(p -> ResponseEntity.ok(Map.of(
                        "lulc_class", p.getAggregatedData().getOrDefault("lulc_class", "unknown")
                )))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/cells/{cellId}/infrastructure")
    public ResponseEntity<?> getCellInfrastructure(@PathVariable String cellId) {
        return profileRepository.findById(cellId)
                .map(p -> ResponseEntity.ok(Map.of(
                        "roads_count", p.getAggregatedData().getOrDefault("roads_count", 0),
                        "schools_count", p.getAggregatedData().getOrDefault("schools_count", 0),
                        "hospitals_count", p.getAggregatedData().getOrDefault("hospitals_count", 0)
                )))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/cells/{cellId}/derived")
    public ResponseEntity<?> getCellDerived(@PathVariable String cellId) {
        return profileRepository.findById(cellId)
                .map(p -> ResponseEntity.ok(p.getDerivedMetrics()))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/cells/{cellId}/neighbors")
    public ResponseEntity<?> getCellNeighbors(@PathVariable String cellId, @RequestParam(value = "k", defaultValue = "1") int k) {
        try {
            List<String> neighbors = h3Service.kRing(cellId, k);
            List<H3CellProfile> profiles = neighbors.stream()
                    .map(id -> profileRepository.findById(id).orElse(null))
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());
            return ResponseEntity.ok(profiles);
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}
