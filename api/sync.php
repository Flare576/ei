<?php
/**
 * EI Sync API - Sync Handlers (v3 - Hybrid Storage + ETags)
 * 
 * POST   /ei/api/{id} - Upsert encrypted state (rate limited, etag-checked)
 * GET    /ei/api/{id} - Retrieve encrypted state (returns ETag)
 * HEAD   /ei/api/{id} - Check last_updated timestamp (returns ETag)
 * 
 * Data stored on filesystem, metadata in MySQL.
 * ETags prevent concurrent overwrites between devices.
 */

require_once __DIR__ . '/config.php';

/**
 * Compute ETag for a file. Uses md5 of file content.
 */
function computeEtag(string $filePath): ?string {
    if (!file_exists($filePath)) {
        return null;
    }
    $hash = md5_file($filePath);
    return $hash ? '"' . $hash . '"' : null;
}

function checkRateLimit(PDO $pdo, string $encryptedId): array {
    $stmt = $pdo->prepare('SELECT rate_limit FROM ei_sync WHERE encrypted_id = ?');
    $stmt->execute([$encryptedId]);
    $row = $stmt->fetch();
    
    $timestamps = [];
    if ($row && $row['rate_limit']) {
        $timestamps = json_decode($row['rate_limit'], true) ?: [];
    }
    
    $cutoff = time() - RATE_LIMIT_WINDOW;
    $timestamps = array_filter($timestamps, fn($ts) => $ts > $cutoff);
    
    if (count($timestamps) >= RATE_LIMIT_MAX) {
        $oldestInWindow = min($timestamps);
        $retryAfter = ($oldestInWindow + RATE_LIMIT_WINDOW) - time();
        return ['allowed' => false, 'retry_after' => max(1, $retryAfter), 'timestamps' => $timestamps];
    }
    
    return ['allowed' => true, 'retry_after' => null, 'timestamps' => $timestamps];
}

function handlePost(string $encryptedId): void {
    $body = file_get_contents('php://input');
    $data = json_decode($body, true);
    
    if (!$data || !isset($data['data'])) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid request body. Expected: {"data": "encrypted_blob"}']);
        return;
    }
    
    $pdo = getConnection();
    
    $rateCheck = checkRateLimit($pdo, $encryptedId);
    if (!$rateCheck['allowed']) {
        http_response_code(429);
        header('Retry-After: ' . $rateCheck['retry_after']);
        echo json_encode([
            'error' => 'Rate limit exceeded',
            'retry_after' => $rateCheck['retry_after']
        ]);
        return;
    }
    
    $filePath = getFilePath($encryptedId);
    
    if (!ensureDirectoryExists($filePath)) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to create storage directory']);
        return;
    }
    
    // ETag check: if file exists and client sent If-Match, verify it
    if (file_exists($filePath)) {
        $ifMatch = $_SERVER['HTTP_IF_MATCH'] ?? null;
        if ($ifMatch !== null) {
            $currentEtag = computeEtag($filePath);
            if ($currentEtag !== null && $ifMatch !== $currentEtag) {
                http_response_code(412);
                header('ETag: ' . $currentEtag);
                echo json_encode(['error' => 'Precondition failed: state was modified by another device']);
                return;
            }
        }
    }
    
    if (file_put_contents($filePath, $data['data'], LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to write data file']);
        return;
    }
    
    $timestamps = $rateCheck['timestamps'];
    $timestamps[] = time();
    $rateLimitJson = json_encode(array_values($timestamps));
    
    $relativeFilePath = substr($encryptedId, 0, 2) . '/' . $encryptedId . '.json';
    
    $stmt = $pdo->prepare('
        INSERT INTO ei_sync (encrypted_id, file_path, last_updated, rate_limit)
        VALUES (?, ?, NOW(), ?)
        ON DUPLICATE KEY UPDATE
            file_path = VALUES(file_path),
            last_updated = NOW(),
            rate_limit = VALUES(rate_limit)
    ');
    
    $stmt->execute([$encryptedId, $relativeFilePath, $rateLimitJson]);
    
    // Return new ETag after successful write
    $newEtag = computeEtag($filePath);
    if ($newEtag) {
        header('ETag: ' . $newEtag);
    }
    
    http_response_code(200);
    echo json_encode(['success' => true]);
}

function handleGet(string $encryptedId): void {
    $pdo = getConnection();
    
    $stmt = $pdo->prepare('SELECT file_path, last_updated FROM ei_sync WHERE encrypted_id = ?');
    $stmt->execute([$encryptedId]);
    $row = $stmt->fetch();
    
    if (!$row) {
        http_response_code(404);
        echo json_encode(['error' => 'Not found']);
        return;
    }
    
    $filePath = DATA_PATH . '/' . $row['file_path'];
    
    if (!file_exists($filePath)) {
        http_response_code(404);
        echo json_encode(['error' => 'Data file not found']);
        return;
    }
    
    $data = file_get_contents($filePath);
    if ($data === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to read data file']);
        return;
    }
    
    $lastUpdated = strtotime($row['last_updated']);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $lastUpdated) . ' GMT');
    
    $etag = computeEtag($filePath);
    if ($etag) {
        header('ETag: ' . $etag);
    }
    
    http_response_code(200);
    header('Content-Type: application/json');
    echo json_encode(['data' => $data]);
}

function handleHead(string $encryptedId): void {
    $pdo = getConnection();
    
    $stmt = $pdo->prepare('SELECT file_path, last_updated FROM ei_sync WHERE encrypted_id = ?');
    $stmt->execute([$encryptedId]);
    $row = $stmt->fetch();
    
    if (!$row) {
        http_response_code(404);
        return;
    }
    
    $lastUpdated = strtotime($row['last_updated']);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $lastUpdated) . ' GMT');
    
    $filePath = DATA_PATH . '/' . $row['file_path'];
    $etag = computeEtag($filePath);
    if ($etag) {
        header('ETag: ' . $etag);
    }
    
    http_response_code(200);
}
