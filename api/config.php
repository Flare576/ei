<?php
/**
 * EI Sync API - Database Configuration
 */

define('DB_HOST', getenv('DB_HOSTNAME') ?: 'localhost');
define('DB_NAME', getenv('DB_DATABASE') ?: 'ei_sync');
define('DB_USER', getenv('DB_USERNAME') ?: 'ei_user');
define('DB_PASS', getenv('DB_PASSWORD') ?: '');

define('RATE_LIMIT_MAX', 3);
define('RATE_LIMIT_WINDOW', 3600);

function getConnection(): PDO {
    static $pdo = null;
    
    if ($pdo === null) {
        try {
            $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME);
            $pdo = new PDO($dsn, DB_USER, DB_PASS, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
        } catch (PDOException $e) {
            http_response_code(500);
            die(json_encode(['error' => 'Database connection failed']));
        }
    }
    
    return $pdo;
}
