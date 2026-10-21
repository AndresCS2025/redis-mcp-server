import { loadConfig } from '../src/config/redis-config.js';
import { SafeRedisClient } from '../src/redis/redis-client.js';
import { handleGetKeyInfo } from '../src/tools/get-key-info.js';
import { handleScanKeys } from '../src/tools/scan-keys.js';
import { handleGetKeyValue } from '../src/tools/get-key-value.js';
import { handleGetCollectionEntries } from '../src/tools/get-collection-entries.js';
import { handleGetMemoryUsage } from '../src/tools/get-memory-usage.js';
import { handleGetServerInfo } from '../src/tools/get-server-info.js';

async function runLiveSmokeTest() {
  console.log('[SmokeTest] Initializing config against disposable Redis...');
  const config = loadConfig({
    REDIS_URL: 'redis://127.0.0.1:6399/0',
    MCP_PORT: '3999'
  });

  const redis = new SafeRedisClient(config);
  await redis.connect();

  console.log('[SmokeTest] 1. Checking Health...');
  const health = await redis.checkHealth();
  if (!health.healthy) throw new Error('Health check failed: ' + JSON.stringify(health));
  console.log(' -> Health OK:', health.status, 'latency:', health.latencyMs, 'ms');

  console.log('[SmokeTest] 2. Testing get_key_info...');
  const keyInfo = await handleGetKeyInfo({ key: 'cache:user:1' }, redis, config);
  console.log(' -> Key info:', keyInfo.type, 'ttl:', keyInfo.ttlSeconds, 'exists:', keyInfo.exists);
  if (!keyInfo.exists || keyInfo.type !== 'string' || keyInfo.ttlSeconds <= 0) {
    throw new Error('Key info mismatch: ' + JSON.stringify(keyInfo));
  }

  const missingInfo = await handleGetKeyInfo({ key: 'missing:cache:key' }, redis, config);
  if (missingInfo.exists || missingInfo.ttlSeconds !== -2) {
    throw new Error('Missing key mismatch: ' + JSON.stringify(missingInfo));
  }
  console.log(' -> Missing key handled correctly (ttl = -2)');

  console.log('[SmokeTest] 3. Testing scan_keys...');
  const scanResult = await handleScanKeys({ pattern: 'cache:*' }, redis, config);
  console.log(' -> Scanned keys count:', scanResult.returnedCount, 'keys:', scanResult.keys);
  if (scanResult.returnedCount < 5) throw new Error('Scan returned unexpected count');

  console.log('[SmokeTest] 4. Testing get_key_value...');
  const valResult = await handleGetKeyValue({ key: 'cache:user:1' }, redis, config);
  console.log(' -> Value read:', valResult.value);
  if (!valResult.value?.includes('Alice')) throw new Error('Value content mismatch');

  console.log('[SmokeTest] 5. Testing get_collection_entries (hash, list, set, zset)...');
  const hashResult = await handleGetCollectionEntries({ key: 'cache:hash:1' }, redis, config);
  console.log(' -> Hash entries:', hashResult.entries);

  const listResult = await handleGetCollectionEntries({ key: 'cache:list:1' }, redis, config);
  console.log(' -> List entries:', listResult.entries);

  const setResult = await handleGetCollectionEntries({ key: 'cache:set:1' }, redis, config);
  console.log(' -> Set entries:', setResult.entries);

  const zsetResult = await handleGetCollectionEntries({ key: 'cache:zset:1' }, redis, config);
  console.log(' -> ZSet entries:', zsetResult.entries);

  console.log('[SmokeTest] 6. Testing get_memory_usage...');
  const memResult = await handleGetMemoryUsage({ key: 'cache:user:1' }, redis, config);
  console.log(' -> Memory usage bytes:', memResult.memoryUsageBytes);

  console.log('[SmokeTest] 7. Testing get_server_info...');
  const serverInfo = await handleGetServerInfo({ section: 'memory' }, redis, config);
  console.log(' -> Used memory human:', serverInfo.fields['used_memory_human']);

  await redis.disconnect();
  console.log('[SmokeTest] All smoke tests PASSED successfully against disposable Redis!');
}

runLiveSmokeTest().catch((err) => {
  console.error('[SmokeTest] FAILED:', err);
  process.exit(1);
});
