<?php
/**
 * EI Sync API - Router
 * 
 * Endpoints:
 *   POST   /api/{encrypted_id} - Upsert encrypted state
 *   GET    /api/{encrypted_id} - Retrieve encrypted state  
 *   HEAD   /api/{encrypted_id} - Check last_updated timestamp
 * 
 * All data is encrypted client-side. Server only stores opaque blobs.
 */

// CORS headers MUST be sent before any output, including errors
// Using header() with replace=true to ensure they're always set
header('Access-Control-Allow-Origin: *', true);
header('Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS', true);
header('Access-Control-Allow-Headers: Content-Type, If-Match', true);
header('Access-Control-Expose-Headers: ETag, Last-Modified', true);

// Handle preflight immediately
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Wrap everything in try-catch to ensure CORS headers are sent even on fatal errors
set_exception_handler(function($e) {
    // CORS headers already sent above
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Internal server error']);
    exit;
});

require_once __DIR__ . '/sync.php';

$requestUri = $_SERVER['REQUEST_URI'];
$basePath = '/ei/api/';

$path = parse_url($requestUri, PHP_URL_PATH);

if (strpos($path, $basePath) === 0) {
    $encryptedId = substr($path, strlen($basePath));
    $encryptedId = trim($encryptedId, '/');
} else {
    $encryptedId = $_GET['id'] ?? '';
}

if (empty($encryptedId)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Missing encrypted_id in URL']);
    exit;
}

// Base64-safe characters only (security: prevent path traversal)
if (!preg_match('/^[A-Za-z0-9+\/=_-]+$/', $encryptedId)) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid encrypted_id format']);
    exit;
}

if (strlen($encryptedId) > 512) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'encrypted_id too long']);
    exit;
}

header('Content-Type: application/json');

switch ($_SERVER['REQUEST_METHOD']) {
    case 'POST':
        handlePost($encryptedId);
        break;
    case 'GET':
        handleGet($encryptedId);
        break;
    case 'HEAD':
        handleHead($encryptedId);
        break;
    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}
