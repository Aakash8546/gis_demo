package com.example.webgis.h3.controller;

import java.util.List;

/**
 * DTO representing a request to query H3 Grid overlay coordinates.
 */
public record H3GridRequest(
    Double latitude,
    Double longitude,
    Integer resolution,  // default 9
    Integer kRing,       // default 2 for point query neighbors
    List<List<Double>> polygon // for area queries
) {}
