package com.example.webgis.controller;

import com.example.webgis.model.LayerCatalogResponse;
import com.example.webgis.service.GeoJsonService;
import com.example.webgis.service.MbTilesService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

@RestController
@RequestMapping("/api")

public class GisController {

    private final GeoJsonService geoJsonService;
    private final MbTilesService mbTilesService;

    public GisController(GeoJsonService geoJsonService, MbTilesService mbTilesService) {
        this.geoJsonService = geoJsonService;
        this.mbTilesService = mbTilesService;
    }

    @GetMapping("/health")
    public Map<String, String> health() {
        return Map.of("status", "ok", "mode", "poc");
    }

    @GetMapping("/layers")
    public LayerCatalogResponse getLayers() {
        return geoJsonService.getLayerCatalog();
    }

    @GetMapping("/layers/{layerId}")
    public ResponseEntity<JsonNode> getLayer(@PathVariable String layerId) throws IOException {
        return ResponseEntity.ok(geoJsonService.getLayerById(layerId));
    }

    @GetMapping("/mbtiles/{z}/{x}/{y}")
    public ResponseEntity<byte[]> getMbTile(@PathVariable int z, @PathVariable int x, @PathVariable int y) {
        return getMbTileDynamic("varanasi", z, x, y);
    }

    @GetMapping("/mbtiles/{dbName}/{z}/{x}/{y}")
    public ResponseEntity<byte[]> getMbTileDynamic(@PathVariable String dbName, @PathVariable int z, @PathVariable int x, @PathVariable int y) {
        byte[] tileData = mbTilesService.getTile(dbName, z, x, y);
        if (tileData == null) {
            return ResponseEntity.notFound().build();
        }

        String format = mbTilesService.getFormat(dbName);
        if ("pbf".equalsIgnoreCase(format)) {
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType("application/x-protobuf"))
                    .header("Content-Encoding", "gzip")
                    .body(tileData);
        }

        MediaType contentType = "jpg".equalsIgnoreCase(format) || "jpeg".equalsIgnoreCase(format)
                ? MediaType.IMAGE_JPEG
                : MediaType.IMAGE_PNG;

        return ResponseEntity.ok()
                .contentType(contentType)
                .body(tileData);
    }

    @GetMapping("/news")
    public ResponseEntity<List<Map<String, String>>> getNews(@RequestParam(value = "query", required = false) String query) {
        if (query == null || query.isBlank()) {
            query = "Varanasi";
        }
        List<Map<String, String>> newsList = fetchNewsFromGoogle(query);
        
        // Fallback: If no news is found for the specific query,
        // and the query is not already "Varanasi", try querying "Varanasi" directly.
        if (newsList.isEmpty() && !query.equalsIgnoreCase("Varanasi")) {
            newsList = fetchNewsFromGoogle("Varanasi");
        }
        
        return ResponseEntity.ok(newsList);
    }

    private List<Map<String, String>> fetchNewsFromGoogle(String query) {
        List<Map<String, String>> list = new ArrayList<>();
        try {
            String rssUrl = "https://news.google.com/rss/search?q=" + URLEncoder.encode(query, StandardCharsets.UTF_8.name()) + "&hl=en-IN&gl=IN&ceid=IN:en";
            URLConnection connection = new URL(rssUrl).openConnection();
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36");
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            
            try (InputStream is = connection.getInputStream()) {
                DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
                DocumentBuilder builder = factory.newDocumentBuilder();
                Document doc = builder.parse(is);
                doc.getDocumentElement().normalize();
                
                NodeList nList = doc.getElementsByTagName("item");
                int limit = Math.min(nList.getLength(), 5);
                for (int temp = 0; temp < limit; temp++) {
                    org.w3c.dom.Node nNode = nList.item(temp);
                    if (nNode.getNodeType() == org.w3c.dom.Node.ELEMENT_NODE) {
                        Element eElement = (Element) nNode;
                        
                        String title = getTagValue("title", eElement);
                        String link = getTagValue("link", eElement);
                        String pubDate = getTagValue("pubDate", eElement);
                        String source = "";
                        
                        NodeList sourceList = eElement.getElementsByTagName("source");
                        if (sourceList.getLength() > 0) {
                            source = sourceList.item(0).getTextContent();
                        }
                        
                        String cleanDate = pubDate;
                        try {
                            if (pubDate != null && pubDate.contains(",")) {
                                String[] parts = pubDate.split(" ");
                                if (parts.length >= 4) {
                                    cleanDate = parts[1] + " " + parts[2] + " " + parts[3];
                                }
                            }
                        } catch (Exception dateEx) {
                            // ignore, use original pubDate
                        }

                        Map<String, String> itemMap = new java.util.HashMap<>();
                        itemMap.put("title", title != null ? title : "");
                        itemMap.put("link", link != null ? link : "");
                        itemMap.put("source", (source != null && !source.isBlank()) ? source : "News Update");
                        itemMap.put("pubDate", cleanDate != null ? cleanDate : "Recent");
                        list.add(itemMap);
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return list;
    }

    private String getTagValue(String tag, Element element) {
        NodeList nodeList = element.getElementsByTagName(tag);
        if (nodeList.getLength() > 0) {
            return nodeList.item(0).getTextContent();
        }
        return "";
    }
}
