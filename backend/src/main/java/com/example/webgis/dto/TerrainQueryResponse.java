package com.example.webgis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class TerrainQueryResponse {
    private Double longitude;
    private Double latitude;
    private Double elevation; // in meters, null if out of bounds
    private Double slope;     // in percent, null if out of bounds
}
