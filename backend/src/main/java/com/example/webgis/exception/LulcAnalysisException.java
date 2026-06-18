package com.example.webgis.exception;

public class LulcAnalysisException extends RuntimeException {
    public LulcAnalysisException(String message) {
        super(message);
    }

    public LulcAnalysisException(String message, Throwable cause) {
        super(message, cause);
    }
}
