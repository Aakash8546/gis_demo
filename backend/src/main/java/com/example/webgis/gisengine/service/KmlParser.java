package com.example.webgis.gisengine.service;

import com.example.webgis.gisengine.model.GisFeature;
import com.example.webgis.gisengine.model.GisLayer;
import lombok.extern.slf4j.Slf4j;
import org.locationtech.jts.geom.*;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.util.*;

@Service
@Slf4j
public class KmlParser {

    private static final GeometryFactory GEOMETRY_FACTORY = new GeometryFactory(new PrecisionModel(), 4326);
    private final GeometryValidator geometryValidator;

    public KmlParser(GeometryValidator geometryValidator) {
        this.geometryValidator = geometryValidator;
    }

    public GisLayer parse(InputStream inputStream, String layerName) {
        log.info("Parsing KML stream for layer: {}", layerName);
        List<GisFeature> features = new ArrayList<>();

        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(inputStream);
            doc.getDocumentElement().normalize();

            // KML placemarks
            NodeList placemarks = doc.getElementsByTagName("Placemark");
            log.info("Found {} placemarks in KML", placemarks.getLength());

            for (int i = 0; i < placemarks.getLength(); i++) {
                Node node = placemarks.item(i);
                if (node.getNodeType() == Node.ELEMENT_NODE) {
                    Element element = (Element) node;
                    GisFeature feature = parsePlacemark(element);
                    if (feature != null) {
                        features.add(feature);
                    }
                }
            }

        } catch (Exception e) {
            log.error("Failed to parse KML: ", e);
            throw new RuntimeException("KML parse error: " + e.getMessage(), e);
        }

        GisLayer layer = GisLayer.builder()
                .id(UUID.randomUUID().toString())
                .name(layerName)
                .crs("EPSG:4326")
                .features(features)
                .metadata(Map.of("parsedAt", new Date().toString(), "sourceType", "KML"))
                .build();
        layer.initialize();
        return layer;
    }

    private GisFeature parsePlacemark(Element element) {
        Map<String, Object> properties = new HashMap<>();

        // Name
        String name = getChildText(element, "name");
        if (name != null) {
            properties.put("name", name);
        }

        // Description
        String description = getChildText(element, "description");
        if (description != null) {
            properties.put("description", description);
        }

        // ExtendedData properties
        NodeList extendedDataList = element.getElementsByTagName("ExtendedData");
        if (extendedDataList.getLength() > 0) {
            Element extData = (Element) extendedDataList.item(0);
            
            // Handle <Data name="..."> <value>...</value> </Data>
            NodeList dataNodes = extData.getElementsByTagName("Data");
            for (int i = 0; i < dataNodes.getLength(); i++) {
                Element d = (Element) dataNodes.item(i);
                String propName = d.getAttribute("name");
                String value = getChildText(d, "value");
                if (propName != null && !propName.isEmpty() && value != null) {
                    properties.put(propName.trim(), parseTypedValue(value.trim()));
                }
            }

            // Handle <SimpleData name="...">...</SimpleData>
            NodeList simpleDataNodes = extData.getElementsByTagName("SimpleData");
            for (int i = 0; i < simpleDataNodes.getLength(); i++) {
                Element sd = (Element) simpleDataNodes.item(i);
                String propName = sd.getAttribute("name");
                String value = sd.getTextContent();
                if (propName != null && !propName.isEmpty() && value != null) {
                    properties.put(propName.trim(), parseTypedValue(value.trim()));
                }
            }
        }

        // Parse Geometry
        Geometry geom = parseGeometry(element);
        if (geom == null) {
            log.warn("No valid geometry found for placemark: {}", name);
            return null;
        }

        // Validate and Fix geometry
        Geometry fixedGeom = geometryValidator.validateAndFix(geom);

        GisFeature feature = GisFeature.builder()
                .id(UUID.randomUUID().toString())
                .geometry(fixedGeom)
                .properties(properties)
                .metadata(new HashMap<>())
                .build();
        feature.initialize();
        return feature;
    }

    private Geometry parseGeometry(Element element) {
        // 1. Polygon
        NodeList polygons = element.getElementsByTagName("Polygon");
        if (polygons.getLength() > 0) {
            return parsePolygon((Element) polygons.item(0));
        }

        // 2. LineString
        NodeList lineStrings = element.getElementsByTagName("LineString");
        if (lineStrings.getLength() > 0) {
            return parseLineString((Element) lineStrings.item(0));
        }

        // 3. Point
        NodeList points = element.getElementsByTagName("Point");
        if (points.getLength() > 0) {
            return parsePoint((Element) points.item(0));
        }

        return null;
    }

    private Polygon parsePolygon(Element polygonEl) {
        NodeList outerList = polygonEl.getElementsByTagName("outerBoundaryIs");
        if (outerList.getLength() == 0) return null;
        Element outer = (Element) outerList.item(0);

        NodeList coordinatesList = outer.getElementsByTagName("coordinates");
        if (coordinatesList.getLength() == 0) return null;
        String coordStr = coordinatesList.item(0).getTextContent().trim();

        Coordinate[] coords = parseCoordinateString(coordStr);
        if (coords.length < 4) return null; // A linear ring must have at least 4 coordinates (closed)

        LinearRing shell = GEOMETRY_FACTORY.createLinearRing(coords);

        // Optional inner boundaries (holes)
        NodeList innerList = polygonEl.getElementsByTagName("innerBoundaryIs");
        List<LinearRing> holes = new ArrayList<>();
        for (int i = 0; i < innerList.getLength(); i++) {
            Element inner = (Element) innerList.item(i);
            NodeList innerCoordsList = inner.getElementsByTagName("coordinates");
            if (innerCoordsList.getLength() > 0) {
                String innerCoordStr = innerCoordsList.item(0).getTextContent().trim();
                Coordinate[] innerCoords = parseCoordinateString(innerCoordStr);
                if (innerCoords.length >= 4) {
                    holes.add(GEOMETRY_FACTORY.createLinearRing(innerCoords));
                }
            }
        }

        LinearRing[] holeArray = holes.toArray(new LinearRing[0]);
        return GEOMETRY_FACTORY.createPolygon(shell, holeArray);
    }

    private LineString parseLineString(Element lineEl) {
        NodeList coordinatesList = lineEl.getElementsByTagName("coordinates");
        if (coordinatesList.getLength() == 0) return null;
        String coordStr = coordinatesList.item(0).getTextContent().trim();
        Coordinate[] coords = parseCoordinateString(coordStr);
        return GEOMETRY_FACTORY.createLineString(coords);
    }

    private Point parsePoint(Element pointEl) {
        NodeList coordinatesList = pointEl.getElementsByTagName("coordinates");
        if (coordinatesList.getLength() == 0) return null;
        String coordStr = coordinatesList.item(0).getTextContent().trim();
        Coordinate[] coords = parseCoordinateString(coordStr);
        if (coords.length > 0) {
            return GEOMETRY_FACTORY.createPoint(coords[0]);
        }
        return null;
    }

    private Coordinate[] parseCoordinateString(String coordStr) {
        String[] coordinateTokens = coordStr.split("\\s+");
        List<Coordinate> coordinates = new ArrayList<>();

        for (String token : coordinateTokens) {
            if (token.isEmpty()) continue;
            String[] parts = token.split(",");
            if (parts.length >= 2) {
                try {
                    double lon = Double.parseDouble(parts[0]);
                    double lat = Double.parseDouble(parts[1]);
                    coordinates.add(new Coordinate(lon, lat));
                } catch (NumberFormatException e) {
                    log.warn("Invalid coordinate token: {}", token);
                }
            }
        }
        return coordinates.toArray(new Coordinate[0]);
    }

    private Object parseTypedValue(String value) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e1) {
            try {
                return Double.parseDouble(value);
            } catch (NumberFormatException e2) {
                if ("true".equalsIgnoreCase(value)) return Boolean.TRUE;
                if ("false".equalsIgnoreCase(value)) return Boolean.FALSE;
                return value; // Default to string
            }
        }
    }

    private String getChildText(Element parent, String tagName) {
        NodeList nodeList = parent.getElementsByTagName(tagName);
        if (nodeList.getLength() > 0) {
            return nodeList.item(0).getTextContent().trim();
        }
        return null;
    }
}
