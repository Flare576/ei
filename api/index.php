<?php
/**
 * EI Sync API - Router
 * 
 * Endpoints:
 *   POST   /ei/api/{encrypted_id} - Upsert encrypted state
 *   GET    /ei/api/{encrypted_id} - Retrieve encrypted state  
 *   HEAD   /ei/api/{encrypted_id} - Check last_updated timestamp
 * 
 * All data is encrypted client-side. Server only stores opaque blobs.
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, HEAD, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

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
