<?php
/**
 * WPForms → GAS Webhook 送信スニペット
 *
 * WordPress管理画面 > Code Snippets プラグイン（推奨）
 * または wp-content/themes/{テーマ}/functions.php に追加
 *
 * 対象フォーム:
 *   - ID 222: お問い合わせフォーム
 *   - ID 6572: 資料請求フォーム
 *
 * Note: Google WorkspaceではdoPostが制限されるため、
 * GETリクエスト + dataクエリパラメータ方式で送信
 */
add_action('wpforms_process_complete', function ($fields, $entry, $form_data, $entry_id) {

    // 対象フォームIDを限定
    $target_forms = [222, 6572];
    if (!in_array($form_data['id'], $target_forms)) {
        return;
    }

    // GAS Web App のデプロイURL
    $webhook_base = 'https://script.google.com/macros/s/AKfycbxoNMFNPlJdkHafNcHP6hILRVQxU8f36BDmjGC6vxLJBkVpmAp-uZ0AsgzT3oWsgoZSUw/exec';

    // シークレットキー（GAS側 Config.gs と一致させること）
    $secret = 'wk_webhook_2026';

    // フィールドを整形
    $clean_fields = [];
    foreach ($fields as $id => $field) {
        $clean_fields[] = [
            'id'    => $id,
            'name'  => $field['name'] ?? '',
            'value' => $field['value'] ?? '',
            'type'  => $field['type'] ?? '',
        ];
    }

    $payload = json_encode([
        'secret'    => $secret,
        'form_id'   => (int) $form_data['id'],
        'form_name' => $form_data['settings']['form_title'] ?? '',
        'fields'    => $clean_fields,
        'entry_id'  => $entry_id,
        'timestamp' => current_time('c'),
        'source_ip' => $_SERVER['REMOTE_ADDR'] ?? '',
    ], JSON_UNESCAPED_UNICODE);

    // GET方式: dataクエリパラメータにURLエンコードしたJSONを付与
    $webhook_url = $webhook_base . '?data=' . urlencode($payload);

    // 非同期GET送信（ユーザーのフォーム送信体験をブロックしない）
    wp_remote_get($webhook_url, [
        'timeout'   => 15,
        'blocking'  => false,  // レスポンスを待たない
    ]);

}, 10, 4);
