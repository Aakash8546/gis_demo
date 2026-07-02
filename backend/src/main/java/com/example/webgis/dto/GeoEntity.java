package com.example.webgis.dto;

import org.locationtech.jts.geom.Point;
import java.time.Instant;

public record GeoEntity(
    String id,
    double latitude,
    double longitude,
    Point geometry,
    String originalText,
    ExtractedData extractedData,
    Instant createdAt,
    String source, // "MANUAL"
    String sessionId
) {}
