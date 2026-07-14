package com.example.webgis.gisengine.service;

import com.example.webgis.gisengine.model.Dataset;
import com.example.webgis.gisengine.model.GisFeature;
import com.example.webgis.gisengine.model.GisLayer;
import com.example.webgis.gisengine.model.VizPalettes;
import com.example.webgis.gisengine.model.VizSchema;
import com.example.webgis.gisengine.model.VizStatistics;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.Envelope;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
@Slf4j
public class DatasetRegistryService {

    private final Map<String, Dataset> datasets = new ConcurrentHashMap<>();
    private final Map<String, GisLayer> layers = new ConcurrentHashMap<>();

    public Dataset registerLayer(String name, String filename, GisLayer layer) {
        String id = UUID.randomUUID().toString();
        layer.setId(id);
        layer.setName(name);
        layer.initialize();

        // Extract attributes
        Set<String> attributes = new HashSet<>();
        String geomType = "Unknown";
        Envelope combinedEnvelope = new Envelope();

        for (GisFeature feature : layer.getFeatures()) {
            attributes.addAll(feature.getProperties().keySet());
            if (feature.getGeometry() != null) {
                geomType = feature.getGeometry().getGeometryType();
                combinedEnvelope.expandToInclude(feature.getGeometry().getEnvelopeInternal());
            }
        }

        double[] bbox = new double[]{
                combinedEnvelope.getMinX(), combinedEnvelope.getMinY(),
                combinedEnvelope.getMaxX(), combinedEnvelope.getMaxY()
        };

        Dataset dataset = Dataset.builder()
                .id(id)
                .name(name)
                .sourceFilename(filename)
                .geometryType(geomType)
                .featureCount(layer.getFeatures().size())
                .attributes(new ArrayList<>(attributes))
                .boundingBox(bbox)
                .uploadTimestamp(Instant.now())
                .status("ACTIVE")
                .build();

        dataset.setVizSchema(computeVizSchema(layer));

        datasets.put(id, dataset);
        layers.put(id, layer);
        log.info("Successfully registered dataset: {} with ID: {}", name, id);
        return dataset;
    }

    private VizSchema computeVizSchema(GisLayer layer) {
        if (layer.getFeatures() == null || layer.getFeatures().isEmpty()) return null;

        Map<String, List<Double>> numericFields = new HashMap<>();
        List<String> excludedKeys = Arrays.asList("zoneid", "zone_id", "id", "name", "description");

        for (GisFeature feature : layer.getFeatures()) {
            if (feature.getProperties() == null) continue;
            for (Map.Entry<String, Object> entry : feature.getProperties().entrySet()) {
                String key = entry.getKey();
                if (key == null) continue;
                String lowerKey = key.toLowerCase();
                if (excludedKeys.contains(lowerKey) || lowerKey.startsWith("__")) continue;

                Object val = entry.getValue();
                if (val != null) {
                    try {
                        double num = Double.parseDouble(val.toString());
                        numericFields.computeIfAbsent(key, k -> new ArrayList<>()).add(num);
                    } catch (NumberFormatException ignored) {}
                }
            }
        }

        if (numericFields.isEmpty()) return null;

        // Select the first numeric field (you could add better heuristics here)
        String field = numericFields.keySet().iterator().next();
        List<Double> values = numericFields.get(field);

        if (values.isEmpty()) return null;

        double min = values.stream().mapToDouble(Double::doubleValue).min().orElse(0.0);
        double max = values.stream().mapToDouble(Double::doubleValue).max().orElse(0.0);
        double mean = values.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
        int count = values.size();
        int totalFeatures = layer.getFeatures().size();
        int noDataCount = totalFeatures - count;
        int numClasses = Math.min(5, Math.max(1, count)); // Up to 5 classes

        List<Double> equalIntervalBreaks = new ArrayList<>();
        if (numClasses > 1) {
            double width = (max - min) / numClasses;
            for (int i = 0; i <= numClasses; i++) {
                equalIntervalBreaks.add(min + i * width);
            }
        } else {
            equalIntervalBreaks.addAll(Arrays.asList(min, max));
        }

        List<Double> quantileBreaks = new ArrayList<>();
        List<Double> sortedValues = new ArrayList<>(values);
        Collections.sort(sortedValues);
        
        if (numClasses > 1) {
             quantileBreaks.add(min);
             for (int i = 1; i < numClasses; i++) {
                 double pos = (double) i / numClasses * (sortedValues.size() - 1);
                 int index = (int) Math.floor(pos);
                 double frac = pos - index;
                 if (index + 1 < sortedValues.size()) {
                     quantileBreaks.add(sortedValues.get(index) + frac * (sortedValues.get(index + 1) - sortedValues.get(index)));
                 } else {
                     quantileBreaks.add(sortedValues.get(index));
                 }
             }
             quantileBreaks.add(max);
        } else {
             quantileBreaks.addAll(Arrays.asList(min, max));
        }

        VizStatistics stats = VizStatistics.builder()
                .min(min)
                .max(max)
                .mean(mean)
                .count(count)
                .noDataCount(noDataCount)
                .equalIntervalBreaks(equalIntervalBreaks)
                .quantileBreaks(quantileBreaks)
                .build();

        String palette = VizPalettes.detectPalette(field);
        String format = VizPalettes.detectFormat(field);

        List<String> paletteColors = VizPalettes.PALETTES.getOrDefault(palette, VizPalettes.PALETTES.get("blues"));
        List<String> classColors = new ArrayList<>();
        
        if (numClasses > 1) {
             for (int i = 0; i < numClasses; i++) {
                 int idx = (int) Math.round((double) i * (paletteColors.size() - 1) / (numClasses - 1));
                 classColors.add(paletteColors.get(Math.min(idx, paletteColors.size() - 1)));
             }
        } else {
             classColors.add(paletteColors.get(paletteColors.size() / 2));
        }

        return VizSchema.builder()
                .version(1)
                .field(field)
                .labelField("name")
                .palette(palette)
                .classification("quantile")
                .numClasses(numClasses)
                .format(format)
                .zoomThreshold(13)
                .statistics(stats)
                .breaks(quantileBreaks) // Default to quantile
                .classColors(classColors)
                .noDataColor("#9ca3af")
                .build();
    }

    public Optional<Dataset> getDataset(String id) {
        return Optional.ofNullable(datasets.get(id));
    }

    public Optional<GisLayer> getLayer(String id) {
        return Optional.ofNullable(layers.get(id));
    }

    public Collection<Dataset> getAllDatasets() {
        return datasets.values();
    }

    public boolean removeDataset(String id) {
        if (datasets.containsKey(id)) {
            datasets.remove(id);
            layers.remove(id);
            log.info("Successfully removed dataset: {}", id);
            return true;
        }
        return false;
    }
}
