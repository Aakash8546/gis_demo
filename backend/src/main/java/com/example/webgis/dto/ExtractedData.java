package com.example.webgis.dto;

import java.util.List;

public record ExtractedData(
    String title,
    String entityType,
    String summary,
    String severity,
    String date,
    List<String> persons,
    List<String> organizations,
    List<String> keywords,
    Double confidence
) {}
