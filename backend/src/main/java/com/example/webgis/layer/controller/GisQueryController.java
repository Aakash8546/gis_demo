package com.example.webgis.layer.controller;

import com.example.webgis.dto.PolygonQueryRequest;
import com.example.webgis.layer.GisQueryExecutor;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/layers")
@CrossOrigin(origins = {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5176",
        "http://127.0.0.1:5176",
        "http://localhost:5177",
        "http://127.0.0.1:5177"
})
@RequiredArgsConstructor
@Slf4j
public class GisQueryController {

    private final GisQueryExecutor queryExecutor;

    @GetMapping("/query/point")
    public ResponseEntity<Map<String, Object>> queryPoint(
            @RequestParam("lon") double longitude,
            @RequestParam("lat") double latitude) {
        log.info("Received unified point query request for lon: {}, lat: {}", longitude, latitude);
        Map<String, Object> response = queryExecutor.queryPoint(longitude, latitude);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/query/polygon")
    public ResponseEntity<Map<String, Object>> queryPolygon(
            @Valid @RequestBody PolygonQueryRequest request) {
        log.info("Received unified polygon query request");
        Map<String, Object> response = queryExecutor.queryPolygon(request.getCoordinates());
        return ResponseEntity.ok(response);
    }
}
