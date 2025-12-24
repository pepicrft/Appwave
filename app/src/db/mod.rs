pub mod entity;
mod migrations;

use anyhow::Result;
use sea_orm::{Database as SeaDatabase, DatabaseConnection};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;


/// Database connection wrapper
#[derive(Clone)]
pub struct Database {
    conn: DatabaseConnection,
}

impl Database {
    /// Create a new database connection
    pub async fn new(path: &Path) -> Result<Self> {
        let path_str = path.to_string_lossy();
        let url = format!("sqlite:{}?mode=rwc", path_str);

        // Run migrations using SQLx first
        let options = SqliteConnectOptions::from_str(&url)?
            .create_if_missing(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;

        migrations::run(&pool).await?;
        drop(pool);

        // Now connect with SeaORM
        let conn = SeaDatabase::connect(&url).await?;

        Ok(Self { conn })
    }

    /// Get the database connection
    pub fn conn(&self) -> &DatabaseConnection {
        &self.conn
    }
}
