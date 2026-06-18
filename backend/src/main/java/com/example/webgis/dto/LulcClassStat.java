package com.example.webgis.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class LulcClassStat {
    private String className;
    private double area;
    private double percentage;
}
