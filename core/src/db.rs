use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;

/// Database connection pool and operations
#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Create a new database connection
    pub async fn new(path: &Path) -> Result<Self> {
        let path_str = path.to_string_lossy();

        let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", path_str))?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        let db = Self { pool };
        db.run_migrations().await?;

        Ok(db)
    }

    /// Run database migrations
    async fn run_migrations(&self) -> Result<()> {
        // Create tables if they don't exist
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get a setting by key
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM settings WHERE key = ?")
                .bind(key)
                .fetch_optional(&self.pool)
                .await?;

        Ok(row.map(|(v,)| v))
    }

    /// Set a setting value
    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
            "#,
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Get the underlying pool for direct queries
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_database_creation() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        let db = Database::new(&db_path).await.unwrap();
        assert!(db_path.exists());
    }

    #[tokio::test]
    async fn test_settings() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        let db = Database::new(&db_path).await.unwrap();

        // Set a value
        db.set_setting("test_key", "test_value").await.unwrap();

        // Get the value
        let value = db.get_setting("test_key").await.unwrap();
        assert_eq!(value, Some("test_value".to_string()));

        // Update the value
        db.set_setting("test_key", "new_value").await.unwrap();
        let value = db.get_setting("test_key").await.unwrap();
        assert_eq!(value, Some("new_value".to_string()));
    }
}
