package com.example.webgis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LulcResponse {
    private double totalArea;
    private List<LulcClassStat> classes;
}
