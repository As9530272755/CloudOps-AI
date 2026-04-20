-- ============================================
-- CloudOps PostgreSQL 常用查询命令
-- 用法: PGPASSWORD=cloudops123 psql -h 127.0.0.1 -p 5432 -U cloudops -d cloudops -f db-commands.sql
-- ============================================

-- 1. 查看所有集群及其权限状态
SELECT id, name, permission_scope, health_status, created_at FROM clusters ORDER BY id;

-- 2. 查看某个集群的完整信息（以 YH 为例）
-- SELECT * FROM clusters WHERE name = 'YH';

-- 3. 查看集群关联的元数据
-- SELECT * FROM cluster_metadata WHERE cluster_id = (SELECT id FROM clusters WHERE name = 'YH');

-- 4. 查看集群的 Secret（kubeconfig）
-- SELECT cluster_id, secret_type, LEFT(encrypted_data, 50) as config_preview FROM cluster_secrets WHERE cluster_id = (SELECT id FROM clusters WHERE name = 'YH');

-- 5. 【重置权限】把某个集群设为 unknown，让 Monitor 重新探测
-- UPDATE clusters SET permission_scope = 'unknown' WHERE name = 'YH';

-- 6. 【手动修复】直接把某个集群设为 read-only
-- UPDATE clusters SET permission_scope = 'read-only' WHERE name = 'YH';

-- 7. 【删除集群】级联删除（先删关联表，再删主表）
-- DELETE FROM cluster_log_backends WHERE cluster_id = (SELECT id FROM clusters WHERE name = 'YH');
-- DELETE FROM cluster_permissions WHERE cluster_id = (SELECT id FROM clusters WHERE name = 'YH');
-- DELETE FROM cluster_metadata WHERE cluster_id = (SELECT id FROM clusters WHERE name = 'YH');
-- DELETE FROM cluster_secrets WHERE cluster_id = (SELECT id FROM clusters WHERE name = 'YH');
-- DELETE FROM clusters WHERE name = 'YH';

-- 8. 查看用户列表
-- SELECT id, username, email, is_superuser, is_active, created_at FROM users;

-- 9. 查看 NS 授权记录
-- SELECT * FROM namespace_grants;
