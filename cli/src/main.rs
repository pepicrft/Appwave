use appwave_core::{Config, Database};
use clap::Parser;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[derive(Parser)]
#[command(name = "appwave")]
#[command(about = "Appwave CLI - Run the Appwave server")]
struct Cli {
    /// Port to run the server on
    #[arg(short, long, default_value = "4000")]
    port: u16,

    /// Path to the frontend directory to serve
    #[arg(short, long)]
    frontend: Option<String>,

    /// Enable debug logging
    #[arg(short, long)]
    debug: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Setup logging
    let filter = if cli.debug {
        EnvFilter::new("debug")
    } else {
        EnvFilter::new("info")
    };

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .init();

    // Load config and override with CLI args
    let mut config = Config::load().unwrap_or_default();
    config.port = cli.port;
    config.debug = cli.debug;

    info!("Starting Appwave server...");

    // Initialize database
    let db_path = config.get_database_path()?;
    info!("Database path: {}", db_path.display());

    let db = Database::new(&db_path).await?;

    // Start server
    let handle = appwave_core::run_server(config, db, cli.frontend.as_deref()).await?;

    info!("Server running on http://localhost:{}", handle.port());
    info!("Press Ctrl+C to stop");

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await?;

    info!("Shutting down...");
    handle.shutdown();

    Ok(())
}
