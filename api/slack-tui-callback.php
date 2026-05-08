<?php
/**
 * Slack TUI OAuth relay
 *
 * Slack requires HTTPS redirect URIs for distributed apps. The TUI runs a
 * local Bun HTTP server on 127.0.0.1:4243 to catch the OAuth code, which
 * Slack won't redirect to directly. This endpoint acts as an HTTPS landing
 * pad, then immediately bounces the user to the local TUI server with the
 * code intact.
 *
 * Flow:
 *   TUI opens browser → Slack OAuth → user approves
 *   → Slack redirects to https://ei.flare576.com/callback/slack/tui?code=xyz
 *   → This file redirects to http://127.0.0.1:4243/?code=xyz
 *   → TUI's Bun server catches it, exchanges code, done
 */

$code  = $_GET['code']  ?? '';
$error = $_GET['error'] ?? '';
$state = $_GET['state'] ?? '';

$params = [];
if ($code)  $params['code']  = $code;
if ($error) $params['error'] = $error;
if ($state) $params['state'] = $state;

$query = $params ? '?' . http_build_query($params) : '';
$target = 'http://127.0.0.1:4243/' . $query;

header('Location: ' . $target, true, 302);
exit;
