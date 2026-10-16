-- Retire the unused legacy Memory Vault and remove ciphertext-only backup storage.
-- Current account-scoped History and Key Memories are stored in separate tables.
DROP TABLE IF EXISTS vault_backups;
