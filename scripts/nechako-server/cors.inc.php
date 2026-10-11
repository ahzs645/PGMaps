<?php
/** Include before bootstrap, session, registration checks or output in portal REST entry points.
 * Deployment and authentication prerequisites: docs/nechako/server-runbook.md.
 * This patch does not authenticate users, fix registration, or parse JSON request bodies.
 */
declare(strict_types=1);

function nechakoCors(): void {
    $configured = getenv('NECHAKO_ALLOWED_ORIGINS');
    $origins = array_filter(array_map('trim', explode(',', $configured === false
        ? 'https://nechakowatershed-portal.ca,https://pgmaps.ahmadjalil.com'
        : $configured)));
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $methods = ['GET', 'POST', 'OPTIONS'];
    $headers = ['content-type', 'x-requested-with'];
    header('Vary: Origin', false);
    // The HTTP server must also remove any old Access-Control-Allow-Origin: * header.
    header_remove('Access-Control-Allow-Origin');
    header_remove('Access-Control-Allow-Credentials');
    if ($origin !== '' && !in_array($origin, $origins, true)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'Origin is not allowed.']);
        exit;
    }
    if ($origin !== '') {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Credentials: true');
    }
    if ($method !== 'OPTIONS') {
        return;
    }
    $requestedMethod = strtoupper($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD'] ?? 'GET');
    $requestedHeaders = array_filter(array_map('trim', explode(',', strtolower($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] ?? ''))));
    if (!in_array($requestedMethod, $methods, true) || array_diff($requestedHeaders, $headers)) {
        http_response_code(403);
        exit;
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');
    header('Access-Control-Max-Age: 600');
    http_response_code(204);
    exit;
}

nechakoCors();
