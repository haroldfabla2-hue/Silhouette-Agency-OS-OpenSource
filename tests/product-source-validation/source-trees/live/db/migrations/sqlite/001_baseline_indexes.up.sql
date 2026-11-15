-- Migration: Add extra indexes to improve log speeds
CREATE INDEX IF NOT EXISTS idx_chat_logs_role ON chat_logs(role);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
