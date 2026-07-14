package com.example.webgis.gisengine.model;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class VizPalettes {
    private VizPalettes() {} // Utility class

    public static final Map<String, List<String>> PALETTES = new HashMap<>();

    static {
        PALETTES.put("greens", Arrays.asList("#d1fae5", "#6ee7b7", "#34d399", "#10b981", "#059669"));
        PALETTES.put("oranges", Arrays.asList("#ffedd5", "#fdba74", "#fb923c", "#f97316", "#ea580c"));
        PALETTES.put("blues", Arrays.asList("#dbeafe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb"));
        PALETTES.put("purples", Arrays.asList("#f3e8ff", "#d8b4fe", "#c084fc", "#a855f7", "#7c3aed"));
        PALETTES.put("diverging", Arrays.asList("#ef4444", "#fb923c", "#fde68a", "#86efac", "#22c55e"));
    }

    public static String detectPalette(String fieldName) {
        if (fieldName == null) return "blues";
        String lower = fieldName.toLowerCase();
        if (lower.contains("income") || lower.contains("revenue") || lower.contains("gdp")) {
            return "greens";
        }
        if (lower.contains("consumption") || lower.contains("expenditure") || lower.contains("cost")) {
            return "oranges";
        }
        if (lower.contains("saving") || lower.contains("profit") || lower.contains("surplus")) {
            return "diverging";
        }
        if (lower.contains("population") || lower.contains("density")) {
            return "purples";
        }
        return "blues";
    }

    public static String detectFormat(String fieldName) {
        if (fieldName == null) return "number";
        String lower = fieldName.toLowerCase();
        if (lower.contains("income") || lower.contains("revenue") || lower.contains("cost") || 
            lower.contains("consumption") || lower.contains("expenditure") || lower.contains("saving") ||
            lower.contains("profit") || lower.contains("surplus") || lower.contains("price")) {
            return "currency";
        }
        if (lower.contains("percent") || lower.contains("rate") || lower.contains("ratio")) {
            return "percent";
        }
        return "number";
    }
}
