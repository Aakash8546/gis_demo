package com.example.webgis.dto;

import jakarta.validation.constraints.NotEmpty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class PolygonQueryRequest {

    @NotEmpty(message = "Coordinates must not be empty")
    private List<List<List<Double>>> coordinates;
}
