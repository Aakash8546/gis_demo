package com.example.webgis.service;

import org.springframework.stereotype.Service;
import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class MbTilesService {

    private final Map<String, String> dbUrls = new ConcurrentHashMap<>();
    private final Map<String, String> dbFormats = new ConcurrentHashMap<>();

    public MbTilesService() {

        registerDatabase("varanasi", "data/varanasi.mbtiles");
        registerDatabase("satellite", "data/satellite.mbtiles");
    }

    public void registerDatabase(String name, String relativePath) {
        File dbFile = new File(relativePath);
        String url = "jdbc:sqlite:" + dbFile.getAbsolutePath();
        dbUrls.put(name, url);
        if (dbFile.exists()) {
            System.out.println("MBTiles database '" + name + "' loaded successfully from: " + dbFile.getAbsolutePath());
        } else {
            System.err.println("WARNING: MBTiles database '" + name + "' file not found at " + dbFile.getAbsolutePath() + " (will be resolved dynamically if created later).");
        }
    }

    public byte[] getTile(int z, int x, int y) {
        return getTile("varanasi", z, x, y);
    }

    public byte[] getTile(String dbName, int z, int x, int y) {
        String url = dbUrls.get(dbName);
        if (url == null) {
            File dbFile = new File("data/" + dbName + ".mbtiles");
            url = "jdbc:sqlite:" + dbFile.getAbsolutePath();
            dbUrls.put(dbName, url);
        }

        // Convert XYZ row coordinate (OpenLayers) to TMS row coordinate (MBTiles)
        int tmsY = (1 << z) - 1 - y;

        String query = "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?";
        
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement stmt = conn.prepareStatement(query)) {
            
            stmt.setInt(1, z);
            stmt.setInt(2, x);
            stmt.setInt(3, tmsY);
            
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return rs.getBytes("tile_data");
                }
            }
        } catch (SQLException e) {
            System.err.println("Database query error for db '" + dbName + "', tile [" + z + "/" + x + "/" + y + "]: " + e.getMessage());
        }
        
        return null;
    }

    public String getFormat(String dbName) {
        if (dbFormats.containsKey(dbName)) {
            return dbFormats.get(dbName);
        }

        String url = dbUrls.get(dbName);
        if (url == null) {
            File dbFile = new File("data/" + dbName + ".mbtiles");
            url = "jdbc:sqlite:" + dbFile.getAbsolutePath();
            dbUrls.put(dbName, url);
        }

        String query = "SELECT value FROM metadata WHERE name = 'format'";
        try (Connection conn = DriverManager.getConnection(url);
             PreparedStatement stmt = conn.prepareStatement(query);
             ResultSet rs = stmt.executeQuery()) {
            if (rs.next()) {
                String format = rs.getString("value");
                dbFormats.put(dbName, format);
                return format;
            }
        } catch (SQLException e) {
            System.err.println("Error reading format metadata for db '" + dbName + "': " + e.getMessage());
        }
        return null;
    }
}
