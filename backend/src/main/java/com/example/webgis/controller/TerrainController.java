package com.example.webgis.controller;

import com.example.webgis.dto.TerrainQueryResponse;
import com.example.webgis.service.TerrainService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/terrain")
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
public class TerrainController {

    private final TerrainService terrainService;

    @GetMapping("/query")
    public ResponseEntity<TerrainQueryResponse> queryTerrain(
            @RequestParam("lon") double longitude,
            @RequestParam("lat") double latitude) {
        log.info("Received terrain query request for lon: {}, lat: {}", longitude, latitude);
        try {
            TerrainQueryResponse response = terrainService.queryTerrain(longitude, latitude);
            return ResponseEntity.ok(response);
        } catch (IllegalStateException e) {
            log.error("Terrain service error: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }

    @GetMapping(value = "/tile/{level}/{x}/{y}", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> getTerrainTile(
            @PathVariable("level") int level,
            @PathVariable("x") int x,
            @PathVariable("y") int y) {
        try {
            byte[] tileData = terrainService.getTerrainTile(level, x, y);
            HttpHeaders headers = new HttpHeaders();
            headers.setContentLength(tileData.length);
            headers.setCacheControl("public, max-age=3600");
            return new ResponseEntity<>(tileData, headers, HttpStatus.OK);
        } catch (IllegalStateException e) {
            log.error("Terrain tile service error: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }
}
